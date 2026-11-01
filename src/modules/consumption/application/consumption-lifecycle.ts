import { and, eq, gt } from "drizzle-orm";
import { lockOwnedBakeCycle, lockOwnedInventoryItems } from "@/lib/db/row-locks";
import type { DatabaseTransaction } from "@/lib/db/types";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { cycleTaskGenerations } from "@/modules/production/db/schema";
import { cycleInventoryCounts } from "@/modules/shopping/db/schema";
import { consumptionRevisionItems, cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";
import { ConsumptionStateError } from "../domain/types";
import { loadConsumptionSource } from "./load-consumption-source";

async function lockLifecycleContext(tx: DatabaseTransaction, ownerId: string, cycleId: string, planningSnapshotId: string) {
  const cycle = await lockOwnedBakeCycle(tx, ownerId, cycleId);
  if (!cycle) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(
    eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.bakeCycleId, cycleId),
    eq(cyclePlanningSnapshots.id, planningSnapshotId),
  )).for("update");
  if (!snapshot) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  if (cycle.activePlanningSnapshotId !== snapshot.id || snapshot.status !== "ACTIVE")
    throw new ConsumptionStateError("STALE_DATA", "Consumption source is stale");
  const [context] = await tx.select().from(cycleConsumptionContexts).where(and(
    eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.bakeCycleId, cycleId),
    eq(cycleConsumptionContexts.planningSnapshotId, planningSnapshotId),
  )).for("update");
  return { cycle, context };
}

export async function assertConsumptionCompleteAllowed(tx: DatabaseTransaction, ownerId: string, cycleId: string, planningSnapshotId: string): Promise<void> {
  const { cycle, context } = await lockLifecycleContext(tx, ownerId, cycleId, planningSnapshotId);
  if (cycle.consumptionPolicy === "CONSUMPTION_V1" && !context?.currentRevisionId)
    throw new ConsumptionStateError("PENDING_USE", "Record consumption before completing this cycle");
}

export async function assertConsumptionUnlockAllowed(tx: DatabaseTransaction, ownerId: string, cycleId: string, planningSnapshotId: string): Promise<void> {
  const { cycle, context } = await lockLifecycleContext(tx, ownerId, cycleId, planningSnapshotId);
  if (cycle.consumptionPolicy !== "CONSUMPTION_V1") return;
  // A never-started locked generation has nothing to settle. Once started,
  // explicit recording is required even when every absolute target is zero.
  if (!context && cycle.status === "LOCKED") return;
  if (!context?.currentRevisionId)
    throw new ConsumptionStateError("UNLOCK_BLOCKED", "Record pending consumption before unlocking this cycle");
  const positiveHistory = await tx.select({ revisionId: consumptionRevisionItems.revisionId }).from(consumptionRevisionItems).where(and(
    eq(consumptionRevisionItems.ownerId, ownerId), eq(consumptionRevisionItems.contextId, context.id),
    gt(consumptionRevisionItems.usedQuantity, "0"),
  )).limit(1);
  if (positiveHistory.length)
    throw new ConsumptionStateError("UNLOCK_BLOCKED", "A cycle with recorded positive use cannot be unlocked");
}

export async function registerPendingConsumption(tx: DatabaseTransaction, ownerId: string, input: {
  cycleId: string; planningSnapshotId: string; taskGenerationId: string;
}): Promise<{ contextId: string }> {
  const cycle = await lockOwnedBakeCycle(tx, ownerId, input.cycleId);
  if (!cycle) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(
    eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.bakeCycleId, cycle.id),
    eq(cyclePlanningSnapshots.id, input.planningSnapshotId),
  )).for("update");
  const [generation] = await tx.select().from(cycleTaskGenerations).where(and(
    eq(cycleTaskGenerations.ownerId, ownerId), eq(cycleTaskGenerations.bakeCycleId, cycle.id),
    eq(cycleTaskGenerations.planningSnapshotId, input.planningSnapshotId), eq(cycleTaskGenerations.id, input.taskGenerationId),
  )).for("update");
  if (!snapshot || !generation) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  if (cycle.activePlanningSnapshotId !== snapshot.id || snapshot.status !== "ACTIVE" || snapshot.generation !== generation.generation)
    throw new ConsumptionStateError("STALE_DATA", "Consumption source is stale");
  const [existing] = await tx.select().from(cycleConsumptionContexts).where(and(
    eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.bakeCycleId, cycle.id),
    eq(cycleConsumptionContexts.planningSnapshotId, snapshot.id),
  )).for("update");
  if (existing && existing.taskGenerationId === generation.id) return { contextId: existing.id };
  if (cycle.consumptionPolicy !== "CONSUMPTION_V1" || cycle.status !== "LOCKED")
    throw new ConsumptionStateError("INVALID_CYCLE_STATE", "Cycle is not ready to register consumption");
  const source = await loadConsumptionSource(tx, ownerId, snapshot.id);
  const lockedItems = await lockOwnedInventoryItems(tx, ownerId, source.map((item) => item.inventoryItemId));
  if (lockedItems.length !== source.length) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  const counts = await tx.select().from(cycleInventoryCounts).where(and(
    eq(cycleInventoryCounts.ownerId, ownerId), eq(cycleInventoryCounts.bakeCycleId, cycle.id), eq(cycleInventoryCounts.planningSnapshotId, snapshot.id),
  ));
  if (counts.length !== source.length || source.some((item) => !counts.some((count) => count.inventoryItemId === item.inventoryItemId)))
    throw new ConsumptionStateError("STOCK_CHECK_REQUIRED", "Confirm current-generation stock before starting production");
  const [context] = await tx.insert(cycleConsumptionContexts).values({ ownerId, bakeCycleId: cycle.id,
    planningSnapshotId: snapshot.id, taskGenerationId: generation.id }).returning();
  if (source.length) await tx.insert(cycleConsumptionItems).values(source.map((item) => ({
    ...item, ownerId, contextId: context!.id, planningSnapshotId: snapshot.id,
  })));
  return { contextId: context!.id };
}
