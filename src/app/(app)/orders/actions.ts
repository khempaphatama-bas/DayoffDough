"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, type ZodIssue } from "zod";
import { and, eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createOrderService } from "@/modules/orders/application/orders";
import { orders } from "@/modules/orders/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { OperationsStateError } from "@/modules/operations/domain/types";
import {
  normalizeOrderForm,
  orderFormSchema,
} from "@/modules/orders/domain/order-form";

export type OrderActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
}>;

export type OrderStatusActionState = Readonly<{
  error: string | null;
  saved: boolean;
  operationsHref?: string;
}>;

const orderIdSchema = z.string().uuid();
const fulfillmentStatusFormSchema = z.object({
  orderId: orderIdSchema,
  cycleId: orderIdSchema.optional(),
  status: z.enum([
    "CONFIRMED",
    "IN_PRODUCTION",
    "PACKED",
    "DELIVERED",
  ]),
});
const cancelOrderFormSchema = z.object({
  orderId: orderIdSchema,
  status: z.literal("CANCELLED"),
});
const refundOrderFormSchema = z.object({
  orderId: orderIdSchema,
  status: z.literal("REFUNDED"),
});
const restorePaymentFormSchema = z.object({
  orderId: orderIdSchema,
  status: z.literal("RESTORE"),
});
const THAI_FIELD_ERRORS: Readonly<Record<string, string>> = {
  customerId: "กรุณาเลือกลูกค้า",
  bakeCycleId: "กรุณาเลือกรอบผลิต",
  sourceChannel: "ช่องทางออเดอร์ไม่ถูกต้อง",
  requestedDeliveryDate: "วันส่งที่ลูกค้าขอไม่ถูกต้อง",
  confirmedDeliveryDate: "วันส่งยืนยันไม่ถูกต้อง",
  confirmedDeliveryTime: "เวลานัดส่งไม่ถูกต้อง",
  deliveryMethodId: "วิธีจัดส่งไม่ถูกต้อง",
  deliveryFeeChargedBaht: "ค่าส่งที่เรียกเก็บไม่ถูกต้อง",
  deliveryCostBaht: "ต้นทุนจัดส่งไม่ถูกต้อง",
  deliveryFeePayer: "ผู้รับภาระค่าส่งไม่ถูกต้อง",
  discountBaht: "ส่วนลดต้องไม่เกินยอดสินค้าและค่าส่ง",
  amountPaidBaht: "ยอดชำระแล้วไม่ถูกต้อง",
  deliveryLocation: "สถานที่จัดส่งต้องไม่เกิน 2,000 ตัวอักษร",
  deliveryNote: "หมายเหตุการส่งต้องไม่เกิน 2,000 ตัวอักษร",
  specialInstructions: "คำสั่งพิเศษต้องไม่เกิน 2,000 ตัวอักษร",
  items: "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ",
  orderId: "รหัสออเดอร์ไม่ถูกต้อง",
};
const PRODUCTION_FROZEN_ERROR =
  "รอบผลิตถูกล็อก กรุณาปลดล็อกรอบก่อนแก้ข้อมูลนี้";

function isProductionFrozenError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Cycle production inputs are locked"
  );
}

function issueMessage(issue: ZodIssue): string {
  const field = issue.path.join(".");
  if (/^items\.\d+\.productId$/.test(field)) return "กรุณาเลือกสินค้า";
  if (/^items\.\d+\.quantity$/.test(field)) {
    return "จำนวนสินค้าต้องเป็นเลขจำนวนเต็มที่มากกว่า 0";
  }
  if (/^items\.\d+\.unitPriceBaht$/.test(field)) {
    return "ราคาต่อหน่วยไม่ถูกต้อง";
  }
  if (/^items\.\d+\.lineNote$/.test(field)) {
    return "หมายเหตุสินค้าต้องไม่เกิน 2,000 ตัวอักษร";
  }
  return THAI_FIELD_ERRORS[field] ?? "ข้อมูลไม่ถูกต้อง";
}

function toFieldErrors(
  issues: ReadonlyArray<ZodIssue>,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.join(".");
    errors[field] = issueMessage(issue);
  }
  return errors;
}

export async function saveOrderAction(
  _previousState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const owner = await requireOwner();
  const payload = formData.get("payload");
  let rawValues: unknown;

  try {
    if (typeof payload !== "string") throw new Error("Missing payload");
    rawValues = JSON.parse(payload);
  } catch {
    return {
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: {},
    };
  }

  const parsedValues = orderFormSchema.safeParse(rawValues);
  if (!parsedValues.success) {
    return {
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: toFieldErrors(parsedValues.error.issues),
    };
  }

  const rawOrderId = formData.get("orderId");
  const parsedOrderId =
    rawOrderId === null || rawOrderId === ""
      ? null
      : orderIdSchema.safeParse(rawOrderId);
  if (parsedOrderId !== null && !parsedOrderId.success) {
    return {
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: { orderId: THAI_FIELD_ERRORS.orderId! },
    };
  }

  let result: Awaited<
    ReturnType<ReturnType<typeof createOrderService>["create"]>
  >;
  try {
    const service = createOrderService(db);
    const input = normalizeOrderForm(parsedValues.data);
    result = parsedOrderId
      ? await service.update(owner.id, parsedOrderId.data, input)
      : await service.create(owner.id, input);
    revalidatePath("/orders");
    revalidatePath("/cycles");
    revalidatePath(`/cycles/${result.bakeCycleId}`);
    revalidatePath("/dashboard");
  } catch (error) {
    if (isProductionFrozenError(error)) {
      return { error: PRODUCTION_FROZEN_ERROR, fieldErrors: {} };
    }
    return {
      error: "บันทึกออเดอร์ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง",
      fieldErrors: {},
    };
  }

  redirect(`/orders/${result.id}`);
}

function revalidateOrderStatusPaths(
  order: Readonly<{
    id: string;
    bakeCycleId: string;
    customerId: string;
  }>,
): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/cycles");
  revalidatePath(`/cycles/${order.bakeCycleId}`);
  revalidatePath(`/customers/${order.customerId}`);
  revalidatePath("/dashboard");
}

export async function updateFulfillmentStatusAction(
  _previousState: OrderStatusActionState,
  formData: FormData,
): Promise<OrderStatusActionState> {
  const owner = await requireOwner();
  const parsed = fulfillmentStatusFormSchema.safeParse({
    orderId: formData.get("orderId"),
    cycleId: formData.get("cycleId") ?? undefined,
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบสถานะออเดอร์", saved: false };
  }
  let authoritativeCycleId: string | undefined;
  try {
    // IDs/status for routing are read independently of totals; command guards
    // still recheck ownership, lifecycle and adjacency under their own locks.
    const readOrder = async () => {
      const [order] = await db.select({
        id: orders.id, bakeCycleId: orders.bakeCycleId, customerId: orders.customerId, cycleStatus: bakeCycles.status,
      }).from(orders).innerJoin(bakeCycles, and(eq(bakeCycles.id, orders.bakeCycleId), eq(bakeCycles.ownerId, orders.ownerId)))
        .where(and(eq(orders.ownerId, owner.id), eq(orders.id, parsed.data.orderId))).limit(1);
      if (!order) throw new OperationsStateError("NOT_FOUND", "Operations record not found");
      return order;
    };
    const order = await readOrder();
    authoritativeCycleId = order.bakeCycleId;
    if (parsed.data.cycleId !== undefined && parsed.data.cycleId !== order.bakeCycleId) {
      throw new OperationsStateError("STALE_DATA", "Cycle membership changed");
    }
    const operations = createOrderOperationsCommandService(db);
    const single = { cycleId: order.bakeCycleId, orderId: order.id };
    const batch = { cycleId: order.bakeCycleId, orderIds: [order.id] };
    switch (parsed.data.status) {
      case "CONFIRMED":
        if (order.cycleStatus === "DRAFT" || order.cycleStatus === "OPEN") {
          await createOrderService(db).confirmBeforeProduction(owner.id, order.id);
        } else { await operations.confirmOrders(owner.id, batch); }
        break;
      case "IN_PRODUCTION": await operations.startOrders(owner.id, batch); break;
      case "PACKED": await operations.confirmOrderPacked(owner.id, single); break;
      case "DELIVERED": await operations.deliverOrders(owner.id, batch); break;
    }
    const affectedOrder = await readOrder();
    revalidateOrderStatusPaths(affectedOrder);
    for (const path of ["operations", "production", "planning"]) revalidatePath(`/cycles/${affectedOrder.bakeCycleId}/${path}`);
    return { error: null, saved: true };
  } catch (error) {
    if (error instanceof OperationsStateError) {
      if (error.kind === "PACKING_INCOMPLETE" && authoritativeCycleId) {
        return {
          error: "ยังแพ็กสินค้าไม่ครบ กรุณาบันทึกจำนวนที่แพ็กในหน้าปฏิบัติงานรอบผลิต",
          operationsHref: `/cycles/${authoritativeCycleId}/operations`, saved: false,
        };
      }
      const messages = {
        NOT_FOUND: "ไม่พบข้อมูลสำหรับการปฏิบัติงาน",
        STALE_DATA: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด",
        INVALID_CYCLE_STATE: "สถานะรอบผลิตไม่อนุญาตให้ทำรายการนี้",
        INVALID_ORDER_STATE: "สถานะออเดอร์ไม่อนุญาตให้ทำรายการนี้",
      };
      return { error: error.kind in messages ? messages[error.kind as keyof typeof messages] : "อัปเดตสถานะออเดอร์ไม่สำเร็จ กรุณาลองอีกครั้ง", saved: false };
    }
    console.error("Order fulfillment action failed");
    return {
      error: "อัปเดตสถานะออเดอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    };
  }
}

export async function cancelOrderAction(
  _previousState: OrderStatusActionState,
  formData: FormData,
): Promise<OrderStatusActionState> {
  const owner = await requireOwner();
  const parsed = cancelOrderFormSchema.safeParse({
    orderId: formData.get("orderId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบการยกเลิกออเดอร์", saved: false };
  }

  try {
    const order = await createOrderService(db).cancel(
      owner.id,
      parsed.data.orderId,
    );
    revalidateOrderStatusPaths(order);
    return { error: null, saved: true };
  } catch (error) {
    if (isProductionFrozenError(error)) {
      return { error: PRODUCTION_FROZEN_ERROR, saved: false };
    }
    return {
      error: "ยกเลิกออเดอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    };
  }
}

export async function markOrderRefundedAction(
  _previousState: OrderStatusActionState,
  formData: FormData,
): Promise<OrderStatusActionState> {
  const owner = await requireOwner();
  const parsed = refundOrderFormSchema.safeParse({
    orderId: formData.get("orderId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบสถานะการชำระเงิน", saved: false };
  }

  try {
    const order = await createOrderService(db).markRefunded(
      owner.id,
      parsed.data.orderId,
    );
    revalidateOrderStatusPaths(order);
    return { error: null, saved: true };
  } catch {
    return {
      error: "บันทึกการคืนเงินไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    };
  }
}

export async function restoreOrderPaymentTrackingAction(
  _previousState: OrderStatusActionState,
  formData: FormData,
): Promise<OrderStatusActionState> {
  const owner = await requireOwner();
  const parsed = restorePaymentFormSchema.safeParse({
    orderId: formData.get("orderId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบสถานะการชำระเงิน", saved: false };
  }

  try {
    const order = await createOrderService(db).restorePaymentTracking(
      owner.id,
      parsed.data.orderId,
    );
    revalidateOrderStatusPaths(order);
    return { error: null, saved: true };
  } catch {
    return {
      error: "คืนค่าการติดตามการชำระเงินไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    };
  }
}
