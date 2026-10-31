import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/types";
import type { StockLedgerState } from "@/modules/inventory/application/stock-ledger";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { consumptionOperations, consumptionRevisions, consumptionRevisionItems, cycleConsumptionContexts } from "../db/schema";
import { ConsumptionStateError, type ConsumptionSource, type ConsumptionWriteResult, type LedgerExpectation } from "../domain/types";

type Tx = DatabaseTransaction;
type OperationInsert = typeof consumptionOperations.$inferInsert;
export type PreparedConsumptionOperation = Readonly<{
  operation: Omit<OperationInsert, "manifest" | "revisionIds" | "countMovementIds"> & {
    id: string; canonicalManifest: string;
    resultRevisionIds: readonly string[]; resultCountMovementIds: readonly string[];
  };
  revisions: readonly (typeof consumptionRevisions.$inferInsert)[];
  revisionItems: readonly (typeof consumptionRevisionItems.$inferInsert)[];
  usageMovements: readonly (typeof inventoryMovements.$inferInsert)[];
  countMovements: readonly (typeof inventoryMovements.$inferInsert)[];
  pointerUpdates: readonly { contextId: string; expectedRevisionId: string | null; newRevisionId: string }[];
}>;

export async function findExistingOperation(tx: Tx, ownerId: string, requestId: string, canonicalManifest: string): Promise<ConsumptionWriteResult | null> {
  const [operation] = await tx.select().from(consumptionOperations).where(and(
    eq(consumptionOperations.ownerId, ownerId), eq(consumptionOperations.requestId, requestId),
  ));
  if (!operation) return null;
  if (operation.manifest !== canonicalManifest) throw new ConsumptionStateError("REQUEST_CONFLICT", "Request ID was already used for different consumption");
  return { operationId: operation.id, revisionIds: operation.revisionIds, countMovementIds: operation.countMovementIds, replayed: true };
}

// Cycle locks must already be held. Receipt lookup precedes this source gate.
export async function lockConsumptionContexts(tx: Tx, ownerId: string, sources: readonly ConsumptionSource[]): Promise<void> {
  for (const source of [...sources].sort((a, b) => a.cycleId.localeCompare(b.cycleId) || a.contextId.localeCompare(b.contextId))) {
    const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(
      eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.bakeCycleId, source.cycleId),
      eq(cyclePlanningSnapshots.id, source.planningSnapshotId),
    )).for("update");
    const [context] = await tx.select().from(cycleConsumptionContexts).where(and(
      eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.id, source.contextId),
      eq(cycleConsumptionContexts.bakeCycleId, source.cycleId), eq(cycleConsumptionContexts.planningSnapshotId, source.planningSnapshotId),
    )).for("update");
    if (!snapshot || !context) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  }
}

export function assertExpectedLedger(actual: readonly StockLedgerState[], expected: readonly LedgerExpectation[]): void {
  if (actual.length !== expected.length || actual.some((row) => !expected.some((token) =>
    token.inventoryItemId === row.inventoryItemId && token.ledgerRevision === row.ledgerRevision && token.countMovementId === row.countMovementId))) {
    throw new ConsumptionStateError("STALE_DATA", "Stock changed; refresh and try again");
  }
}

export async function writeConsumptionOperation(tx: Tx, ownerId: string, prepared: PreparedConsumptionOperation, confirmedAt: Date): Promise<ConsumptionWriteResult> {
  const { canonicalManifest, resultRevisionIds, resultCountMovementIds, ...operation } = prepared.operation;
  // The unique owned key arbitrates races across different Cycle locks. A loser
  // reads the winner's committed immutable receipt, without retrying its writes.
  const inserted = await tx.insert(consumptionOperations).values({ ...operation, ownerId,
    manifest: canonicalManifest, revisionIds: [...resultRevisionIds], countMovementIds: [...resultCountMovementIds], createdAt: confirmedAt,
  }).onConflictDoNothing({ target: [consumptionOperations.ownerId, consumptionOperations.requestId] }).returning({ id: consumptionOperations.id });
  if (!inserted.length) {
    const existing = await findExistingOperation(tx, ownerId, operation.requestId, canonicalManifest);
    if (existing) return existing;
    throw new ConsumptionStateError("STALE_DATA", "Consumption changed; refresh and try again");
  }
  if (prepared.revisions.length) await tx.insert(consumptionRevisions).values(prepared.revisions.map((row) => ({ ...row, ownerId, confirmedAt })));
  // Only movement FKs are deferred: the durable lineage is present before an
  // event is applied, including the future settlement COUNT authority check.
  if (prepared.revisionItems.length) await tx.insert(consumptionRevisionItems).values(prepared.revisionItems.map((row) => ({ ...row, ownerId })));
  if (prepared.usageMovements.length) await tx.insert(inventoryMovements).values(prepared.usageMovements.map((row) => ({ ...row, ownerId, occurredAt: confirmedAt, createdAt: confirmedAt })));
  if (prepared.countMovements.length) await tx.insert(inventoryMovements).values(prepared.countMovements.map((row) => ({ ...row, ownerId, occurredAt: confirmedAt, createdAt: confirmedAt })));
  for (const pointer of prepared.pointerUpdates) {
    const updated = await tx.update(cycleConsumptionContexts).set({ currentRevisionId: pointer.newRevisionId }).where(and(
      eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.id, pointer.contextId),
      pointer.expectedRevisionId === null ? isNull(cycleConsumptionContexts.currentRevisionId) : eq(cycleConsumptionContexts.currentRevisionId, pointer.expectedRevisionId),
    )).returning({ id: cycleConsumptionContexts.id });
    if (!updated.length) throw new ConsumptionStateError("STALE_DATA", "Consumption changed; refresh and try again");
  }
  return { operationId: operation.id, revisionIds: [...resultRevisionIds], countMovementIds: [...resultCountMovementIds], replayed: false };
}
