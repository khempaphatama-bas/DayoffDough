import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedBakeCycle, lockOwnedCycleTask, lockOwnedOrderItems, lockOwnedOrders } from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { calculateOrderTotals } from "@/modules/orders/domain/totals";
import { buildOperationsCompletion } from "@/modules/operations/domain/rules";
import { completeCycleInputSchema, cycleOperationInputSchema } from "@/modules/operations/domain/forms";
import { OperationsStateError, type OperationsClock } from "@/modules/operations/domain/types";
import { cycleOrderSnapshots, cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";

const SYSTEM_CLOCK: OperationsClock = { now: () => new Date() };
const uuidSchema = z.string().uuid();
type Tx = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type StartInput = z.input<typeof cycleOperationInputSchema>;
type CompleteInput = z.input<typeof completeCycleInputSchema>;

function notFound(): never {
  throw new OperationsStateError("NOT_FOUND", "Operations record not found");
}

function stale(): never {
  throw new OperationsStateError("STALE_DATA", "Operations snapshot is stale");
}

function invalidCycle(): never {
  throw new OperationsStateError("INVALID_CYCLE_STATE", "Cycle is not in the required state");
}

function owner(ownerId: string): string {
  const parsed = uuidSchema.safeParse(ownerId);
  if (!parsed.success) notFound();
  return parsed.data;
}

async function lockCurrentGeneration(tx: Tx, ownerId: string, cycleId: string) {
  const cycle = await lockOwnedBakeCycle(tx, ownerId, cycleId);
  if (!cycle) notFound();
  if (!cycle.activePlanningSnapshotId) stale();
  const [snapshot] = await tx.select().from(cyclePlanningSnapshots).where(and(
    eq(cyclePlanningSnapshots.ownerId, ownerId),
    eq(cyclePlanningSnapshots.bakeCycleId, cycle.id),
    eq(cyclePlanningSnapshots.id, cycle.activePlanningSnapshotId),
  )).limit(1).for("update");
  if (!snapshot || snapshot.status !== "ACTIVE") stale();
  const [generation] = await tx.select().from(cycleTaskGenerations).where(and(
    eq(cycleTaskGenerations.ownerId, ownerId),
    eq(cycleTaskGenerations.bakeCycleId, cycle.id),
    eq(cycleTaskGenerations.planningSnapshotId, snapshot.id),
  )).limit(1).for("update");
  if (!generation || generation.generation !== snapshot.generation) stale();
  return { cycle, snapshot, generation };
}

async function currentCompletion(tx: Tx, ownerId: string, cycleId: string, snapshotId: string, generationId: string) {
  const taskCandidates = await tx.select({ id: cycleTasks.id }).from(cycleTasks).where(and(
    eq(cycleTasks.ownerId, ownerId),
    eq(cycleTasks.cycleTaskGenerationId, generationId),
    isNull(cycleTasks.deletedAt),
  ));
  const tasks = [];
  for (const taskId of taskCandidates.map((task) => task.id).sort()) {
    const task = await lockOwnedCycleTask(tx, ownerId, generationId, taskId);
    if (!task || task.deletedAt) stale();
    tasks.push(task);
  }
  const orderCandidates = await tx.select({ id: orders.id }).from(orders).where(and(
    eq(orders.ownerId, ownerId), eq(orders.bakeCycleId, cycleId),
  ));
  const lockedOrders = await lockOwnedOrders(tx, ownerId, orderCandidates.map((order) => order.id));
  if (lockedOrders.length !== orderCandidates.length || lockedOrders.some((order) => order.bakeCycleId !== cycleId)) stale();
  const snapshotOrders = await tx.select({ sourceOrderId: cycleOrderSnapshots.sourceOrderId })
    .from(cycleOrderSnapshots).where(and(
      eq(cycleOrderSnapshots.ownerId, ownerId),
      eq(cycleOrderSnapshots.planningSnapshotId, snapshotId),
    ));
  const currentIds = new Set(lockedOrders.filter((order) => order.fulfillmentStatus !== "CANCELLED").map((order) => order.id));
  const snapshotIds = snapshotOrders.map((order) => order.sourceOrderId);
  if (currentIds.size !== snapshotIds.length || snapshotIds.some((id) => !currentIds.has(id))) stale();

  const completionOrders = [];
  for (const order of lockedOrders) {
    if (order.fulfillmentStatus === "CANCELLED") continue;
    const itemCandidates = await tx.select({ id: orderItems.id }).from(orderItems).where(and(
      eq(orderItems.ownerId, ownerId), eq(orderItems.orderId, order.id), eq(orderItems.active, true),
    ));
    // All Orders are locked before their Order Items, preserving the shared lock order.
    const items = await lockOwnedOrderItems(tx, ownerId, itemCandidates.map((item) => item.id));
    if (items.length !== itemCandidates.length || items.some((item) => item.orderId !== order.id || !item.active)) stale();
    let totals;
    try {
      totals = calculateOrderTotals({
        items, discountSatang: order.discountSatang,
        deliveryFeeChargedSatang: order.deliveryFeeChargedSatang,
        amountPaidSatang: order.amountPaidSatang,
      });
    } catch {
      stale();
    }
    completionOrders.push({
      fulfillmentStatus: order.fulfillmentStatus,
      paymentStatus: order.paymentStatus,
      balanceSatang: totals.balanceSatang,
    });
  }
  return buildOperationsCompletion(tasks, completionOrders);
}

export function createCycleOperationsCommandService(db: DatabaseClient, clock: OperationsClock = SYSTEM_CLOCK) {
  return {
    async startCycle(ownerId: string, input: StartInput) {
      const verifiedOwner = owner(ownerId);
      const parsed = cycleOperationInputSchema.safeParse(input);
      if (!parsed.success) notFound();
      return db.transaction(async (tx) => {
        const { cycle, snapshot } = await lockCurrentGeneration(tx, verifiedOwner, parsed.data.cycleId);
        if (cycle.status === "IN_PRODUCTION") return cycle;
        if (cycle.status !== "LOCKED") invalidCycle();
        const [updated] = await tx.update(bakeCycles).set({ status: "IN_PRODUCTION", updatedAt: clock.now() })
          .where(and(
            eq(bakeCycles.ownerId, verifiedOwner), eq(bakeCycles.id, cycle.id),
            eq(bakeCycles.status, "LOCKED"), eq(bakeCycles.activePlanningSnapshotId, snapshot.id),
          )).returning();
        if (!updated) stale();
        return updated;
      });
    },
    async completeCycle(ownerId: string, input: CompleteInput) {
      const verifiedOwner = owner(ownerId);
      const parsed = completeCycleInputSchema.safeParse(input);
      if (!parsed.success) notFound();
      return db.transaction(async (tx) => {
        const { cycle, snapshot, generation } = await lockCurrentGeneration(tx, verifiedOwner, parsed.data.cycleId);
        if (generation.id !== parsed.data.expectedTaskGenerationId) stale();
        if (cycle.status !== "IN_PRODUCTION" && cycle.status !== "COMPLETED") invalidCycle();
        const completion = await currentCompletion(tx, verifiedOwner, cycle.id, snapshot.id, generation.id);
        if (!completion.ready) {
          throw new OperationsStateError("CYCLE_COMPLETION_BLOCKED", "Cycle has unfinished tasks or orders", {
            remainingTaskCount: completion.remainingTaskCount,
            remainingOrderCount: completion.remainingOrderCount,
          });
        }
        if (cycle.status === "COMPLETED") return { cycleStatus: "COMPLETED" as const, ...completion };
        const [updated] = await tx.update(bakeCycles).set({ status: "COMPLETED", updatedAt: clock.now() })
          .where(and(
            eq(bakeCycles.ownerId, verifiedOwner), eq(bakeCycles.id, cycle.id),
            eq(bakeCycles.status, "IN_PRODUCTION"), eq(bakeCycles.activePlanningSnapshotId, snapshot.id),
          )).returning();
        if (!updated) stale();
        return { cycleStatus: updated.status, ...completion };
      });
    },
  };
}
