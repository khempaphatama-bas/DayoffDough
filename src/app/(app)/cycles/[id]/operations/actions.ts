"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { createPaymentOperationsCommandService } from "@/modules/operations/application/payment-commands";
import {
  batchOrderOperationInputSchema, completeCycleInputSchema, cycleOperationInputSchema,
  orderOperationInputSchema, packingQuantityInputSchema, paymentTargetInputSchema,
} from "@/modules/operations/domain/forms";
import { OperationsStateError, type OperationsErrorKind } from "@/modules/operations/domain/types";
import { createConsumptionActionSupport } from "@/modules/consumption/application/action-support";
import { ConsumptionStateError, type ConsumptionStateErrorKind, type ConsumptionBlocker } from "@/modules/consumption/domain/types";

export type OperationsActionState = Readonly<{
  error: string | null;
  kind: "INVALID_INPUT" | OperationsErrorKind | ConsumptionStateErrorKind | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
  blockers?: readonly ConsumptionBlocker[];
}>;

const THAI_OPERATIONS_ERRORS: Readonly<Record<OperationsErrorKind, string>> = {
  NOT_FOUND: "ไม่พบข้อมูลสำหรับการปฏิบัติงาน",
  STALE_DATA: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด",
  INVALID_CYCLE_STATE: "สถานะรอบผลิตไม่อนุญาตให้ทำรายการนี้",
  INVALID_ORDER_STATE: "สถานะออเดอร์ไม่อนุญาตให้ทำรายการนี้",
  PACKING_INCOMPLETE: "ยังแพ็กสินค้าไม่ครบ กรุณาตรวจสอบจำนวนที่แพ็ก",
  PACKED_QUANTITY_OUT_OF_RANGE: "จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึงจำนวนที่สั่ง",
  PAYMENT_OUT_OF_RANGE: "ยอดชำระต้องอยู่ระหว่าง 0 ถึงยอดรวมออเดอร์",
  UNLOCK_BLOCKED_BY_OPERATIONS: "ปลดล็อกรอบไม่ได้ เพราะเริ่มทำออเดอร์แล้ว",
  CYCLE_COMPLETION_BLOCKED: "ยังจบรอบไม่ได้ กรุณาทำงานและจัดส่งออเดอร์ให้ครบ",
};

function operationsErrorState(error: unknown): OperationsActionState {
  if (!(error instanceof OperationsStateError)) {
    // Never log raw errors: database messages can contain customer or payload data.
    console.error("Operations action failed");
    return { error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง", kind: null, fieldErrors: {}, saved: false };
  }
  const fieldErrors: Record<string, string> = {};
  if (error.kind === "PACKED_QUANTITY_OUT_OF_RANGE") {
    const quantity = error.details.quantity;
    if (typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity >= 0) {
      fieldErrors.packedQuantity = `จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึง ${quantity}`;
    }
  }
  return { error: THAI_OPERATIONS_ERRORS[error.kind], kind: error.kind, fieldErrors, saved: false };
}

function readPayload(formData: FormData): unknown {
  const payloads = formData.getAll("payload");
  if (payloads.length !== 1 || typeof payloads[0] !== "string") throw new Error("Invalid payload");
  const payload: unknown = JSON.parse(payloads[0]);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload");
  return payload;
}

type AffectedViews = Readonly<{ cycleId: string; orderIds?: readonly string[] }>;

function revalidateOperationsViews({ cycleId, orderIds = [] }: AffectedViews): void {
  for (const path of [
    `/cycles/${cycleId}/operations`, `/cycles/${cycleId}/production`, `/cycles/${cycleId}/planning`,
    `/cycles/${cycleId}`, "/cycles", "/orders", "/dashboard",
  ]) revalidatePath(path);
  for (const orderId of orderIds) revalidatePath(`/orders/${orderId}`);
}

async function runOperation<T>(
  formData: FormData, schema: z.ZodType<T>, execute: (input: T) => Promise<AffectedViews>, ownerId: string,
): Promise<OperationsActionState> {
  let payload: unknown;
  try { payload = readPayload(formData); } catch {
    return { error: "กรุณาตรวจสอบข้อมูล", kind: "INVALID_INPUT", fieldErrors: {}, saved: false };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = "ข้อมูลไม่ถูกต้อง";
    return { error: "กรุณาตรวจสอบข้อมูล", kind: "INVALID_INPUT", fieldErrors, saved: false };
  }
  try {
    revalidateOperationsViews(await execute(parsed.data));
    return { error: null, kind: null, fieldErrors: {}, saved: true };
  } catch (error) {
    if (error instanceof ConsumptionStateError) {
      try {
        const cycleId = typeof parsed.data === "object" && parsed.data !== null && "cycleId" in parsed.data && typeof parsed.data.cycleId === "string" ? parsed.data.cycleId : undefined;
        const safe = await createConsumptionActionSupport(db).mapError(ownerId, error, cycleId);
        if (safe) return { error: safe.error, kind: error.kind, fieldErrors: safe.fieldErrors, saved: false, blockers: safe.blockers };
      } catch { /* Do not expose a failed owned lookup. */ }
    }
    return operationsErrorState(error);
  }
}

async function ownedOrderViews(ownerId: string, orderId: string): Promise<AffectedViews> {
  const [order] = await db.select({ id: orders.id, bakeCycleId: orders.bakeCycleId }).from(orders)
    .where(and(eq(orders.ownerId, ownerId), eq(orders.id, orderId))).limit(1);
  if (!order) throw new OperationsStateError("NOT_FOUND", "Operations record not found");
  return { cycleId: order.bakeCycleId, orderIds: [order.id] };
}

export async function startCycleAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, cycleOperationInputSchema, async (input) => {
    await createCycleOperationsCommandService(db).startCycle(owner.id, input);
    return { cycleId: input.cycleId };
  }, owner.id);
}

export async function confirmOrdersAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, batchOrderOperationInputSchema, async (input) => {
    await createOrderOperationsCommandService(db).confirmOrders(owner.id, input);
    return input;
  }, owner.id);
}

export async function startOrdersAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, batchOrderOperationInputSchema, async (input) => {
    await createOrderOperationsCommandService(db).startOrders(owner.id, input);
    return input;
  }, owner.id);
}

export async function setPackedQuantityAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, packingQuantityInputSchema, async (input) => {
    await createOrderOperationsCommandService(db).setPackedQuantity(owner.id, input);
    const [parent] = await db.select({ orderId: orders.id, bakeCycleId: orders.bakeCycleId }).from(orderItems)
      .innerJoin(orders, and(eq(orders.ownerId, orderItems.ownerId), eq(orders.id, orderItems.orderId)))
      .where(and(eq(orderItems.ownerId, owner.id), eq(orderItems.id, input.orderItemId))).limit(1);
    if (!parent) throw new OperationsStateError("NOT_FOUND", "Operations record not found");
    return { cycleId: parent.bakeCycleId, orderIds: [parent.orderId] };
  }, owner.id);
}

export async function confirmOrderPackedAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, orderOperationInputSchema, async (input) => {
    await createOrderOperationsCommandService(db).confirmOrderPacked(owner.id, input);
    return { cycleId: input.cycleId, orderIds: [input.orderId] };
  }, owner.id);
}

export async function reopenOrderPackingAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, orderOperationInputSchema, async (input) => {
    await createOrderOperationsCommandService(db).reopenOrderPacking(owner.id, input);
    return { cycleId: input.cycleId, orderIds: [input.orderId] };
  }, owner.id);
}

export async function setOrderAmountPaidAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, paymentTargetInputSchema, async (input) => {
    await createPaymentOperationsCommandService(db).setOrderAmountPaid(owner.id, input);
    return ownedOrderViews(owner.id, input.orderId);
  }, owner.id);
}

export async function deliverOrdersAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, batchOrderOperationInputSchema, async (input) => {
    await createOrderOperationsCommandService(db).deliverOrders(owner.id, input);
    return input;
  }, owner.id);
}

export async function completeCycleAction(_previousState: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  const owner = await requireOwner();
  return runOperation(formData, completeCycleInputSchema, async (input) => {
    await createCycleOperationsCommandService(db).completeCycle(owner.id, input);
    return { cycleId: input.cycleId };
  }, owner.id);
}
