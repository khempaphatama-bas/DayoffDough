import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orders } from "@/modules/orders/db/schema";

type LockingReader = Pick<DatabaseClient, "select">;

export async function lockOwnedBakeCycle(
  reader: LockingReader,
  ownerId: string,
  cycleId: string,
) {
  const [cycle] = await reader
    .select({ id: bakeCycles.id, status: bakeCycles.status })
    .from(bakeCycles)
    .where(
      and(eq(bakeCycles.ownerId, ownerId), eq(bakeCycles.id, cycleId)),
    )
    .limit(1)
    .for("update");
  return cycle;
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
