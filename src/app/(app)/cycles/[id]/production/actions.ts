"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  createProductionCommandService,
  ProductionStateError,
  ProductionValidationError,
} from "@/modules/production/application/production-commands";
import {
  createManualTaskInputSchema,
  deleteManualTaskInputSchema,
  updateCycleTaskInputSchema,
} from "@/modules/production/domain/forms";

export type ProductionActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  saved: boolean;
}>;

const INVALID = "กรุณาตรวจสอบข้อมูลงาน";
const STALE = "แผนงานชุดนี้ถูกแทนที่แล้ว กรุณาเปิดรุ่นปัจจุบัน";

function valuesFrom(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") values[key] = value;
  return values;
}

function rawPayload(formData: FormData, values: Record<string, string>): unknown {
  const payload = values.payload;
  if (payload !== undefined) {
    try { return JSON.parse(payload); } catch { return null; }
  }
  const numeric = (value: string | undefined) => value === undefined || value === "" ? value : Number(value);
  return {
    cycleId: values.cycleId,
    taskGenerationId: values.taskGenerationId,
    taskId: values.taskId,
    creationRequestId: values.creationRequestId,
    title: values.title,
    productId: values.productId?.trim() || null,
    batchCount: values.batchCount?.trim() || null,
    scheduledAt: values.scheduledAt,
    estimatedDurationMinutes: numeric(values.estimatedDurationMinutes),
    notes: values.notes?.trim() || null,
    sequence: numeric(values.sequence),
    status: values.status,
    skipReason: values.skipReason?.trim() || null,
  };
}

function validationState(
  values: Record<string, string>,
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> = [],
): ProductionActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) fieldErrors[issue.path.join(".") || "payload"] = INVALID;
  if (Object.keys(fieldErrors).length === 0) fieldErrors.payload = INVALID;
  return { error: INVALID, fieldErrors, values, saved: false };
}

function parseActionInput<T>(formData: FormData, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> } } }): { input: T; values: Record<string, string> } | { state: ProductionActionState } {
  const values = valuesFrom(formData);
  const parsed = schema.safeParse(rawPayload(formData, values));
  if (!parsed.success) return { state: validationState(values, parsed.error.issues) };
  return { input: parsed.data, values };
}

function revalidateProductionViews(cycleId: string): void {
  for (const path of [
    `/cycles/${cycleId}`,
    `/cycles/${cycleId}/planning`,
    `/cycles/${cycleId}/production`,
    `/cycles/${cycleId}/operations`,
    "/cycles",
    "/dashboard",
  ]) revalidatePath(path);
}

function isStale(error: ProductionStateError): boolean {
  return error.kind === "STALE_GENERATION" || /task generation.*read-only|stale|superseded/i.test(error.message);
}

function logUnexpected(operation: "update" | "create" | "delete", ownerId: string, cycleId: string | null): void {
  console.error("production_task_action_failed", { operation, ownerId, ...(cycleId ? { cycleId } : {}) });
}

function failure(error: unknown, values: Record<string, string>, operation: "update" | "create" | "delete", ownerId: string, cycleId: string | null): ProductionActionState {
  if (error instanceof ProductionStateError) {
    return { error: isStale(error) ? STALE : operation === "delete" ? "ลบงานนี้ไม่ได้ กรุณาตรวจสอบสถานะงาน" : "ไม่สามารถแก้ไขงานนี้ได้ กรุณาเปิดข้อมูลล่าสุด", fieldErrors: {}, values, saved: false };
  }
  if (error instanceof ProductionValidationError) return validationState(values);
  logUnexpected(operation, ownerId, cycleId);
  return { error: operation === "delete" ? "ระบบลบงานไม่สำเร็จ กรุณาลองอีกครั้ง" : "ระบบบันทึกงานไม่สำเร็จ กรุณาลองอีกครั้ง", fieldErrors: {}, values, saved: false };
}

export async function updateCycleTaskAction(_previousState: ProductionActionState, formData: FormData): Promise<ProductionActionState> {
  const owner = await requireOwner();
  const parsed = parseActionInput(formData, updateCycleTaskInputSchema);
  if ("state" in parsed) return parsed.state;
  try {
    await createProductionCommandService(db).updateTask(owner.id, parsed.input);
    revalidateProductionViews(parsed.input.cycleId);
    return { error: null, fieldErrors: {}, values: parsed.values, saved: true };
  } catch (error) {
    return failure(error, parsed.values, "update", owner.id, parsed.input.cycleId);
  }
}

export async function createManualCycleTaskAction(_previousState: ProductionActionState, formData: FormData): Promise<ProductionActionState> {
  const owner = await requireOwner();
  const parsed = parseActionInput(formData, createManualTaskInputSchema);
  if ("state" in parsed) return parsed.state;
  try {
    await createProductionCommandService(db).createManualTask(owner.id, parsed.input);
    revalidateProductionViews(parsed.input.cycleId);
    return { error: null, fieldErrors: {}, values: parsed.values, saved: true };
  } catch (error) {
    return failure(error, parsed.values, "create", owner.id, parsed.input.cycleId);
  }
}

export function deleteManualCycleTaskAction(formData: FormData): Promise<ProductionActionState>;
export function deleteManualCycleTaskAction(_previousState: ProductionActionState, formData: FormData): Promise<ProductionActionState>;
export async function deleteManualCycleTaskAction(
  first: FormData | ProductionActionState,
  second?: FormData,
): Promise<ProductionActionState> {
  const formData = second ?? (first as FormData);
  const owner = await requireOwner();
  const parsed = parseActionInput(formData, deleteManualTaskInputSchema);
  if ("state" in parsed) return parsed.state;
  try {
    await createProductionCommandService(db).softDeleteManualTask(owner.id, parsed.input);
    revalidateProductionViews(parsed.input.cycleId);
    return { error: null, fieldErrors: {}, values: parsed.values, saved: true };
  } catch (error) {
    if (error instanceof ProductionStateError && error.kind === "TASK_NOT_DELETABLE") {
      return { error: "ลบงานนี้ไม่ได้ กรุณาตรวจสอบสถานะงาน", fieldErrors: {}, values: parsed.values, saved: false };
    }
    return failure(error, parsed.values, "delete", owner.id, parsed.input.cycleId);
  }
}
