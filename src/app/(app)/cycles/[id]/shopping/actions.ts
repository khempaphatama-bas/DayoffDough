"use server";

import { revalidatePath } from "next/cache";
import type { ZodIssue } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import {
  createShoppingCommandService,
  ShoppingStateError,
  ShoppingValidationError,
} from "@/modules/shopping/application/shopping-commands";
import {
  confirmStockInputSchema,
  recordPurchaseInputSchema,
} from "@/modules/shopping/domain/forms";

export type StockActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
  stale: boolean;
}>;

export type PurchaseActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
  stale: boolean;
}>;

type ShoppingOperation = "confirm_stock" | "record_purchase";

const INVALID_INPUT_ERROR = "กรุณาตรวจสอบข้อมูลที่กรอก";
const STALE_PLAN_ERROR = "แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด";
const COUNT_QUANTITY_ERROR =
  "จำนวนที่นับจริงต้องเป็นเลขไม่ติดลบ ทศนิยมไม่เกิน 6 ตำแหน่ง";
const PACK_COUNT_ERROR = "จำนวนแพ็กต้องเป็นเลขจำนวนเต็มที่มากกว่า 0";
const TOTAL_PRICE_ERROR =
  "ราคารวมต้องเป็นเงินบาทไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง";

function unsavedState(
  error: string,
  fieldErrors: Readonly<Record<string, string>> = {},
  stale = false,
): StockActionState {
  return { error, fieldErrors, saved: false, stale };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function readOptionalString(
  formData: FormData,
  name: string,
): string | undefined {
  const value = readString(formData, name);
  return value === undefined || value.trim() === "" ? undefined : value;
}

function parseDate(value: unknown): Date {
  return typeof value === "string" ? new Date(value) : new Date(Number.NaN);
}

function stockFieldErrors(
  issues: ReadonlyArray<ZodIssue>,
  rawPayload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const rawCounts = Array.isArray(rawPayload.counts) ? rawPayload.counts : [];
  for (const issue of issues) {
    const countIndex = issue.path[0] === "counts" ? issue.path[1] : null;
    const countField = issue.path[0] === "counts" ? issue.path[2] : null;
    const rawCount =
      typeof countIndex === "number" ? rawCounts[countIndex] : undefined;
    const inventoryItemId =
      isRecord(rawCount) && typeof rawCount.inventoryItemId === "string"
        ? rawCount.inventoryItemId
        : null;

    if (countField === "countedQuantity") {
      const field =
        inventoryItemId === null
          ? `counts.${String(countIndex)}.countedQuantity`
          : `countedQuantity.${inventoryItemId}`;
      errors[field] = COUNT_QUANTITY_ERROR;
      continue;
    }

    const field = issue.path.join(".") || "payload";
    errors[field] =
      field === "counts"
        ? "กรุณากรอกยอดนับให้ครบทุกวัตถุดิบ"
        : "ข้อมูลยืนยันสต๊อกไม่ถูกต้อง";
  }
  return errors;
}

const PURCHASE_FIELD_ERRORS: Readonly<Record<string, string>> = {
  cycleId: "รหัสรอบอบไม่ถูกต้อง",
  planningSnapshotId: "รหัสแผนการผลิตไม่ถูกต้อง",
  shoppingItemId: "รหัสรายการซื้อไม่ถูกต้อง",
  purchaseRequestId: "รหัสคำขอบันทึกการซื้อไม่ถูกต้อง",
  packCount: PACK_COUNT_ERROR,
  totalPriceSatang: TOTAL_PRICE_ERROR,
  purchasedFrom: "ชื่อร้านต้องไม่เกิน 200 ตัวอักษร",
  occurredAt: "วันและเวลาที่ซื้อไม่ถูกต้อง",
  notes: "หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร",
};

function purchaseFieldErrors(
  issues: ReadonlyArray<ZodIssue>,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const schemaField = issue.path.join(".") || "form";
    const field =
      schemaField === "totalPriceSatang" ? "totalPriceBaht" : schemaField;
    errors[field] =
      PURCHASE_FIELD_ERRORS[schemaField] ?? "ข้อมูลการซื้อไม่ถูกต้อง";
  }
  return errors;
}

function revalidateShoppingViews(cycleId: string): void {
  for (const path of [
    "/cycles",
    `/cycles/${cycleId}`,
    `/cycles/${cycleId}/planning`,
    `/cycles/${cycleId}/shopping`,
    "/inventory",
    "/dashboard",
  ]) {
    revalidatePath(path);
  }
}

function logUnexpectedFailure(
  operation: ShoppingOperation,
  ownerId: string,
  cycleId: string,
  requestId: string,
): void {
  console.error("shopping_action_failed", {
    operation,
    ownerId,
    cycleId,
    requestId,
  });
}

function commandFailureState(
  error: unknown,
  operation: ShoppingOperation,
  ownerId: string,
  cycleId: string,
  requestId: string,
): StockActionState {
  if (error instanceof ShoppingStateError) {
    return unsavedState(STALE_PLAN_ERROR, {}, true);
  }
  if (error instanceof ShoppingValidationError) {
    return unsavedState(INVALID_INPUT_ERROR);
  }
  logUnexpectedFailure(operation, ownerId, cycleId, requestId);
  return unsavedState(
    operation === "confirm_stock"
      ? "ระบบยืนยันสต๊อกไม่สำเร็จ กรุณาลองอีกครั้ง"
      : "ระบบบันทึกการซื้อไม่สำเร็จ กรุณาลองอีกครั้ง",
  );
}

export async function confirmCycleStockAction(
  _previousState: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  const owner = await requireOwner();
  const payloadField = formData.get("payload");
  if (typeof payloadField !== "string") {
    return unsavedState(INVALID_INPUT_ERROR, {
      payload: "ข้อมูลยืนยันสต๊อกไม่ถูกต้อง",
    });
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloadField);
  } catch {
    return unsavedState(INVALID_INPUT_ERROR, {
      payload: "ข้อมูลยืนยันสต๊อกไม่ถูกต้อง",
    });
  }
  if (!isRecord(rawPayload)) {
    return unsavedState(INVALID_INPUT_ERROR, {
      payload: "ข้อมูลยืนยันสต๊อกไม่ถูกต้อง",
    });
  }

  const parsed = confirmStockInputSchema.safeParse({
    ...rawPayload,
    countedAt: parseDate(rawPayload.countedAt),
  });
  if (!parsed.success) {
    return unsavedState(
      INVALID_INPUT_ERROR,
      stockFieldErrors(parsed.error.issues, rawPayload),
    );
  }

  try {
    await createShoppingCommandService(db).confirmStock(owner.id, parsed.data);
    revalidateShoppingViews(parsed.data.cycleId);
    return { error: null, fieldErrors: {}, saved: true, stale: false };
  } catch (error) {
    return commandFailureState(
      error,
      "confirm_stock",
      owner.id,
      parsed.data.cycleId,
      parsed.data.confirmationRequestId,
    );
  }
}

export async function recordCyclePurchaseAction(
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  const owner = await requireOwner();
  const packCountField = readString(formData, "packCount");
  const totalPriceBahtField = readString(formData, "totalPriceBaht");
  const immediateFieldErrors: Record<string, string> = {};

  const packCount =
    packCountField !== undefined && /^\d+$/.test(packCountField)
      ? Number(packCountField)
      : Number.NaN;
  if (!Number.isSafeInteger(packCount) || packCount <= 0) {
    immediateFieldErrors.packCount = PACK_COUNT_ERROR;
  }

  let totalPriceSatang = Number.NaN;
  try {
    if (totalPriceBahtField === undefined) throw new Error("Missing Baht input");
    totalPriceSatang = parseBahtToSatang(totalPriceBahtField);
  } catch {
    immediateFieldErrors.totalPriceBaht = TOTAL_PRICE_ERROR;
  }

  if (Object.keys(immediateFieldErrors).length > 0) {
    return unsavedState(INVALID_INPUT_ERROR, immediateFieldErrors);
  }

  const parsed = recordPurchaseInputSchema.safeParse({
    cycleId: readString(formData, "cycleId"),
    planningSnapshotId: readString(formData, "planningSnapshotId"),
    shoppingItemId: readString(formData, "shoppingItemId"),
    purchaseRequestId: readString(formData, "purchaseRequestId"),
    packCount,
    totalPriceSatang,
    purchasedFrom: readOptionalString(formData, "purchasedFrom"),
    occurredAt: parseDate(readString(formData, "occurredAt")),
    notes: readOptionalString(formData, "notes"),
  });
  if (!parsed.success) {
    return unsavedState(
      INVALID_INPUT_ERROR,
      purchaseFieldErrors(parsed.error.issues),
    );
  }

  try {
    await createShoppingCommandService(db).recordPurchase(owner.id, parsed.data);
    revalidateShoppingViews(parsed.data.cycleId);
    return { error: null, fieldErrors: {}, saved: true, stale: false };
  } catch (error) {
    return commandFailureState(
      error,
      "record_purchase",
      owner.id,
      parsed.data.cycleId,
      parsed.data.purchaseRequestId,
    );
  }
}
