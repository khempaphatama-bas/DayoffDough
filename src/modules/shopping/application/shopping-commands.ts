import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedBakeCycle, lockOwnedInventoryItems } from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { calculateShoppingRecommendation } from "@/modules/shopping/domain/calculations";
import {
  confirmStockInputSchema,
  type ConfirmStockInput,
} from "@/modules/shopping/domain/forms";
import type { CycleStockShoppingView, StockCountCandidate } from "@/modules/shopping/domain/types";
import { cycleInventoryCounts, cycleShoppingItems } from "@/modules/shopping/db/schema";
import { loadShoppingSource } from "./load-shopping-source";
import { createShoppingQueryService } from "./shopping-queries";

type ShoppingClock = Readonly<{ now: () => Date }>;
type LockedCycle = NonNullable<Awaited<ReturnType<typeof lockOwnedBakeCycle>>>;

export class ShoppingStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingStateError";
  }
}

export class ShoppingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingValidationError";
  }
}

function isShoppingWritable(cycle: LockedCycle, snapshotId: string): boolean {
  return (
    (cycle.status === "LOCKED" || cycle.status === "IN_PRODUCTION") &&
    cycle.activePlanningSnapshotId === snapshotId
  );
}

function canonicalCountSet(
  counts: ReadonlyArray<Pick<ConfirmStockInput["counts"][number], "inventoryItemId" | "countedQuantity">>,
) {
  return counts
    .map((count) => ({
      inventoryItemId: count.inventoryItemId,
      countedQuantity: new Decimal(count.countedQuantity).toString(),
    }))
    .sort(
      (left, right) =>
        left.inventoryItemId.localeCompare(right.inventoryItemId) ||
        left.countedQuantity.localeCompare(right.countedQuantity),
    );
}

function assertSameCanonicalCountSet(
  existing: ReadonlyArray<typeof cycleInventoryCounts.$inferSelect>,
  submitted: ConfirmStockInput["counts"],
) {
  const canonicalExisting = canonicalCountSet(
    existing.map((count) => ({
      inventoryItemId: count.inventoryItemId,
      countedQuantity: count.countedQuantity.toString(),
    })),
  );
  const canonicalSubmitted = canonicalCountSet(submitted);
  if (
    canonicalExisting.length !== canonicalSubmitted.length ||
    canonicalExisting.some(
      (count, index) =>
        count.inventoryItemId !== canonicalSubmitted[index]!.inventoryItemId ||
        count.countedQuantity !== canonicalSubmitted[index]!.countedQuantity,
    )
  ) {
    throw new ShoppingValidationError("Stock count confirmation differs from the existing confirmation");
  }
}

function assertExactCountSet(
  source: ReadonlyArray<StockCountCandidate>,
  submitted: ConfirmStockInput["counts"],
) {
  const sourceIds = new Set(source.map((row) => row.inventoryItemId));
  const submittedIds = submitted.map((count) => count.inventoryItemId);
  if (
    sourceIds.size !== source.length ||
    submittedIds.length !== source.length ||
    new Set(submittedIds).size !== submittedIds.length ||
    submittedIds.some((id) => !sourceIds.has(id))
  ) {
    throw new ShoppingValidationError("Stock counts must match the planning requirements exactly");
  }
}

async function loadExistingCounts(
  db: Pick<DatabaseClient, "select">,
  ownerId: string,
  cycleId: string,
  planningSnapshotId: string,
) {
  return db
    .select()
    .from(cycleInventoryCounts)
    .where(
      and(
        eq(cycleInventoryCounts.ownerId, ownerId),
        eq(cycleInventoryCounts.bakeCycleId, cycleId),
        eq(cycleInventoryCounts.planningSnapshotId, planningSnapshotId),
      ),
    );
}

export function createShoppingCommandService(
  db: DatabaseClient,
  clock: ShoppingClock = { now: () => new Date() },
) {
  return {
    async confirmStock(
      ownerId: string,
      input: ConfirmStockInput,
    ): Promise<CycleStockShoppingView> {
      const parsedOwnerId = z.string().uuid().safeParse(ownerId);
      const parsedInput = confirmStockInputSchema.safeParse(input);
      if (!parsedOwnerId.success || !parsedInput.success) {
        throw new ShoppingValidationError("Invalid stock count confirmation");
      }
      const verifiedOwnerId = parsedOwnerId.data;
      const verifiedInput = parsedInput.data;

      return db.transaction(async (tx) => {
        const cycle = await lockOwnedBakeCycle(
          tx,
          verifiedOwnerId,
          verifiedInput.cycleId,
        );
        if (!cycle || !isShoppingWritable(cycle, verifiedInput.planningSnapshotId)) {
          throw new ShoppingStateError("Cycle is not writable for stock confirmation");
        }

        const [snapshot] = await tx
          .select()
          .from(cyclePlanningSnapshots)
          .where(
            and(
              eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
              eq(cyclePlanningSnapshots.bakeCycleId, cycle.id),
              eq(cyclePlanningSnapshots.id, verifiedInput.planningSnapshotId),
            ),
          )
          .limit(1)
          .for("update");
        if (!snapshot || snapshot.status !== "ACTIVE") {
          throw new ShoppingStateError("Planning snapshot is not active for stock confirmation");
        }

        const existingCounts = await loadExistingCounts(
          tx,
          verifiedOwnerId,
          cycle.id,
          verifiedInput.planningSnapshotId,
        );
        if (existingCounts.length > 0) {
          assertSameCanonicalCountSet(existingCounts, verifiedInput.counts);
          return createShoppingQueryService(tx as unknown as DatabaseClient).getCycleStockCheck(
            verifiedOwnerId,
            cycle.id,
          );
        }

        const source = await loadShoppingSource(
          tx as unknown as DatabaseClient,
          verifiedOwnerId,
          verifiedInput.planningSnapshotId,
        );
        assertExactCountSet(source, verifiedInput.counts);
        const lockedItems = await lockOwnedInventoryItems(
          tx as unknown as DatabaseClient,
          verifiedOwnerId,
          source.map((row) => row.inventoryItemId),
        );
        if (lockedItems.length !== source.length) {
          throw new ShoppingStateError("Shopping inventory profile changed");
        }
        const refreshed = await loadShoppingSource(
          tx,
          verifiedOwnerId,
          verifiedInput.planningSnapshotId,
        );
        assertExactCountSet(refreshed, verifiedInput.counts);
        const countByItemId = new Map(
          verifiedInput.counts.map((count) => [
            count.inventoryItemId,
            new Decimal(count.countedQuantity).toString(),
          ]),
        );

        for (const row of refreshed) {
          const countId = randomUUID();
          const countedQuantity = countByItemId.get(row.inventoryItemId);
          if (countedQuantity === undefined) {
            throw new ShoppingValidationError("Stock counts must match the planning requirements exactly");
          }
          const systemBalance = row.systemBalance;
          const countDelta = new Decimal(countedQuantity).minus(systemBalance).toString();
          const [movement] = await tx
            .insert(inventoryMovements)
            .values({
              ownerId: verifiedOwnerId,
              inventoryItemId: row.inventoryItemId,
              type: "COUNT",
              quantityDeltaInBaseUnit: countDelta,
              countedQuantityInBaseUnit: countedQuantity,
              referenceType: "CYCLE_INVENTORY_COUNT",
              referenceId: countId,
              occurredAt: verifiedInput.countedAt,
            })
            .returning();
          if (!movement) throw new ShoppingStateError("Failed to record stock count movement");
          const [count] = await tx
            .insert(cycleInventoryCounts)
            .values({
              id: countId,
              ownerId: verifiedOwnerId,
              bakeCycleId: cycle.id,
              planningSnapshotId: verifiedInput.planningSnapshotId,
              inventoryItemId: row.inventoryItemId,
              priceSnapshotId: row.priceSnapshotId,
              inventoryItemName: row.inventoryItemName,
              inventoryCategory: row.inventoryCategory,
              baseUnit: row.baseUnit,
              requiredQuantity: row.requiredQuantity,
              systemBalanceBeforeCount: systemBalance,
              countedQuantity,
              countDeltaQuantity: countDelta,
              purchaseUnitLabel: row.purchaseUnitLabel,
              baseQuantityPerPurchasePack: row.baseQuantityPerPurchasePack,
              countMovementId: movement.id,
              countedAt: verifiedInput.countedAt,
              confirmationRequestId: verifiedInput.confirmationRequestId,
              createdAt: clock.now(),
            })
            .returning();
          if (!count) throw new ShoppingStateError("Failed to record stock count");
          const recommendation = calculateShoppingRecommendation({
            requiredQuantity: row.requiredQuantity,
            countedQuantity,
            packBaseQuantity: row.baseQuantityPerPurchasePack,
            unitCostSatang: row.unitCostSatang,
          });
          if (recommendation.shortfallQuantity !== "0") {
            await tx.insert(cycleShoppingItems).values({
              ownerId: verifiedOwnerId,
              bakeCycleId: cycle.id,
              planningSnapshotId: verifiedInput.planningSnapshotId,
              inventoryCountId: count.id,
              inventoryItemId: row.inventoryItemId,
              ...recommendation,
              createdAt: clock.now(),
            });
          }
        }
        return createShoppingQueryService(tx as unknown as DatabaseClient).getCycleStockCheck(
          verifiedOwnerId,
          cycle.id,
        );
      });
    },
  };
}
