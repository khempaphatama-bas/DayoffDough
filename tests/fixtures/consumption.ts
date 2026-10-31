import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { cycleTaskGenerations } from "@/modules/production/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { loadShoppingSource } from "@/modules/shopping/application/load-shopping-source";
import { createShoppingCommandService } from "@/modules/shopping/application/shopping-commands";
import { OWNER_ID } from "./owner";
import { seedLockedPlanningScenario } from "./planning";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { cycleConsumptionContexts, cycleConsumptionItems } from "@/modules/consumption/db/schema";
import type { ConfirmUseInput } from "@/modules/consumption/domain/types";
import { canonicalQuantity } from "@/modules/consumption/domain/rules";
import { canonicalizeUseRequest } from "@/modules/consumption/domain/request-manifest";
import type { PreparedConsumptionOperation } from "@/modules/consumption/application/command-support";

// Complete legitimate initial-use rows for raw SQL integrity tests. Quantities
// follow the immutable source, and callers mutate only the attack under test.
export async function prepareConsumptionFixture(db: DatabaseClient, ownerId: string, cycleId: string) {
  const [context] = await db.select().from(cycleConsumptionContexts).where(and(eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.bakeCycleId, cycleId)));
  if (!context) throw new Error("Fixture requires a started consumption context");
  const source = await db.select().from(cycleConsumptionItems).where(and(eq(cycleConsumptionItems.ownerId, ownerId), eq(cycleConsumptionItems.contextId, context.id))).orderBy(cycleConsumptionItems.inventoryItemId);
  const ledger = await readStockLedger(db, ownerId, source.map((row) => row.inventoryItemId));
  const input: ConfirmUseInput = { cycleId, planningSnapshotId: context.planningSnapshotId, contextId: context.id,
    requestId: randomUUID(), items: source.map((row) => ({ inventoryItemId: row.inventoryItemId, usedQuantity: canonicalQuantity(row.plannedQuantity), basis: "PLANNED", reason: null })),
    expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
    confirmTakenOutOfUse: true, confirmEmpty: source.length === 0, reason: source.length === 0 ? "No planned inventory" : null };
  const operationId = randomUUID();
  const revisionId = randomUUID();
  const confirmedAt = new Date("2026-10-24T12:00:00Z");
  const revisionItems = input.items.map((item) => ({ ...item, ownerId, contextId: context.id, revisionId,
    mode: "DIRECT" as const, quantityDelta: item.usedQuantity === "0" ? "0" : `-${item.usedQuantity}`,
    initialCountMovementId: ledger.find((row) => row.inventoryItemId === item.inventoryItemId)!.countMovementId,
    movementId: randomUUID(), settlementCountMovementId: null }));
  const prepared: PreparedConsumptionOperation = {
    operation: { id: operationId, ownerId, requestId: input.requestId, kind: "CONFIRM", canonicalManifest: canonicalizeUseRequest("CONFIRM", input), resultRevisionIds: [revisionId], resultCountMovementIds: [] },
    revisions: [{ id: revisionId, ownerId, contextId: context.id, operationId, revisionNumber: 1, previousRevisionId: null, reason: input.reason }],
    revisionItems,
    usageMovements: revisionItems.map((item) => ({ id: item.movementId, ownerId, inventoryItemId: item.inventoryItemId, type: "CONSUMPTION", quantityDeltaInBaseUnit: item.quantityDelta,
      referenceType: "CONSUMPTION_REVISION", referenceId: revisionId, occurredAt: confirmedAt, notes: item.reason })),
    countMovements: [], pointerUpdates: [{ contextId: context.id, expectedRevisionId: null, newRevisionId: revisionId }],
  };
  return { input, prepared, confirmedAt };
}

export async function confirmConsumptionStock(db: DatabaseClient, ownerId: string, cycleId: string, planningSnapshotId?: string) {
  if (!planningSnapshotId) {
    const [cycle] = await db.select().from(bakeCycles).where(and(eq(bakeCycles.ownerId, ownerId), eq(bakeCycles.id, cycleId)));
    if (!cycle?.activePlanningSnapshotId) throw new Error("Fixture needs a current plan");
    planningSnapshotId = cycle.activePlanningSnapshotId;
  }
  const source = await loadShoppingSource(db, ownerId, planningSnapshotId);
  if (source.length) await createShoppingCommandService(db).confirmStock(ownerId, {
    cycleId, planningSnapshotId, confirmationRequestId: randomUUID(), countedAt: new Date(),
    counts: source.map((item) => ({ inventoryItemId: item.inventoryItemId, countedQuantity: item.requiredQuantity })),
  });
}

export async function seedConsumptionScenario(db: DatabaseClient, input: {
  ownerId?: string; idSet?: "PRIMARY" | "SECONDARY"; start?: boolean;
} = {}) {
  const ownerId = input.ownerId ?? OWNER_ID;
  const s = await seedLockedPlanningScenario(db, input);
  const [generation] = await db.select().from(cycleTaskGenerations).where(and(
    eq(cycleTaskGenerations.ownerId, ownerId), eq(cycleTaskGenerations.planningSnapshotId, s.planningSnapshotId),
  ));
  await confirmConsumptionStock(db, ownerId, s.cycleId, s.planningSnapshotId);
  if (input.start !== false) await createCycleOperationsCommandService(db).startCycle(ownerId, { cycleId: s.cycleId });
  return { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: generation!.id,
    itemIds: [s.ingredientItemId, s.packagingItemId] };
}
