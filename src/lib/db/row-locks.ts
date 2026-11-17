import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryItems } from "@/modules/inventory/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { orderItemPackingProgress } from "@/modules/operations/db/schema";
import { cycleTasks } from "@/modules/production/db/schema";
import { products } from "@/modules/products/db/schema";

type LockingReader = Pick<DatabaseClient, "select">;

export async function lockOwnedProducts(
  reader: LockingReader,
  ownerId: string,
  productIds: readonly string[],
): Promise<(typeof products.$inferSelect)[]> {
  const rows: (typeof products.$inferSelect)[] = [];
  for (const productId of [...new Set(productIds)].sort()) {
    const [product] = await reader.select().from(products)
      .where(and(eq(products.ownerId, ownerId), eq(products.id, productId)))
      .limit(1).for("update");
    if (product) rows.push(product);
  }
  return rows;
}

export async function lockOwnedBakeCycle(
  reader: LockingReader,
  ownerId: string,
  cycleId: string,
) {
  const [cycle] = await reader
    .select()
    .from(bakeCycles)
    .where(
      and(eq(bakeCycles.ownerId, ownerId), eq(bakeCycles.id, cycleId)),
    )
    .limit(1)
    .for("update");
  return cycle;
}

export async function lockOwnedBakeCycles(
  reader: LockingReader,
  ownerId: string,
  cycleIds: ReadonlyArray<string>,
) {
  const cycles: Array<NonNullable<Awaited<ReturnType<typeof lockOwnedBakeCycle>>>> = [];
  const sortedCycleIds = [...new Set(cycleIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const cycleId of sortedCycleIds) {
    const cycle = await lockOwnedBakeCycle(reader, ownerId, cycleId);
    if (cycle) cycles.push(cycle);
  }
  return cycles;
}

export async function lockOwnedInventoryItems(
  reader: LockingReader,
  ownerId: string,
  itemIds: ReadonlyArray<string>,
) {
  const rows: Array<typeof inventoryItems.$inferSelect> = [];
  for (const itemId of [...new Set(itemIds)].sort()) {
    const [item] = await reader
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.ownerId, ownerId),
          eq(inventoryItems.id, itemId),
        ),
      )
      .limit(1)
      .for("update");
    if (item) rows.push(item);
  }
  return rows;
}

export async function lockOwnedOrder(
  reader: LockingReader,
  ownerId: string,
  orderId: string,
) {
  const [order] = await reader
    .select()
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), eq(orders.id, orderId)))
    .limit(1)
    .for("update");
  return order;
}

export async function lockOwnedOrders(
  reader: LockingReader,
  ownerId: string,
  orderIds: ReadonlyArray<string>,
) {
  const rows: Array<typeof orders.$inferSelect> = [];
  for (const orderId of [...new Set(orderIds)].sort()) {
    const order = await lockOwnedOrder(reader, ownerId, orderId);
    if (order) rows.push(order);
  }
  return rows;
}

export async function lockOwnedOrderItem(
  reader: LockingReader,
  ownerId: string,
  itemId: string,
) {
  const [item] = await reader.select().from(orderItems)
    .where(and(eq(orderItems.ownerId, ownerId), eq(orderItems.id, itemId)))
    .limit(1).for("update");
  return item;
}

export async function lockOwnedOrderItems(
  reader: LockingReader,
  ownerId: string,
  itemIds: ReadonlyArray<string>,
) {
  const rows: Array<typeof orderItems.$inferSelect> = [];
  for (const itemId of [...new Set(itemIds)].sort()) {
    const item = await lockOwnedOrderItem(reader, ownerId, itemId);
    if (item) rows.push(item);
  }
  return rows;
}

export async function lockOwnedPackingProgress(
  reader: LockingReader,
  ownerId: string,
  itemId: string,
) {
  const [progress] = await reader.select().from(orderItemPackingProgress)
    .where(and(eq(orderItemPackingProgress.ownerId, ownerId), eq(orderItemPackingProgress.orderItemId, itemId)))
    .limit(1).for("update");
  return progress;
}

export async function lockOwnedCycleTask(
  reader: LockingReader,
  ownerId: string,
  taskGenerationId: string,
  taskId: string,
) {
  const [task] = await reader
    .select()
    .from(cycleTasks)
    .where(
      and(
        eq(cycleTasks.ownerId, ownerId),
        eq(cycleTasks.cycleTaskGenerationId, taskGenerationId),
        eq(cycleTasks.id, taskId),
      ),
    )
    .limit(1)
    .for("update");
  return task;
}
