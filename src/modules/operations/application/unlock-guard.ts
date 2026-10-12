import { and, eq, gt, inArray } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { orderItemPackingProgress } from "@/modules/operations/db/schema";
import { OperationsStateError } from "@/modules/operations/domain/types";

export async function assertCycleOperationsUnlockAllowed(
  reader: Pick<DatabaseClient, "select">,
  ownerId: string,
  cycleId: string,
): Promise<void> {
  const operationalOrders = await reader
    .select({ id: orders.id })
    .from(orders)
    .where(and(
      eq(orders.ownerId, ownerId),
      eq(orders.bakeCycleId, cycleId),
      inArray(orders.fulfillmentStatus, ["IN_PRODUCTION", "PACKED", "DELIVERED"]),
    ))
    .limit(1);

  const positiveProgress = await reader
    .select({ id: orderItemPackingProgress.id })
    .from(orderItemPackingProgress)
    .innerJoin(orderItems, and(
      eq(orderItems.ownerId, orderItemPackingProgress.ownerId),
      eq(orderItems.id, orderItemPackingProgress.orderItemId),
    ))
    .innerJoin(orders, and(
      eq(orders.ownerId, orderItems.ownerId),
      eq(orders.id, orderItems.orderId),
    ))
    .where(and(
      eq(orderItemPackingProgress.ownerId, ownerId),
      eq(orders.bakeCycleId, cycleId),
      gt(orderItemPackingProgress.packedQuantity, 0),
    ))
    .limit(1);

  if (operationalOrders.length > 0 || positiveProgress.length > 0) {
    throw new OperationsStateError(
      "UNLOCK_BLOCKED_BY_OPERATIONS",
      "Cycle operations have started",
    );
  }
}
