"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  createProductionTemplateService,
  TemplateStateError,
  TemplateValidationError,
} from "@/modules/production/application/template-service";
import { productionTemplateInputSchema } from "@/modules/production/domain/forms";
import type { ProductionTemplateInput } from "@/modules/production/domain/types";

export type TemplateActionState = Readonly<{
  status: "IDLE" | "ERROR";
  message: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
}>;

const INVALID_TEMPLATE_ERROR = "กรุณาตรวจสอบข้อมูลเทมเพลต";
const INITIAL_ERROR_STATE: TemplateActionState = {
  status: "ERROR", message: INVALID_TEMPLATE_ERROR, fieldErrors: {}, values: {},
};

function valuesFrom(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function validationState(
  values: Record<string, string>,
  fieldErrors: Readonly<Record<string, string>> = {},
): TemplateActionState {
  return { ...INITIAL_ERROR_STATE, fieldErrors, values };
}

function thaiFieldErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (path.includes("estimatedDurationMinutes")) errors[path] = "ระยะเวลาต้องมากกว่า 0 นาที";
    else if (path.includes("name")) errors[path] = "กรุณากรอกชื่อให้ครบ";
    else if (path.includes("defaultTime")) errors[path] = "กรุณาระบุเวลาให้ถูกต้อง";
    else if (path.includes("productId")) errors[path] = "กรุณาเลือกสินค้า";
    else errors[path || "template"] = "ข้อมูลกิจกรรมไม่ถูกต้อง";
  }
  return errors;
}

function parseTemplate(formData: FormData):
  | Readonly<{ success: true; templateId: string | null; input: ProductionTemplateInput; values: Record<string, string> }>
  | Readonly<{ success: false; state: TemplateActionState }> {
  const values = valuesFrom(formData);
  let activities: unknown;
  try {
    activities = JSON.parse(values.activities ?? "");
  } catch {
    return { success: false, state: validationState(values, { activities: "ข้อมูลกิจกรรมไม่ถูกต้อง" }) };
  }
  const parsed = productionTemplateInputSchema.safeParse({
    name: values.name,
    scope: values.scope,
    productId: values.productId?.trim() || null,
    activities,
  });
  if (!parsed.success) {
    return { success: false, state: validationState(values, thaiFieldErrors(parsed.error.issues)) };
  }
  const templateIdValue = values.templateId?.trim() ?? "";
  if (templateIdValue !== "" && !z.string().uuid().safeParse(templateIdValue).success) {
    return { success: false, state: validationState(values, { templateId: "ไม่พบเทมเพลตที่ต้องการ" }) };
  }
  return { success: true, templateId: templateIdValue || null, input: parsed.data, values };
}

function revalidateTemplateViews(): void {
  revalidatePath("/production/templates");
  revalidatePath("/production/templates/[id]", "page");
  revalidatePath("/cycles/[id]/planning", "page");
}

function unexpectedFailure(operation: "save" | "duplicate" | "set_active", ownerId: string, templateId: string | null): void {
  console.error("production_template_action_failed", { operation, ownerId, templateId });
}

function mappedFailure(
  error: unknown,
  values: Record<string, string>,
  operation: "save" | "duplicate" | "set_active",
  ownerId: string,
  templateId: string | null,
): TemplateActionState {
  if (error instanceof TemplateStateError) {
    return { status: "ERROR", message: "ไม่พบเทมเพลตที่ต้องการ", fieldErrors: {}, values };
  }
  if (error instanceof TemplateValidationError) return validationState(values);
  unexpectedFailure(operation, ownerId, templateId);
  return { status: "ERROR", message: "บันทึกเทมเพลตไม่สำเร็จ กรุณาลองอีกครั้ง", fieldErrors: {}, values };
}

export async function saveProductionTemplateAction(
  _previousState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const owner = await requireOwner();
  const parsed = parseTemplate(formData);
  if (!parsed.success) return parsed.state;
  let templateId: string;
  try {
    const service = createProductionTemplateService(db);
    const template = parsed.templateId
      ? await service.update(owner.id, parsed.templateId, parsed.input)
      : await service.create(owner.id, parsed.input);
    revalidateTemplateViews();
    templateId = template.id;
  } catch (error) {
    return mappedFailure(error, parsed.values, "save", owner.id, parsed.templateId);
  }
  redirect(`/production/templates/${templateId}`);
}

export async function duplicateProductionTemplateAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const parsed = z.string().uuid().safeParse(formData.get("templateId"));
  if (!parsed.success) return;
  let copyId: string;
  try {
    const copy = await createProductionTemplateService(db).duplicate(owner.id, parsed.data);
    revalidateTemplateViews();
    copyId = copy.id;
  } catch (error) {
    if (!(error instanceof TemplateStateError || error instanceof TemplateValidationError)) {
      unexpectedFailure("duplicate", owner.id, parsed.data);
    }
    return;
  }
  redirect(`/production/templates/${copyId}`);
}

export async function setProductionTemplateActiveAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const parsed = z.object({ templateId: z.string().uuid(), active: z.enum(["true", "false"]) }).safeParse({
    templateId: formData.get("templateId"), active: formData.get("active"),
  });
  if (!parsed.success) return;
  try {
    await createProductionTemplateService(db).setActive(owner.id, parsed.data.templateId, parsed.data.active === "true");
    revalidateTemplateViews();
  } catch (error) {
    if (!(error instanceof TemplateStateError || error instanceof TemplateValidationError)) {
      unexpectedFailure("set_active", owner.id, parsed.data.templateId);
    }
    return;
  }
  redirect("/production/templates");
}
