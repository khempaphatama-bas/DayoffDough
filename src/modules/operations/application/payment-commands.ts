import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedBakeCycle, lockOwnedOrder, lockOwnedOrderItems } from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { calculateOrderTotals } from "@/modules/orders/domain/totals";
import { paymentTargetInputSchema } from "@/modules/operations/domain/forms";
import { OperationsStateError, type OperationsClock } from "@/modules/operations/domain/types";

const SYSTEM_CLOCK: OperationsClock = { now: () => new Date() };
const uuidSchema = z.string().uuid();
type PaymentInput = z.input<typeof paymentTargetInputSchema>;

function notFound(): never {
  throw new OperationsStateError("NOT_FOUND", "Operations record not found");
}

function outOfRange(): never {
  throw new OperationsStateError("PAYMENT_OUT_OF_RANGE", "Payment target is outside the order total");
}

function stale(): never {
  throw new OperationsStateError("STALE_DATA", "Operations snapshot is stale");
}

export function createPaymentOperationsCommandService(db: DatabaseClient, clock: OperationsClock = SYSTEM_CLOCK) {
  return {
    async setOrderAmountPaid(ownerId: string, input: PaymentInput) {
      const parsedOwner = uuidSchema.safeParse(ownerId);
      if (!parsedOwner.success) notFound();
      const parsed = paymentTargetInputSchema.safeParse(input);
      if (!parsed.success) {
        if (parsed.error.issues.length > 0 && parsed.error.issues.every((issue) =>
          issue.path[0] === "targetAmountPaidSatang" || issue.path[0] === "expectedAmountPaidSatang")) outOfRange();
        notFound();
      }
      const verifiedOwner = parsedOwner.data;
      return db.transaction(async (tx) => {
        // Discover only. Lock order is Cycle -> Order -> active items.
        const [candidate] = await tx.select({ bakeCycleId: orders.bakeCycleId }).from(orders).where(and(
          eq(orders.ownerId, verifiedOwner), eq(orders.id, parsed.data.orderId),
        )).limit(1);
        if (!candidate) notFound();
        const cycle = await lockOwnedBakeCycle(tx, verifiedOwner, candidate.bakeCycleId);
        if (!cycle) notFound();
        const order = await lockOwnedOrder(tx, verifiedOwner, parsed.data.orderId);
        if (!order || order.bakeCycleId !== cycle.id) notFound();
        if (cycle.status === "CANCELLED") {
          throw new OperationsStateError("INVALID_CYCLE_STATE", "Cycle is read-only");
        }
        if (order.fulfillmentStatus === "CANCELLED" || order.paymentStatus === "REFUNDED") {
          throw new OperationsStateError("INVALID_ORDER_STATE", "Order payment is read-only");
        }

        const candidateItems = await tx.select({ id: orderItems.id }).from(orderItems).where(and(
          eq(orderItems.ownerId, verifiedOwner), eq(orderItems.orderId, order.id), eq(orderItems.active, true),
        ));
        const items = await lockOwnedOrderItems(tx, verifiedOwner, candidateItems.map((item) => item.id));
        if (items.length !== candidateItems.length || items.some((item) => item.orderId !== order.id || !item.active)) stale();
        let total;
        try {
          total = calculateOrderTotals({
            items,
            discountSatang: order.discountSatang,
            deliveryFeeChargedSatang: order.deliveryFeeChargedSatang,
            amountPaidSatang: order.amountPaidSatang,
          });
        } catch {
          outOfRange();
        }
        if (parsed.data.targetAmountPaidSatang > total.grandTotalSatang) outOfRange();
        const result = (amountPaidSatang: number, paymentStatus: "UNPAID" | "PARTIAL" | "PAID") => ({
          orderId: order.id,
          grandTotalSatang: total.grandTotalSatang,
          amountPaidSatang,
          balanceSatang: total.grandTotalSatang - amountPaidSatang,
          paymentStatus,
        });
        if (order.amountPaidSatang === parsed.data.targetAmountPaidSatang) {
          return result(order.amountPaidSatang, total.paymentStatus);
        }
        if (order.amountPaidSatang !== parsed.data.expectedAmountPaidSatang) stale();
        const paymentStatus = parsed.data.targetAmountPaidSatang === 0 ? "UNPAID"
          : parsed.data.targetAmountPaidSatang === total.grandTotalSatang ? "PAID" : "PARTIAL";
        const [updated] = await tx.update(orders).set({
          amountPaidSatang: parsed.data.targetAmountPaidSatang,
          paymentStatus,
          updatedAt: clock.now(),
        }).where(and(
          eq(orders.ownerId, verifiedOwner), eq(orders.id, order.id),
          eq(orders.amountPaidSatang, order.amountPaidSatang),
        )).returning();
        if (!updated) stale();
        return result(updated.amountPaidSatang, paymentStatus);
      });
    },
  };
}
