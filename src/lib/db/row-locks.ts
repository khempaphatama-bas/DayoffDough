import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryItems } from "@/modules/inventory/db/schema";
import { orders } from "@/modules/orders/db/schema";
import { cycleTasks } from "@/modules/production/db/schema";

type LockingReader = Pick<DatabaseClient, "select">;

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
