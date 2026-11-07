import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { lockOwnedBakeCycles, lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { loadLockedStockLedger } from "@/modules/inventory/application/stock-ledger";
import { inventoryItems } from "@/modules/inventory/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { StorageDecimal, assertNumeric18_6 } from "@/modules/shopping/domain/storage";
import { cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";
import { settleUseInputSchema } from "../domain/forms";
import { canonicalizeUseRequest } from "../domain/request-manifest";
import { calculateUseEffect } from "../domain/rules";
import { ConsumptionStateError, type SettleUseInput, type ConsumptionClock, type ConsumptionWriteResult } from "../domain/types";
import { assertExpectedLedger, assertUsageProvenance, findExistingOperation, lockConsumptionContexts, writeConsumptionOperation, type PreparedConsumptionOperation } from "./command-support";
import { assertExactPendingContexts, findPendingConsumption, rethrowConsumptionLockError } from "./count-barrier";

export async function settleUse(db: DatabaseClient, clock: ConsumptionClock, ownerId: string, input: SettleUseInput): Promise<ConsumptionWriteResult> {
  const parsed = settleUseInputSchema.safeParse(input);
  if (!parsed.success || !parsed.data.counts.length) throw new ConsumptionStateError("INVALID_INPUT", "Select at least one item and provide complete settlement quantities");
  const intent = parsed.data;
  const canonicalManifest = canonicalizeUseRequest("SETTLE", intent);
  const countedIds = intent.counts.map((row) => row.inventoryItemId).sort();
  // Discovery never locks. Missing/new candidates are rejected after submitted
  // Cycle locks, never acquired downstream of the sorted inventory locks.
  const discovered = await findPendingConsumption(db, ownerId, countedIds);
  try {
    return await db.transaction(async (tx) => {
      const cycles = await lockOwnedBakeCycles(tx, ownerId, intent.contexts.map((c) => c.cycleId));
      if (cycles.length !== intent.contexts.length) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      const existing = await findExistingOperation(tx, ownerId, intent.requestId, canonicalManifest);
      if (existing) return existing;
      await lockConsumptionContexts(tx, ownerId, intent.contexts);
      const ownedCounts = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(and(
        eq(inventoryItems.ownerId, ownerId), inArray(inventoryItems.id, countedIds),
      ));
      if (ownedCounts.length !== countedIds.length) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      assertExactPendingContexts(discovered, intent.contexts);
      const contexts = [...intent.contexts].sort((a, b) => a.cycleId.localeCompare(b.cycleId) || a.contextId.localeCompare(b.contextId));
      const sources = [];
      for (const context of contexts) {
        const cycle = cycles.find((c) => c.id === context.cycleId)!;
        const [stored] = await tx.select().from(cycleConsumptionContexts).where(and(eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.id, context.contextId)));
        const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.id, context.planningSnapshotId)));
        if (cycle.consumptionPolicy !== "CONSUMPTION_V1" || !["IN_PRODUCTION", "CANCELLED"].includes(cycle.status))
          throw new ConsumptionStateError("INVALID_CYCLE_STATE", "Cycle is not ready to settle consumption");
        if (cycle.activePlanningSnapshotId !== context.planningSnapshotId || snapshot!.status !== "ACTIVE" || stored!.currentRevisionId !== null)
          throw new ConsumptionStateError("STALE_DATA", "Consumption source is stale");
        const source = await tx.select().from(cycleConsumptionItems).where(and(eq(cycleConsumptionItems.ownerId, ownerId), eq(cycleConsumptionItems.contextId, context.contextId))).orderBy(cycleConsumptionItems.inventoryItemId);
        assertUsageProvenance(source, context.items, cycle.status);
        sources.push(...source);
      }
      const itemIds = [...new Set(sources.map((s) => s.inventoryItemId))].sort();
      if (countedIds.some((id) => !itemIds.includes(id))) throw new ConsumptionStateError("INVALID_INPUT", "Every counted item must belong to pending consumption");
      if ((await lockOwnedInventoryItems(tx, ownerId, itemIds)).length !== itemIds.length)
        throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
      assertExactPendingContexts(await findPendingConsumption(tx, ownerId, countedIds), contexts);
      const ledger = await loadLockedStockLedger(tx, ownerId, itemIds);
      assertExpectedLedger(ledger, intent.expectedLedger);
      const shortages = ledger.flatMap((row) => {
        if (countedIds.includes(row.inventoryItemId)) return [];
        const required = contexts.flatMap((c) => c.items).filter((i) => i.inventoryItemId === row.inventoryItemId)
          .reduce((sum, i) => sum.plus(i.usedQuantity), new StorageDecimal(0));
        try { assertNumeric18_6(required.toFixed(), "Total consumption"); }
        catch { throw new ConsumptionStateError("INVALID_INPUT", "Total consumption exceeds supported quantity"); }
        return required.gt(row.balance) ? [{ inventoryItemId: row.inventoryItemId, availableQuantity: row.balance, requiredQuantity: required.toFixed() }] : [];
      });
      if (shortages.length) throw new ConsumptionStateError("INSUFFICIENT_STOCK", "Insufficient stock for confirmed use", { shortages });
      const operationId = randomUUID();
      const confirmedAt = clock.now();
      const countIds = new Map(countedIds.map((id) => [id, randomUUID()]));
      const revisions = contexts.map((context) => ({ id: randomUUID(), ownerId, contextId: context.contextId,
        operationId, revisionNumber: 1, previousRevisionId: null, reason: intent.reason }));
      const revisionItems = contexts.flatMap((context, index) => [...context.items].sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId)).map((item) => {
        const initialCountMovementId = ledger.find((l) => l.inventoryItemId === item.inventoryItemId)!.countMovementId;
        const settlementCountMovementId = countIds.get(item.inventoryItemId) ?? null;
        const effect = calculateUseEffect({ previousUsed: null, newUsed: item.usedQuantity, initialCountMovementId,
          currentCountMovementId: initialCountMovementId, countSettled: settlementCountMovementId !== null });
        return { ...item, ownerId, contextId: context.contextId, revisionId: revisions[index]!.id, mode: effect.mode,
          quantityDelta: effect.delta, initialCountMovementId, movementId: randomUUID(), settlementCountMovementId };
      }));
      const prepared: PreparedConsumptionOperation = {
        operation: { id: operationId, ownerId, requestId: intent.requestId, kind: "SETTLE", canonicalManifest,
          resultRevisionIds: revisions.map((r) => r.id), resultCountMovementIds: countedIds.map((id) => countIds.get(id)!) },
        revisions, revisionItems,
        usageMovements: revisionItems.map((i) => ({ id: i.movementId, ownerId, inventoryItemId: i.inventoryItemId, type: "CONSUMPTION",
          quantityDeltaInBaseUnit: i.quantityDelta, referenceType: "CONSUMPTION_REVISION", referenceId: i.revisionId, occurredAt: confirmedAt, notes: i.reason })),
        countMovements: countedIds.map((id) => ({ id: countIds.get(id)!, ownerId, inventoryItemId: id, type: "COUNT",
          quantityDeltaInBaseUnit: new StorageDecimal(intent.counts.find((c) => c.inventoryItemId === id)!.remainingQuantity).minus(ledger.find((l) => l.inventoryItemId === id)!.balance).toFixed(),
          countedQuantityInBaseUnit: intent.counts.find((c) => c.inventoryItemId === id)!.remainingQuantity,
          referenceType: "CONSUMPTION_OPERATION", referenceId: operationId, occurredAt: confirmedAt, notes: intent.reason })),
        pointerUpdates: revisions.map((r) => ({ contextId: r.contextId, expectedRevisionId: null, newRevisionId: r.id })),
      };
      return writeConsumptionOperation(tx, ownerId, prepared, confirmedAt);
    });
  } catch (error) { rethrowConsumptionLockError(error); }
}
