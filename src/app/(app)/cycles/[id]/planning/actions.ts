"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodIssue } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  createPlanningCommandService,
  PlanningBlockedError,
  PlanningStaleError,
  PlanningStateError,
} from "@/modules/planning/application/planning-commands";
import {
  lockCycleInputSchema,
  unlockCycleInputSchema,
} from "@/modules/planning/domain/lock-form";

export type PlanningActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  stale: boolean;
}>;

export type UnlockActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;

const INVALID_PLAN_ERROR = "กรุณาตรวจสอบข้อมูลแผนการผลิต";

function planningFieldErrors(
  issues: ReadonlyArray<ZodIssue>,
  rawPayload: unknown,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.join(".");
    const overrideIndex = issue.path[0] === "overrides" ? issue.path[1] : null;
    const overrideField = issue.path[0] === "overrides" ? issue.path[2] : null;
    const rawOverrides =
      typeof rawPayload === "object" &&
      rawPayload !== null &&
      "overrides" in rawPayload &&
      Array.isArray(rawPayload.overrides)
        ? rawPayload.overrides
        : [];
    const rawOverride =
      typeof overrideIndex === "number" ? rawOverrides[overrideIndex] : null;
    const productId =
      typeof rawOverride === "object" &&
      rawOverride !== null &&
      "productId" in rawOverride &&
      typeof rawOverride.productId === "string"
        ? rawOverride.productId
        : null;
    const adjacentField =
      productId !== null && typeof overrideField === "string"
        ? `${overrideField}.${productId}`
        : field;
    if (field.endsWith(".selectedBatchCount")) {
      errors[adjacentField] =
        "จำนวนแบตช์ต้องเป็นเลขบวก ทศนิยมไม่เกิน 6 ตำแหน่ง";
    } else if (field.endsWith(".reason")) {
      errors[adjacentField] = "กรุณากรอกเหตุผลที่ปรับจำนวนแบตช์";
    } else {
      errors[field || "payload"] = "ข้อมูลแผนการผลิตไม่ถูกต้อง";
    }
  }
  return errors;
}

function revalidatePlanningViews(cycleId: string): void {
  for (const path of [
    "/cycles",
    `/cycles/${cycleId}`,
    `/cycles/${cycleId}/planning`,
    `/cycles/${cycleId}/production`,
    "/orders",
    "/dashboard",
  ]) {
    revalidatePath(path);
  }
}

function logUnexpectedFailure(
  operation: "lock" | "unlock",
  ownerId: string,
  cycleId: string,
  lockRequestId: string | null,
): void {
  console.error("planning_action_failed", {
    operation,
    ownerId,
    cycleId,
    lockRequestId,
  });
}

export async function lockCycleAction(
  _previousState: PlanningActionState,
  formData: FormData,
): Promise<PlanningActionState> {
  const owner = await requireOwner();
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return {
      error: INVALID_PLAN_ERROR,
      fieldErrors: {},
      stale: false,
    };
  }
  const parsed = lockCycleInputSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return {
      error: INVALID_PLAN_ERROR,
      fieldErrors: planningFieldErrors(parsed.error.issues, rawPayload),
      stale: false,
    };
  }

  try {
    await createPlanningCommandService(db).lock(owner.id, parsed.data);
    revalidatePlanningViews(parsed.data.cycleId);
  } catch (error) {
    if (error instanceof PlanningStaleError) {
      return {
        error: "ข้อมูลรอบเปลี่ยนแล้ว กรุณาตรวจสอบแผนอีกครั้ง",
        fieldErrors: {},
        stale: true,
      };
    }
    if (error instanceof PlanningBlockedError) {
      return {
        error: "ยังล็อกรอบไม่ได้ กรุณาแก้รายการที่ระบบแจ้ง",
        fieldErrors: {},
        stale: false,
      };
    }
    if (error instanceof PlanningStateError) {
      return {
        error: "ล็อกรอบไม่สำเร็จ กรุณาเปิดแผนล่าสุดแล้วลองอีกครั้ง",
        fieldErrors: {},
        stale: false,
      };
    }
    logUnexpectedFailure(
      "lock",
      owner.id,
      parsed.data.cycleId,
      parsed.data.lockRequestId,
    );
    return {
      error: "ระบบบันทึกแผนไม่สำเร็จ กรุณาลองอีกครั้ง",
      fieldErrors: {},
      stale: false,
    };
  }

  redirect(`/cycles/${parsed.data.cycleId}/planning`);
}

export async function unlockCycleAction(
  _previousState: UnlockActionState,
  formData: FormData,
): Promise<UnlockActionState> {
  const owner = await requireOwner();
  const parsed = unlockCycleInputSchema.safeParse({
    cycleId: formData.get("cycleId"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      error: "กรุณากรอกเหตุผลและพิมพ์คำว่า ปลดล็อก",
      saved: false,
    };
  }

  try {
    await createPlanningCommandService(db).unlock(owner.id, parsed.data);
    revalidatePlanningViews(parsed.data.cycleId);
    return { error: null, saved: true };
  } catch (error) {
    if (error instanceof PlanningStateError) {
      return { error: "ปลดล็อกรอบนี้ไม่ได้", saved: false };
    }
    logUnexpectedFailure("unlock", owner.id, parsed.data.cycleId, null);
    return {
      error: "ระบบปลดล็อกรอบไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    };
  }
}
