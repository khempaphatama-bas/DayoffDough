"use server";

import { revalidatePath } from "next/cache";
import { z, type ZodIssue } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  type Customer,
  type CustomerInput,
  createCustomerService,
} from "@/modules/customers/application/customers";

export type CustomerActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
  saved: boolean;
}>;

export type QuickCustomerResult =
  | Readonly<{ ok: true; customer: Customer }>
  | Readonly<{ ok: false; error: string }>;

const optionalShortTextSchema = z.string().trim().max(200);
const optionalLongTextSchema = z.string().trim().max(2000);
const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactHandle: optionalShortTextSchema.optional(),
  phone: optionalShortTextSchema.optional(),
  defaultDeliveryMethodId: z.string().uuid().nullable(),
  defaultDeliveryLocation: optionalLongTextSchema.optional(),
  defaultDeliveryNote: optionalLongTextSchema.optional(),
  notes: optionalLongTextSchema.optional(),
});
const customerFormSchema = customerInputSchema.extend({
  defaultDeliveryMethodId: z
    .union([z.literal(""), z.string().uuid()])
    .transform((value) => value || null),
});
const customerUpdateFormSchema = customerFormSchema.extend({
  customerId: z.string().uuid(),
  active: z.boolean(),
});

function readCustomerForm(formData: FormData) {
  return {
    name: formData.get("name"),
    contactHandle: formData.get("contactHandle") ?? "",
    phone: formData.get("phone") ?? "",
    defaultDeliveryMethodId: formData.get("defaultDeliveryMethodId") ?? "",
    defaultDeliveryLocation: formData.get("defaultDeliveryLocation") ?? "",
    defaultDeliveryNote: formData.get("defaultDeliveryNote") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

function toCustomerInput(
  input: z.infer<typeof customerInputSchema>,
): CustomerInput {
  return {
    name: input.name,
    defaultDeliveryMethodId: input.defaultDeliveryMethodId,
    ...(input.contactHandle === undefined
      ? {}
      : { contactHandle: input.contactHandle }),
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(input.defaultDeliveryLocation === undefined
      ? {}
      : { defaultDeliveryLocation: input.defaultDeliveryLocation }),
    ...(input.defaultDeliveryNote === undefined
      ? {}
      : { defaultDeliveryNote: input.defaultDeliveryNote }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  };
}

function toFieldErrors(
  issues: ReadonlyArray<ZodIssue>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  const errors: Record<string, Array<string>> = {};
  for (const issue of issues) {
    const field = issue.path.join(".");
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

export async function createCustomerAction(
  _previousState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const owner = await requireOwner();
  const parsed = customerFormSchema.safeParse(readCustomerForm(formData));
  if (!parsed.success) {
    return {
      error: "กรุณาตรวจสอบข้อมูลลูกค้า",
      fieldErrors: toFieldErrors(parsed.error.issues),
      saved: false,
    };
  }
  try {
    await createCustomerService(db).create(owner.id, toCustomerInput(parsed.data));
    revalidatePath("/customers");
    return { error: null, fieldErrors: {}, saved: true };
  } catch {
    return {
      error: "บันทึกลูกค้าไม่สำเร็จ กรุณาตรวจสอบวิธีส่งและข้อมูลลูกค้า",
      fieldErrors: {},
      saved: false,
    };
  }
}

export async function updateCustomerAction(
  _previousState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const owner = await requireOwner();
  const parsed = customerUpdateFormSchema.safeParse({
    ...readCustomerForm(formData),
    customerId: formData.get("customerId"),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return {
      error: "กรุณาตรวจสอบข้อมูลลูกค้า",
      fieldErrors: toFieldErrors(parsed.error.issues),
      saved: false,
    };
  }
  try {
    await createCustomerService(db).update(owner.id, parsed.data.customerId, {
      ...toCustomerInput(parsed.data),
      active: parsed.data.active,
    });
    revalidatePath("/customers");
    revalidatePath(`/customers/${parsed.data.customerId}`);
    return { error: null, fieldErrors: {}, saved: true };
  } catch {
    return {
      error: "แก้ไขลูกค้าไม่สำเร็จ กรุณาตรวจสอบวิธีส่งและข้อมูลลูกค้า",
      fieldErrors: {},
      saved: false,
    };
  }
}

export async function createQuickCustomerAction(
  input: CustomerInput,
): Promise<QuickCustomerResult> {
  const owner = await requireOwner();
  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "กรุณาตรวจสอบข้อมูลลูกค้า" };
  }
  try {
    const customer = await createCustomerService(db).create(
      owner.id,
      toCustomerInput(parsed.data),
    );
    revalidatePath("/customers");
    return { ok: true, customer };
  } catch {
    return {
      ok: false,
      error: "บันทึกลูกค้าไม่สำเร็จ กรุณาตรวจสอบวิธีส่งและข้อมูลลูกค้า",
    };
  }
}
