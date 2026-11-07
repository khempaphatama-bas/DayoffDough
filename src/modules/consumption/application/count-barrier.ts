import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";
import { ConsumptionStateError, type ConsumptionSource } from "../domain/types";

export function assertExactPendingContexts(pending: readonly ConsumptionSource[], submitted: readonly ConsumptionSource[]): void {
  if (pending.length !== submitted.length || pending.some((row) => !submitted.some((input) =>
    input.contextId === row.contextId && input.cycleId === row.cycleId && input.planningSnapshotId === row.planningSnapshotId))) {
    throw new ConsumptionStateError("STALE_DATA", "Pending consumption changed; refresh and try again");
  }
}

// Drizzle wraps PostgreSQL errors in cause. Preserve unrelated/domain errors,
// and never leak SQL or retry a non-idempotent write on upstream lock contention.
export function rethrowConsumptionLockError(error: unknown): never {
  const visited = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "55P03") throw new ConsumptionStateError("STALE_DATA", "Stock changed; refresh and try again");
    current = candidate.cause;
  }
  throw error;
}

export async function findPendingConsumption(
  reader: Pick<DatabaseClient, "select">, ownerId: string, itemIds: readonly string[],
): Promise<readonly { cycleId: string; cycleName: string; contextId: string; planningSnapshotId: string }[]> {
  if (!itemIds.length) return [];
  const rows = await reader.select({
    cycleId: bakeCycles.id, cycleName: bakeCycles.name,
    contextId: cycleConsumptionContexts.id, planningSnapshotId: cycleConsumptionContexts.planningSnapshotId,
  }).from(cycleConsumptionContexts).innerJoin(bakeCycles, and(
    eq(bakeCycles.ownerId, cycleConsumptionContexts.ownerId), eq(bakeCycles.id, cycleConsumptionContexts.bakeCycleId),
  )).innerJoin(cycleConsumptionItems, and(
    eq(cycleConsumptionItems.ownerId, cycleConsumptionContexts.ownerId), eq(cycleConsumptionItems.contextId, cycleConsumptionContexts.id),
  )).where(and(eq(cycleConsumptionContexts.ownerId, ownerId), isNull(cycleConsumptionContexts.currentRevisionId),
    inArray(cycleConsumptionItems.inventoryItemId, [...itemIds]),
  )).orderBy(bakeCycles.id, cycleConsumptionContexts.id);
  return [...new Map(rows.map((row) => [row.contextId, row])).values()];
}

// Caller owns sorted item locks. Do not acquire Cycle locks from this item-first path.
export async function assertNoPendingConsumption(tx: DatabaseTransaction, ownerId: string, itemIds: readonly string[]): Promise<void> {
  const pending = await findPendingConsumption(tx, ownerId, itemIds);
  if (pending.length) throw new ConsumptionStateError("PENDING_USE", "Record pending consumption before counting stock", {
    blockerCycleIds: [...new Set(pending.map((row) => row.cycleId))],
  });
}
