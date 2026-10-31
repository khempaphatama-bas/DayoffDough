import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { lockOwnedBakeCycles, lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { loadLockedStockLedger } from "@/modules/inventory/application/stock-ledger";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { StorageDecimal } from "@/modules/shopping/domain/storage";
import { cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";
import { confirmUseInputSchema } from "../domain/forms";
import { canonicalizeUseRequest } from "../domain/request-manifest";
import { calculateUseEffect, canonicalQuantity } from "../domain/rules";
import { ConsumptionStateError, type ConfirmUseInput, type ConsumptionClock, type ConsumptionWriteResult } from "../domain/types";
import { assertExpectedLedger, findExistingOperation, lockConsumptionContexts, writeConsumptionOperation, type PreparedConsumptionOperation } from "./command-support";
import { rethrowConsumptionLockError } from "./count-barrier";

export async function confirmUse(db: DatabaseClient, clock: ConsumptionClock, ownerId: string, input: ConfirmUseInput): Promise<ConsumptionWriteResult> {
  const parsed = confirmUseInputSchema.safeParse(input);
  if (!parsed.success) throw new ConsumptionStateError("INVALID_INPUT", "Invalid consumption confirmation");
  const intent = parsed.data;
  const canonicalManifest = canonicalizeUseRequest("CONFIRM", intent);
  try {
    return await db.transaction(async (tx) => {
      const [cycle] = await lockOwnedBakeCycles(tx, ownerId, [intent.cycleId]);
      if (!cycle) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      const existing = await findExistingOperation(tx, ownerId, intent.requestId, canonicalManifest);
      if (existing) return existing;
      await lockConsumptionContexts(tx, ownerId, [intent]);
      const [context] = await tx.select().from(cycleConsumptionContexts).where(and(eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.id, intent.contextId)));
      const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.id, intent.planningSnapshotId)));
      if (cycle.consumptionPolicy !== "CONSUMPTION_V1" || !["IN_PRODUCTION", "CANCELLED"].includes(cycle.status))
        throw new ConsumptionStateError("INVALID_CYCLE_STATE", "Cycle is not ready to confirm consumption");
      if (cycle.activePlanningSnapshotId !== intent.planningSnapshotId || snapshot!.status !== "ACTIVE" || context!.currentRevisionId !== null)
        throw new ConsumptionStateError("STALE_DATA", "Consumption source is stale");
      const source = await tx.select().from(cycleConsumptionItems).where(and(eq(cycleConsumptionItems.ownerId, ownerId), eq(cycleConsumptionItems.contextId, intent.contextId))).orderBy(cycleConsumptionItems.inventoryItemId);
      if (source.length !== intent.items.length || source.some((row) => !intent.items.some((item) => item.inventoryItemId === row.inventoryItemId)))
        throw new ConsumptionStateError("INVALID_INPUT", "Confirm the exact consumption item set");
      for (const item of intent.items) {
        const planned = canonicalQuantity(source.find((row) => row.inventoryItemId === item.inventoryItemId)!.plannedQuantity);
        if ((cycle.status === "CANCELLED" && item.basis !== "OWNER_REPORTED") ||
          (item.usedQuantity !== planned && (item.basis !== "OWNER_REPORTED" || !item.reason)))
          throw new ConsumptionStateError("INVALID_INPUT", "Changed or cancelled use requires owner-reported quantities and a reason for changes");
      }
      const itemIds = source.map((row) => row.inventoryItemId);
      if ((await lockOwnedInventoryItems(tx, ownerId, itemIds)).length !== itemIds.length)
        throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      const ledger = await loadLockedStockLedger(tx, ownerId, itemIds);
      assertExpectedLedger(ledger, intent.expectedLedger);
      const shortages = intent.items.flatMap((item) => {
        const balance = ledger.find((row) => row.inventoryItemId === item.inventoryItemId)!.balance;
        return new StorageDecimal(balance).minus(item.usedQuantity).lt(0)
          ? [{ inventoryItemId: item.inventoryItemId, availableQuantity: balance, requiredQuantity: item.usedQuantity }] : [];
      });
      if (shortages.length) throw new ConsumptionStateError("INSUFFICIENT_STOCK", "Insufficient stock for confirmed use", { shortages });
      const operationId = randomUUID();
      const revisionId = randomUUID();
      const confirmedAt = clock.now();
      const revisionItems = source.map((row) => {
        const item = intent.items.find((i) => i.inventoryItemId === row.inventoryItemId)!;
        const initialCountMovementId = ledger.find((l) => l.inventoryItemId === row.inventoryItemId)!.countMovementId;
        const effect = calculateUseEffect({ previousUsed: null, newUsed: item.usedQuantity, initialCountMovementId,
          currentCountMovementId: initialCountMovementId, countSettled: false });
        return { ...item, ownerId, contextId: context!.id, revisionId, mode: effect.mode, quantityDelta: effect.delta,
          initialCountMovementId, movementId: randomUUID(), settlementCountMovementId: null };
      });
      const prepared: PreparedConsumptionOperation = {
        operation: { id: operationId, ownerId, requestId: intent.requestId, kind: "CONFIRM", canonicalManifest,
          resultRevisionIds: [revisionId], resultCountMovementIds: [] },
        revisions: [{ id: revisionId, ownerId, contextId: context!.id, operationId, revisionNumber: 1, previousRevisionId: null, reason: intent.reason }],
        revisionItems,
        usageMovements: revisionItems.map((row) => ({ id: row.movementId, ownerId, inventoryItemId: row.inventoryItemId,
          type: "CONSUMPTION", quantityDeltaInBaseUnit: row.quantityDelta, referenceType: "CONSUMPTION_REVISION", referenceId: revisionId,
          occurredAt: confirmedAt, notes: row.reason })),
        countMovements: [], pointerUpdates: [{ contextId: context!.id, expectedRevisionId: null, newRevisionId: revisionId }],
      };
      return writeConsumptionOperation(tx, ownerId, prepared, confirmedAt);
    });
  } catch (error) { rethrowConsumptionLockError(error); }
}
