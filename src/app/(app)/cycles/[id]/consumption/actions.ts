"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createConsumptionCommandService } from "@/modules/consumption/application/consumption-commands";
import { createConsumptionActionSupport } from "@/modules/consumption/application/action-support";
import { confirmUseInputSchema, correctUseInputSchema, settleUseInputSchema } from "@/modules/consumption/domain/forms";
import type { ConsumptionActionState, ConsumptionWriteResult } from "@/modules/consumption/domain/types";

const INVALID = "กรุณาตรวจสอบข้อมูลการใช้สต๊อก";
const FAILED = "บันทึกยอดใช้ไม่สำเร็จ กรุณาลองอีกครั้ง";
function unsaved(error: string, fieldErrors: Readonly<Record<string, string>> = {}): ConsumptionActionState {
  return { error, fieldErrors, saved: false, stale: false, result: null, blockers: [] };
}

async function runUse<T extends { requestId: string }>(
  ownerId: string, formData: FormData, schema: z.ZodType<T>,
  operation: "confirmUse" | "correctUse" | "settleUse",
  execute: (input: T) => Promise<ConsumptionWriteResult>,
): Promise<ConsumptionActionState> {
  let payload: unknown;
  try {
    const values = formData.getAll("payload");
    if (values.length !== 1 || typeof values[0] !== "string") return unsaved(INVALID, { payload: INVALID });
    payload = JSON.parse(values[0]);
  } catch { return unsaved(INVALID, { payload: INVALID }); }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "payload"] = "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
    return unsaved(INVALID, fields);
  }
  const support = createConsumptionActionSupport(db);
  try {
    const result = await execute(parsed.data);
    // Never use draft/client IDs: immutable owned receipt links also cover old replays.
    const targets = await support.getCommittedTargets(ownerId, result.operationId);
    const paths = new Set(["/inventory", "/cycles", "/dashboard"]);
    for (const cycleId of targets.cycleIds) {
      for (const suffix of ["", "/consumption", "/planning", "/shopping", "/operations"]) paths.add(`/cycles/${cycleId}${suffix}`);
    }
    for (const itemId of targets.inventoryItemIds) paths.add(`/inventory/${itemId}`);
    for (const path of paths) revalidatePath(path);
    return { error: null, fieldErrors: {}, saved: true, stale: false, result, blockers: [] };
  } catch (error) {
    try {
      const safe = await support.mapError(ownerId, error);
      if (safe) return { ...safe, saved: false, result: null };
    } catch { /* A failed read is an unexpected failure, never expose its message. */ }
    console.error("consumption_action_failed", { operation, requestId: parsed.data.requestId, category: "unexpected" });
    return unsaved(FAILED);
  }
}

export async function confirmUseAction(_previous: ConsumptionActionState, formData: FormData): Promise<ConsumptionActionState> {
  const owner = await requireOwner();
  return runUse(owner.id, formData, confirmUseInputSchema, "confirmUse", (input) => createConsumptionCommandService(db).confirmUse(owner.id, input));
}
export async function correctUseAction(_previous: ConsumptionActionState, formData: FormData): Promise<ConsumptionActionState> {
  const owner = await requireOwner();
  return runUse(owner.id, formData, correctUseInputSchema, "correctUse", (input) => createConsumptionCommandService(db).correctUse(owner.id, input));
}
export async function settleUseAction(_previous: ConsumptionActionState, formData: FormData): Promise<ConsumptionActionState> {
  const owner = await requireOwner();
  return runUse(owner.id, formData, settleUseInputSchema, "settleUse", (input) => createConsumptionCommandService(db).settleUse(owner.id, input));
}
