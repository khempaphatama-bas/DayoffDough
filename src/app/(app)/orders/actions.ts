"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, type ZodIssue } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createOrderService } from "@/modules/orders/application/orders";
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
}>;

const orderIdSchema = z.string().uuid();
const fulfillmentStatusFormSchema = z.object({
  orderId: orderIdSchema,
  status: z.enum([
    "NEW",
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
  deliveryMethodId: "วิธีจัดส่งไม่ถูกต้อง",
  deliveryFeeChargedBaht: "ค่าส่งที่เรียกเก็บไม่ถูกต้อง",
  deliveryCostBaht: "ต้นทุนจัดส่งไม่ถูกต้อง",
  deliveryFeePayer: "ผู้รับภาระค่าส่งไม่ถูกต้อง",
  discountBaht: "ส่วนลดไม่ถูกต้อง",
  amountPaidBaht: "ยอดชำระแล้วไม่ถูกต้อง",
  deliveryLocation: "สถานที่จัดส่งต้องไม่เกิน 2,000 ตัวอักษร",
  deliveryNote: "หมายเหตุการส่งต้องไม่เกิน 2,000 ตัวอักษร",
  specialInstructions: "คำสั่งพิเศษต้องไม่เกิน 2,000 ตัวอักษร",
  items: "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ",
  orderId: "รหัสออเดอร์ไม่ถูกต้อง",
};

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
  } catch {
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
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบสถานะออเดอร์", saved: false };
  }

  try {
    const order = await createOrderService(db).updateFulfillmentStatus(
      owner.id,
      parsed.data.orderId,
      parsed.data.status,
    );
    revalidateOrderStatusPaths(order);
    return { error: null, saved: true };
  } catch {
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
  } catch {
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
