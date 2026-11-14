import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { lockOwnedBakeCycles, lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { loadLockedStockLedger } from "@/modules/inventory/application/stock-ledger";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { StorageDecimal } from "@/modules/shopping/domain/storage";
import { cycleConsumptionContexts, cycleConsumptionItems, consumptionRevisions, consumptionRevisionItems } from "../db/schema";
import { correctUseInputSchema } from "../domain/forms";
import { canonicalizeUseRequest } from "../domain/request-manifest";
import { calculateUseEffect, canonicalQuantity } from "../domain/rules";
import { ConsumptionStateError, type CorrectUseInput, type ConsumptionClock, type ConsumptionWriteResult } from "../domain/types";
import { assertExpectedLedger, assertUsageProvenance, findExistingOperation, lockConsumptionContexts, writeConsumptionOperation, type PreparedConsumptionOperation } from "./command-support";
import { rethrowConsumptionLockError } from "./count-barrier";

export async function correctUse(db: DatabaseClient, clock: ConsumptionClock, ownerId: string, input: CorrectUseInput): Promise<ConsumptionWriteResult> {
  const parsed = correctUseInputSchema.safeParse(input);
  if (!parsed.success) throw new ConsumptionStateError("INVALID_INPUT", "Invalid consumption correction");
  const intent = parsed.data;
  const canonicalManifest = canonicalizeUseRequest("CORRECT", intent);
  try {
    return await db.transaction(async (tx) => {
      const [cycle] = await lockOwnedBakeCycles(tx, ownerId, [intent.cycleId]);
      if (!cycle) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      const existing = await findExistingOperation(tx, ownerId, intent.requestId, canonicalManifest);
      if (existing) return existing;
      await lockConsumptionContexts(tx, ownerId, [intent]);
      const [context] = await tx.select().from(cycleConsumptionContexts).where(and(eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.id, intent.contextId)));
      const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.id, intent.planningSnapshotId)));
      if (cycle.activePlanningSnapshotId !== intent.planningSnapshotId || snapshot!.status !== "ACTIVE" || context!.currentRevisionId !== intent.expectedRevisionId)
        throw new ConsumptionStateError("STALE_DATA", "Consumption source or predecessor is stale");
      if (cycle.consumptionPolicy !== "CONSUMPTION_V1" || !["IN_PRODUCTION", "CANCELLED", "COMPLETED"].includes(cycle.status))
        throw new ConsumptionStateError("INVALID_CYCLE_STATE", "Cycle is not ready to correct consumption");
      const source = await tx.select().from(cycleConsumptionItems).where(and(eq(cycleConsumptionItems.ownerId, ownerId), eq(cycleConsumptionItems.contextId, intent.contextId))).orderBy(cycleConsumptionItems.inventoryItemId);
      assertUsageProvenance(source, intent.items, cycle.status);
      const itemIds = source.map((row) => row.inventoryItemId);
      if ((await lockOwnedInventoryItems(tx, ownerId, itemIds)).length !== itemIds.length)
        throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      const ledger = await loadLockedStockLedger(tx, ownerId, itemIds);
      assertExpectedLedger(ledger, intent.expectedLedger);
      const [previous] = await tx.select().from(consumptionRevisions).where(and(eq(consumptionRevisions.ownerId, ownerId), eq(consumptionRevisions.contextId, context!.id), eq(consumptionRevisions.id, intent.expectedRevisionId))).for("update");
      const previousItems = await tx.select().from(consumptionRevisionItems).where(and(eq(consumptionRevisionItems.ownerId, ownerId), eq(consumptionRevisionItems.revisionId, previous!.id)));
      const [initial] = await tx.select().from(consumptionRevisions).where(and(eq(consumptionRevisions.ownerId, ownerId), eq(consumptionRevisions.contextId, context!.id), eq(consumptionRevisions.revisionNumber, 1)));
      const initialItems = await tx.select().from(consumptionRevisionItems).where(and(eq(consumptionRevisionItems.ownerId, ownerId), eq(consumptionRevisionItems.revisionId, initial!.id)));
      // Every ledger and predecessor token has been checked before deriving modes.
      const operationId = randomUUID();
      const revisionId = randomUUID();
      const revisionItems = source.map((row) => {
        const item = intent.items.find((i) => i.inventoryItemId === row.inventoryItemId)!;
        const initialCountMovementId = initialItems.find((i) => i.inventoryItemId === row.inventoryItemId)!.initialCountMovementId;
        const effect = calculateUseEffect({ previousUsed: canonicalQuantity(previousItems.find((i) => i.inventoryItemId === row.inventoryItemId)!.usedQuantity), newUsed: item.usedQuantity,
          initialCountMovementId, currentCountMovementId: ledger.find((l) => l.inventoryItemId === row.inventoryItemId)!.countMovementId, countSettled: false });
        return { ...item, ownerId, contextId: context!.id, revisionId, mode: effect.mode, quantityDelta: effect.delta,
          initialCountMovementId, movementId: randomUUID(), settlementCountMovementId: null };
      });
      const shortages = revisionItems.flatMap((item) => {
        const balance = ledger.find((row) => row.inventoryItemId === item.inventoryItemId)!.balance;
        return new StorageDecimal(balance).plus(item.quantityDelta).lt(0)
          ? [{ inventoryItemId: item.inventoryItemId, availableQuantity: balance, requiredQuantity: new StorageDecimal(item.quantityDelta).negated().toFixed() }] : [];
      });
      if (shortages.length) throw new ConsumptionStateError("INSUFFICIENT_STOCK", "Insufficient stock for corrected use", { shortages });
      const confirmedAt = clock.now();
      const prepared: PreparedConsumptionOperation = {
        operation: { id: operationId, ownerId, requestId: intent.requestId, kind: "CORRECT", canonicalManifest, resultRevisionIds: [revisionId], resultCountMovementIds: [] },
        revisions: [{ id: revisionId, ownerId, contextId: context!.id, operationId, revisionNumber: previous!.revisionNumber + 1, previousRevisionId: previous!.id, reason: intent.reason }],
        revisionItems,
        usageMovements: revisionItems.map((row) => ({ id: row.movementId, ownerId, inventoryItemId: row.inventoryItemId,
          type: "CORRECTION", quantityDeltaInBaseUnit: row.quantityDelta, referenceType: "CONSUMPTION_REVISION", referenceId: revisionId, occurredAt: confirmedAt, notes: row.reason })),
        countMovements: [], pointerUpdates: [{ contextId: context!.id, expectedRevisionId: previous!.id, newRevisionId: revisionId }],
      };
      return writeConsumptionOperation(tx, ownerId, prepared, confirmedAt);
    });
  } catch (error) { rethrowConsumptionLockError(error); }
}
