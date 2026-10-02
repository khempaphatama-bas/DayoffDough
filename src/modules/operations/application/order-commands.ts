import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  lockOwnedBakeCycle,
  lockOwnedOrder,
  lockOwnedOrderItem,
  lockOwnedOrderItems,
  lockOwnedOrders,
  lockOwnedPackingProgress,
} from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { orderItemPackingProgress } from "@/modules/operations/db/schema";
import {
  batchOrderOperationInputSchema,
  orderOperationInputSchema,
  packingQuantityInputSchema,
} from "@/modules/operations/domain/forms";
import { OperationsStateError, type OperationsClock } from "@/modules/operations/domain/types";
import {
  cycleOrderItemSnapshots,
  cycleOrderSnapshots,
  cyclePlanningSnapshots,
} from "@/modules/planning/db/schema";
import { cycleTaskGenerations } from "@/modules/production/db/schema";

const SYSTEM_CLOCK: OperationsClock = { now: () => new Date() };
const uuidSchema = z.string().uuid();
type Tx = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type BatchInput = z.input<typeof batchOrderOperationInputSchema>;
type OrderInput = z.input<typeof orderOperationInputSchema>;
type PackingInput = z.input<typeof packingQuantityInputSchema>;

function notFound(): never {
  throw new OperationsStateError("NOT_FOUND", "Operations record not found");
}

function stale(): never {
  throw new OperationsStateError("STALE_DATA", "Operations snapshot is stale");
}

function invalidCycle(): never {
  throw new OperationsStateError("INVALID_CYCLE_STATE", "Cycle is not in the required state");
}

function invalidOrder(): never {
  throw new OperationsStateError("INVALID_ORDER_STATE", "Order is not in the required state");
}

function owner(ownerId: string): string {
  const parsed = uuidSchema.safeParse(ownerId);
  if (!parsed.success) notFound();
  return parsed.data;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) notFound();
  return result.data;
}

function parsePacking(input: unknown) {
  const result = packingQuantityInputSchema.safeParse(input);
  if (result.success) return result.data;
  if (result.error.issues.length > 0 && result.error.issues.every((issue) =>
    issue.path[0] === "packedQuantity" || issue.path[0] === "expectedPackedQuantity")) {
    throw new OperationsStateError("PACKED_QUANTITY_OUT_OF_RANGE", "Packed quantity must be a non-negative integer");
  }
  notFound();
}

async function lockCurrentCycle(tx: Tx, ownerId: string, cycleId: string) {
  const cycle = await lockOwnedBakeCycle(tx, ownerId, cycleId);
  if (!cycle) notFound();
  if (cycle.status !== "LOCKED" && cycle.status !== "IN_PRODUCTION") invalidCycle();
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
  if (!generation) stale();
  return { cycle, snapshot, generation };
}

async function requireOrderSnapshot(tx: Tx, ownerId: string, snapshotId: string, orderId: string) {
  const [snapshotOrder] = await tx.select().from(cycleOrderSnapshots).where(and(
    eq(cycleOrderSnapshots.ownerId, ownerId),
    eq(cycleOrderSnapshots.planningSnapshotId, snapshotId),
    eq(cycleOrderSnapshots.sourceOrderId, orderId),
  )).limit(1);
  if (!snapshotOrder) notFound();
  return snapshotOrder;
}

async function requireOrders(tx: Tx, ownerId: string, cycleId: string, snapshotId: string, orderIds: readonly string[]) {
  const rows = await lockOwnedOrders(tx, ownerId, orderIds);
  if (rows.length !== orderIds.length) notFound();
  const snapshotOrders = new Map<string, string>();
  for (const row of rows) {
    if (row.bakeCycleId !== cycleId) notFound();
    const snapshotOrder = await requireOrderSnapshot(tx, ownerId, snapshotId, row.id);
    snapshotOrders.set(row.id, snapshotOrder.id);
  }
  const candidateItems = await tx.select({ id: orderItems.id }).from(orderItems).where(and(
    eq(orderItems.ownerId, ownerId), inArray(orderItems.orderId, rows.map((row) => row.id)),
    eq(orderItems.active, true),
  ));
  const items = await lockOwnedOrderItems(tx, ownerId, candidateItems.map((item) => item.id));
  const snapshotItems = await tx.select().from(cycleOrderItemSnapshots).where(and(
    eq(cycleOrderItemSnapshots.ownerId, ownerId),
    eq(cycleOrderItemSnapshots.planningSnapshotId, snapshotId),
    inArray(cycleOrderItemSnapshots.sourceOrderId, rows.map((row) => row.id)),
  ));
  if (items.length !== snapshotItems.length) stale();
  const snapshotItemsById = new Map(snapshotItems.map((item) => [item.sourceOrderItemId, item]));
  for (const item of items) {
    const snapshotItem = snapshotItemsById.get(item.id);
    if (!item.active || !snapshotItem || snapshotItem.sourceOrderId !== item.orderId
      || snapshotItem.orderSnapshotId !== snapshotOrders.get(item.orderId)) stale();
  }
  return rows;
}

async function requireItemSnapshot(tx: Tx, ownerId: string, snapshotId: string, orderSnapshotId: string, item: typeof orderItems.$inferSelect) {
  if (!item.active) notFound();
  const [snapshotItem] = await tx.select().from(cycleOrderItemSnapshots).where(and(
    eq(cycleOrderItemSnapshots.ownerId, ownerId),
    eq(cycleOrderItemSnapshots.planningSnapshotId, snapshotId),
    eq(cycleOrderItemSnapshots.orderSnapshotId, orderSnapshotId),
    eq(cycleOrderItemSnapshots.sourceOrderItemId, item.id),
    eq(cycleOrderItemSnapshots.sourceOrderId, item.orderId),
  )).limit(1);
  if (!snapshotItem) notFound();
  return snapshotItem;
}

async function transitionBatch(
  db: DatabaseClient,
  clock: OperationsClock,
  ownerId: string,
  input: BatchInput,
  from: "NEW" | "CONFIRMED" | "PACKED",
  target: "CONFIRMED" | "IN_PRODUCTION" | "DELIVERED",
) {
  const verifiedOwner = owner(ownerId);
  const parsed = parse(batchOrderOperationInputSchema, input);
  return db.transaction(async (tx) => {
    const { cycle, snapshot } = await lockCurrentCycle(tx, verifiedOwner, parsed.cycleId);
    if (target !== "CONFIRMED" && cycle.status !== "IN_PRODUCTION") invalidCycle();
    const rows = await requireOrders(tx, verifiedOwner, cycle.id, snapshot.id, parsed.orderIds);
    for (const row of rows) {
      if (row.fulfillmentStatus !== from && row.fulfillmentStatus !== target) invalidOrder();
    }
    const result = [];
    for (const row of rows) {
      if (row.fulfillmentStatus === target) { result.push(row); continue; }
      const [updated] = await tx.update(orders).set({ fulfillmentStatus: target, updatedAt: clock.now() })
        .where(and(eq(orders.ownerId, verifiedOwner), eq(orders.id, row.id))).returning();
      if (!updated) notFound();
      result.push(updated);
    }
    return result;
  });
}

export function createOrderOperationsCommandService(db: DatabaseClient, clock: OperationsClock = SYSTEM_CLOCK) {
  return {
    confirmOrders(ownerId: string, input: BatchInput) {
      return transitionBatch(db, clock, ownerId, input, "NEW", "CONFIRMED");
    },
    startOrders(ownerId: string, input: BatchInput) {
      return transitionBatch(db, clock, ownerId, input, "CONFIRMED", "IN_PRODUCTION");
    },
    deliverOrders(ownerId: string, input: BatchInput) {
      return transitionBatch(db, clock, ownerId, input, "PACKED", "DELIVERED");
    },
    async setPackedQuantity(ownerId: string, input: PackingInput) {
      const verifiedOwner = owner(ownerId);
      const parsed = parsePacking(input);
      return db.transaction(async (tx) => {
        const { cycle, snapshot } = await lockCurrentCycle(tx, verifiedOwner, parsed.cycleId);
        if (cycle.status !== "IN_PRODUCTION") invalidCycle();
        // Read only to discover the parent Order; the actual item is locked after the Order.
        const [candidate] = await tx.select().from(orderItems).where(and(
          eq(orderItems.ownerId, verifiedOwner), eq(orderItems.id, parsed.orderItemId),
        )).limit(1);
        if (!candidate) notFound();
        const order = await lockOwnedOrder(tx, verifiedOwner, candidate.orderId);
        if (!order || order.bakeCycleId !== cycle.id) notFound();
        const snapshotOrder = await requireOrderSnapshot(tx, verifiedOwner, snapshot.id, order.id);
        const item = await lockOwnedOrderItem(tx, verifiedOwner, candidate.id);
        if (!item || item.orderId !== order.id) notFound();
        await requireItemSnapshot(tx, verifiedOwner, snapshot.id, snapshotOrder.id, item);
        if (order.fulfillmentStatus !== "IN_PRODUCTION") invalidOrder();
        if (parsed.packedQuantity > item.quantity) {
          throw new OperationsStateError("PACKED_QUANTITY_OUT_OF_RANGE", "Packed quantity exceeds item quantity", { quantity: item.quantity });
        }
        const progress = await lockOwnedPackingProgress(tx, verifiedOwner, item.id);
        const current = progress?.packedQuantity ?? 0;
        if (current === parsed.packedQuantity) return progress ?? { ownerId: verifiedOwner, orderItemId: item.id, packedQuantity: 0 };
        if (current !== parsed.expectedPackedQuantity) stale();
        if (progress) {
          const [updated] = await tx.update(orderItemPackingProgress)
            .set({ packedQuantity: parsed.packedQuantity, updatedAt: clock.now() })
            .where(and(eq(orderItemPackingProgress.ownerId, verifiedOwner), eq(orderItemPackingProgress.orderItemId, item.id)))
            .returning();
          if (!updated) stale();
          return updated;
        }
        const [created] = await tx.insert(orderItemPackingProgress).values({
          ownerId: verifiedOwner,
          orderItemId: item.id,
          packedQuantity: parsed.packedQuantity,
          createdAt: clock.now(),
          updatedAt: clock.now(),
        }).returning();
        if (!created) stale();
        return created;
      });
    },
    async confirmOrderPacked(ownerId: string, input: OrderInput) {
      const verifiedOwner = owner(ownerId);
      const parsed = parse(orderOperationInputSchema, input);
      return db.transaction(async (tx) => {
        const { cycle, snapshot } = await lockCurrentCycle(tx, verifiedOwner, parsed.cycleId);
        if (cycle.status !== "IN_PRODUCTION") invalidCycle();
        const [order] = await requireOrders(tx, verifiedOwner, cycle.id, snapshot.id, [parsed.orderId]);
        if (!order) notFound();
        if (order.fulfillmentStatus === "PACKED") return order;
        if (order.fulfillmentStatus !== "IN_PRODUCTION") invalidOrder();
        const snapshotOrder = await requireOrderSnapshot(tx, verifiedOwner, snapshot.id, order.id);
        const candidateItems = await tx.select({ id: orderItems.id }).from(orderItems).where(and(
          eq(orderItems.ownerId, verifiedOwner), eq(orderItems.orderId, order.id), eq(orderItems.active, true),
        ));
        const items = await lockOwnedOrderItems(tx, verifiedOwner, candidateItems.map((item) => item.id));
        if (items.length === 0) {
          throw new OperationsStateError("PACKING_INCOMPLETE", "Order has no active items");
        }
        for (const item of items) await requireItemSnapshot(tx, verifiedOwner, snapshot.id, snapshotOrder.id, item);
        for (const item of items) {
          const progress = await lockOwnedPackingProgress(tx, verifiedOwner, item.id);
          if ((progress?.packedQuantity ?? 0) !== item.quantity) {
            throw new OperationsStateError("PACKING_INCOMPLETE", "Order packing is incomplete");
          }
        }
        const [updated] = await tx.update(orders).set({ fulfillmentStatus: "PACKED", updatedAt: clock.now() })
          .where(and(eq(orders.ownerId, verifiedOwner), eq(orders.id, order.id))).returning();
        if (!updated) notFound();
        return updated;
      });
    },
    async reopenOrderPacking(ownerId: string, input: OrderInput) {
      const verifiedOwner = owner(ownerId);
      const parsed = parse(orderOperationInputSchema, input);
      return db.transaction(async (tx) => {
        const { cycle, snapshot } = await lockCurrentCycle(tx, verifiedOwner, parsed.cycleId);
        if (cycle.status !== "IN_PRODUCTION") invalidCycle();
        const [order] = await requireOrders(tx, verifiedOwner, cycle.id, snapshot.id, [parsed.orderId]);
        if (!order) notFound();
        if (order.fulfillmentStatus === "IN_PRODUCTION") return order;
        if (order.fulfillmentStatus !== "PACKED") invalidOrder();
        const [updated] = await tx.update(orders).set({ fulfillmentStatus: "IN_PRODUCTION", updatedAt: clock.now() })
          .where(and(eq(orders.ownerId, verifiedOwner), eq(orders.id, order.id))).returning();
        if (!updated) notFound();
        return updated;
      });
    },
  };
}
