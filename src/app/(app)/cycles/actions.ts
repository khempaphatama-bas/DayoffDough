"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, type ZodIssue } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  type BakeCycleInput,
  createCycleService,
} from "@/modules/cycles/application/cycles";

export type CycleActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
  saved: boolean;
}>;

export type CycleStatusActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;

const cycleStatusSchema = z.enum([
  "DRAFT",
  "OPEN",
  "LOCKED",
  "IN_PRODUCTION",
  "COMPLETED",
  "CANCELLED",
]);
const bangkokLocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .pipe(z.iso.datetime({ local: true }));
const cycleFormSchema = z.object({
  name: z.string().trim().min(1).max(160),
  orderCutoffAt: z.union([z.literal(""), bangkokLocalDateTimeSchema]),
  targetProductionDate: z.iso.date(),
  primaryDeliveryDate: z.iso.date(),
  notes: z.string().trim().max(2000).optional(),
});
const cycleCreateFormSchema = cycleFormSchema.extend({
  status: z.enum(["DRAFT", "OPEN"]),
});
const cycleUpdateFormSchema = cycleFormSchema.extend({
  cycleId: z.string().uuid(),
});
const cycleStatusFormSchema = z.object({
  cycleId: z.string().uuid(),
  status: cycleStatusSchema,
});
const THAI_FIELD_ERRORS: Readonly<Record<string, string>> = {
  name: "กรุณากรอกชื่อรอบอบให้ถูกต้อง",
  orderCutoffAt: "วันปิดรับออเดอร์ไม่ถูกต้อง",
  targetProductionDate: "วันผลิตไม่ถูกต้อง",
  primaryDeliveryDate: "วันส่งหลักไม่ถูกต้อง",
  notes: "หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร",
  status: "สถานะรอบอบไม่ถูกต้อง",
  cycleId: "รหัสรอบอบไม่ถูกต้อง",
};

function parseBangkokDateTime(value: string): Date | null {
  return value === "" ? null : new Date(value + ":00+07:00");
}

function readCycleForm(formData: FormData) {
  return {
    name: formData.get("name"),
    orderCutoffAt: formData.get("orderCutoffAt") ?? "",
    targetProductionDate: formData.get("targetProductionDate"),
    primaryDeliveryDate: formData.get("primaryDeliveryDate"),
    notes: formData.get("notes") ?? "",
  };
}

function toCycleInput(input: z.infer<typeof cycleFormSchema>): BakeCycleInput {
  return {
    name: input.name,
    orderCutoffAt: parseBangkokDateTime(input.orderCutoffAt),
    targetProductionDate: input.targetProductionDate,
    primaryDeliveryDate: input.primaryDeliveryDate,
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  };
}

function toFieldErrors(
  issues: ReadonlyArray<ZodIssue>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  const errors: Record<string, Array<string>> = {};
  for (const issue of issues) {
    const field = issue.path.join(".");
    const message = THAI_FIELD_ERRORS[field] ?? "ข้อมูลไม่ถูกต้อง";
    errors[field] = [...(errors[field] ?? []), message];
  }
  return errors;
}

function invalidState(issues: ReadonlyArray<ZodIssue>): CycleActionState {
  return {
    error: "กรุณาตรวจสอบข้อมูลรอบอบ",
    fieldErrors: toFieldErrors(issues),
    saved: false,
  };
}

export async function createCycleAction(
  _previousState: CycleActionState,
  formData: FormData,
): Promise<CycleActionState> {
  const owner = await requireOwner();
  const parsed = cycleCreateFormSchema.safeParse({
    ...readCycleForm(formData),
    status: formData.get("status"),
  });
  if (!parsed.success) return invalidState(parsed.error.issues);

  let cycleId: string;
  try {
    const cycle = await createCycleService(db).create(owner.id, {
      ...toCycleInput(parsed.data),
      status: parsed.data.status,
    });
    cycleId = cycle.id;
    revalidatePath("/cycles");
    revalidatePath("/dashboard");
  } catch {
    return {
      error: "บันทึกรอบอบไม่สำเร็จ กรุณาตรวจสอบข้อมูลรอบอบ",
      fieldErrors: {},
      saved: false,
    };
  }

  redirect(`/cycles/${cycleId}`);
}

export async function updateCycleAction(
  _previousState: CycleActionState,
  formData: FormData,
): Promise<CycleActionState> {
  const owner = await requireOwner();
  const parsed = cycleUpdateFormSchema.safeParse({
    ...readCycleForm(formData),
    cycleId: formData.get("cycleId"),
  });
  if (!parsed.success) return invalidState(parsed.error.issues);

  try {
    await createCycleService(db).update(
      owner.id,
      parsed.data.cycleId,
      toCycleInput(parsed.data),
    );
    revalidatePath("/cycles");
    revalidatePath(`/cycles/${parsed.data.cycleId}`);
    revalidatePath("/dashboard");
    return { error: null, fieldErrors: {}, saved: true };
  } catch {
    return {
      error: "แก้ไขรอบอบไม่สำเร็จ กรุณาตรวจสอบข้อมูลรอบอบ",
      fieldErrors: {},
      saved: false,
    };
  }
}

export async function changeCycleStatusAction(
  _previousState: CycleStatusActionState,
  formData: FormData,
): Promise<CycleStatusActionState> {
  const owner = await requireOwner();
  const parsed = cycleStatusFormSchema.safeParse({
    cycleId: formData.get("cycleId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบสถานะรอบอบ", saved: false };
  }

  try {
    await createCycleService(db).changeStatus(
      owner.id,
      parsed.data.cycleId,
      parsed.data.status,
    );
    revalidatePath("/cycles");
    revalidatePath(`/cycles/${parsed.data.cycleId}`);
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch {
    return {
      error: "อัปเดตสถานะรอบอบไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    };
  }
}
