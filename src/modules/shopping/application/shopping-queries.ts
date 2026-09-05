import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import type { PlanningGenerationSummary } from "@/modules/planning/application/planning-queries";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { calculatePurchaseProgress } from "@/modules/shopping/domain/calculations";
import type {
  CycleInventoryCountView,
  CyclePurchaseEntryView,
  CycleShoppingHeader,
  CycleShoppingItemView,
  CycleStockShoppingView,
  StockRequirementCategory,
} from "@/modules/shopping/domain/types";
import type { UnitCode } from "@/modules/units/domain/units";
import {
  cycleInventoryCounts,
  cyclePurchaseEntries,
  cycleShoppingItems,
} from "../db/schema";
import { loadShoppingSource } from "./load-shopping-source";

const uuidSchema = z.string().uuid();

function generationNotFound(): never {
  throw new Error("Shopping generation not found");
}

function toGenerationSummary(
  row: typeof cyclePlanningSnapshots.$inferSelect,
): PlanningGenerationSummary {
  return {
    id: row.id,
    cycleId: row.bakeCycleId,
    generation: row.generation,
    status: row.status,
    costComplete: row.costComplete,
    lockedAt: row.lockedAt,
    unlockedAt: row.unlockedAt,
    unlockReason: row.unlockReason,
    unlockedFromStatus:
      row.unlockedFromStatus === "LOCKED" ||
      row.unlockedFromStatus === "IN_PRODUCTION"
        ? row.unlockedFromStatus
        : null,
  };
}

function toCycleHeader(
  cycle: typeof bakeCycles.$inferSelect,
  snapshot: typeof cyclePlanningSnapshots.$inferSelect | null,
): CycleShoppingHeader {
  return {
    cycleId: cycle.id,
    cycleNumber: snapshot?.cycleNumber ?? cycle.cycleNumber,
    cycleName: snapshot?.cycleName ?? cycle.name,
    cycleStatus: cycle.status,
    planningSnapshotId: snapshot?.id ?? null,
    generation: snapshot?.generation ?? null,
    planningStatus: snapshot?.status ?? null,
  };
}

function isWritableActiveGeneration(
  cycle: typeof bakeCycles.$inferSelect,
  snapshot: typeof cyclePlanningSnapshots.$inferSelect,
): boolean {
  return (
    snapshot.status === "ACTIVE" &&
    cycle.activePlanningSnapshotId === snapshot.id &&
    (cycle.status === "LOCKED" || cycle.status === "IN_PRODUCTION")
  );
}

function toCountView(
  row: typeof cycleInventoryCounts.$inferSelect,
): CycleInventoryCountView {
  return {
    id: row.id,
    cycleId: row.bakeCycleId,
    planningSnapshotId: row.planningSnapshotId,
    inventoryItemId: row.inventoryItemId,
    priceSnapshotId: row.priceSnapshotId,
    inventoryItemName: row.inventoryItemName,
    inventoryCategory: row.inventoryCategory as StockRequirementCategory,
    baseUnit: row.baseUnit as UnitCode,
    requiredQuantity: row.requiredQuantity.toString(),
    systemBalanceBeforeCount: row.systemBalanceBeforeCount.toString(),
    countedQuantity: row.countedQuantity.toString(),
    countDeltaQuantity: row.countDeltaQuantity.toString(),
    purchaseUnitLabel: row.purchaseUnitLabel,
    baseQuantityPerPurchasePack: row.baseQuantityPerPurchasePack.toString(),
    countMovementId: row.countMovementId,
    countedAt: row.countedAt,
    confirmationRequestId: row.confirmationRequestId,
    createdAt: row.createdAt,
  };
}

function toPurchaseView(
  row: typeof cyclePurchaseEntries.$inferSelect,
): CyclePurchaseEntryView {
  return {
    id: row.id,
    cycleId: row.bakeCycleId,
    planningSnapshotId: row.planningSnapshotId,
    shoppingItemId: row.shoppingItemId,
    inventoryItemId: row.inventoryItemId,
    purchaseRequestId: row.purchaseRequestId,
    packCount: row.packCount,
    packBaseQuantity: row.packBaseQuantity.toString(),
    purchasedQuantity: row.purchasedQuantity.toString(),
    totalPriceSatang: row.totalPriceSatang,
    purchasedFrom: row.purchasedFrom,
    occurredAt: row.occurredAt,
    notes: row.notes,
    inventoryMovementId: row.inventoryMovementId,
    inventoryPriceId: row.inventoryPriceId,
    createdAt: row.createdAt,
  };
}

export function createShoppingQueryService(db: DatabaseClient) {
  return {
    async getCycleStockCheck(
      ownerId: string,
      cycleId: string,
      generation?: number,
    ): Promise<CycleStockShoppingView> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (
        !parsedOwnerId.success ||
        !parsedCycleId.success ||
        (generation !== undefined &&
          (!Number.isSafeInteger(generation) || generation <= 0))
      ) {
        generationNotFound();
      }
      const verifiedOwnerId = parsedOwnerId.data;
      const verifiedCycleId = parsedCycleId.data;
      const [cycle] = await db
        .select()
        .from(bakeCycles)
        .where(
          and(
            eq(bakeCycles.ownerId, verifiedOwnerId),
            eq(bakeCycles.id, verifiedCycleId),
          ),
        )
        .limit(1);
      if (!cycle) generationNotFound();

      const generationRows = await db
        .select()
        .from(cyclePlanningSnapshots)
        .where(
          and(
            eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
            eq(cyclePlanningSnapshots.bakeCycleId, verifiedCycleId),
          ),
        )
        .orderBy(desc(cyclePlanningSnapshots.generation));
      const generations = generationRows.map(toGenerationSummary);

      let snapshot: typeof cyclePlanningSnapshots.$inferSelect | undefined;
      if (generation === undefined) {
        if (!cycle.activePlanningSnapshotId) {
          return {
            kind: "NO_PLAN",
            cycle: toCycleHeader(cycle, null),
            generations,
            writable: false,
          };
        }
        snapshot = generationRows.find(
          (row) => row.id === cycle.activePlanningSnapshotId,
        );
      } else {
        snapshot = generationRows.find((row) => row.generation === generation);
      }
      if (!snapshot) generationNotFound();

      const countRows = await db
        .select()
        .from(cycleInventoryCounts)
        .where(
          and(
            eq(cycleInventoryCounts.ownerId, verifiedOwnerId),
            eq(cycleInventoryCounts.bakeCycleId, verifiedCycleId),
            eq(cycleInventoryCounts.planningSnapshotId, snapshot.id),
          ),
        )
        .orderBy(
          asc(cycleInventoryCounts.inventoryItemName),
          asc(cycleInventoryCounts.inventoryItemId),
        );
      const cycleHeader = toCycleHeader(cycle, snapshot);
      const writable = isWritableActiveGeneration(cycle, snapshot);
      if (countRows.length === 0) {
        if (writable) {
          return {
            kind: "COUNT_REQUIRED",
            cycle: cycleHeader,
            generations,
            items: await loadShoppingSource(db, verifiedOwnerId, snapshot.id),
            writable: true,
          };
        }
        return {
          kind: "HISTORY",
          cycle: cycleHeader,
          generations,
          confirmedAt: null,
          counts: [],
          items: [],
          writable: false,
        };
      }

      const [shoppingRows, counts] = await Promise.all([
        db
          .select()
          .from(cycleShoppingItems)
          .where(
            and(
              eq(cycleShoppingItems.ownerId, verifiedOwnerId),
              eq(cycleShoppingItems.bakeCycleId, verifiedCycleId),
              eq(cycleShoppingItems.planningSnapshotId, snapshot.id),
            ),
          )
          .orderBy(asc(cycleShoppingItems.inventoryItemId)),
        Promise.resolve(countRows.map(toCountView)),
      ]);
      const shoppingItemIds = shoppingRows.map((row) => row.id);
      const purchaseRows =
        shoppingItemIds.length === 0
          ? []
          : await db
              .select()
              .from(cyclePurchaseEntries)
              .where(
                and(
                  eq(cyclePurchaseEntries.ownerId, verifiedOwnerId),
                  eq(cyclePurchaseEntries.bakeCycleId, verifiedCycleId),
                  eq(cyclePurchaseEntries.planningSnapshotId, snapshot.id),
                  inArray(cyclePurchaseEntries.shoppingItemId, shoppingItemIds),
                ),
              )
              .orderBy(
                asc(cyclePurchaseEntries.occurredAt),
                asc(cyclePurchaseEntries.id),
              );
      const purchasesByShoppingItemId = new Map<string, CyclePurchaseEntryView[]>();
      for (const purchase of purchaseRows.map(toPurchaseView)) {
        const existing = purchasesByShoppingItemId.get(purchase.shoppingItemId);
        if (existing) existing.push(purchase);
        else purchasesByShoppingItemId.set(purchase.shoppingItemId, [purchase]);
      }
      const countById = new Map(counts.map((count) => [count.id, count]));
      const items: CycleShoppingItemView[] = shoppingRows.map((shopping) => {
        const count = countById.get(shopping.inventoryCountId);
        if (!count) throw new Error("Shopping count missing");
        const purchases = purchasesByShoppingItemId.get(shopping.id) ?? [];
        return {
          id: shopping.id,
          cycleId: shopping.bakeCycleId,
          planningSnapshotId: shopping.planningSnapshotId,
          inventoryCountId: shopping.inventoryCountId,
          inventoryItemId: shopping.inventoryItemId,
          inventoryItemName: count.inventoryItemName,
          inventoryCategory: count.inventoryCategory,
          baseUnit: count.baseUnit,
          requiredQuantity: count.requiredQuantity,
          countedQuantity: count.countedQuantity,
          purchaseUnitLabel: count.purchaseUnitLabel,
          baseQuantityPerPurchasePack: count.baseQuantityPerPurchasePack,
          shortfallQuantity: shopping.shortfallQuantity.toString(),
          suggestedPackCount: shopping.suggestedPackCount,
          suggestedPurchaseQuantity: shopping.suggestedPurchaseQuantity.toString(),
          estimatedCostSatang: shopping.estimatedCostSatang,
          createdAt: shopping.createdAt,
          progress: calculatePurchaseProgress(
            shopping.shortfallQuantity.toString(),
            purchases.map((purchase) => purchase.purchasedQuantity),
          ),
          purchases,
        };
      });
      const confirmedAt = countRows[0]!.countedAt;
      if (writable) {
        return {
          kind: "SHOPPING",
          cycle: cycleHeader,
          generations,
          confirmedAt,
          counts,
          items,
          writable: true,
        };
      }
      return {
        kind: "HISTORY",
        cycle: cycleHeader,
        generations,
        confirmedAt,
        counts,
        items,
        writable: false,
      };
    },
  };
}
