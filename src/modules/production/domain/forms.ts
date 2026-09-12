import Decimal from "decimal.js";
import { z } from "zod";
import {
  cycleTaskStatuses,
  productionTemplateScopes,
  type CycleTaskStatus,
  type ProductionTemplateInput,
} from "./types";

const uuidSchema = z.string().uuid();
const trimmedTextSchema = z.string().trim();
const requiredTextSchema = trimmedTextSchema.min(1);
const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const integerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const positiveNumeric18_6Schema = z
  .string()
  .regex(/^(?:\d+|\d*\.\d{1,6})$/)
  .refine((value) => {
    try {
      const decimal = new Decimal(value);
      return decimal.isFinite() && decimal.gt(0) && decimal.lt("1000000000000");
    } catch {
      return false;
    }
  });
const nullableTextSchema = z.union([trimmedTextSchema, z.null()]);
const nullablePositiveNumeric18_6Schema = z.union([
  positiveNumeric18_6Schema,
  z.null(),
]);
const canonicalIsoInstantSchema = z
  .string()
  .refine((value) => {
    const instant = new Date(value);
    return !Number.isNaN(instant.getTime()) && instant.toISOString() === value;
  })
  .transform((value) => new Date(value));

const productionTemplateActivityInputSchema = z.object({
  id: z.union([uuidSchema, z.null()]),
  name: requiredTextSchema,
  offsetDaysFromDelivery: integerSchema,
  defaultTime: localTimeSchema,
  estimatedDurationMinutes: positiveIntegerSchema,
  sequence: positiveIntegerSchema,
  notes: nullableTextSchema,
  active: z.boolean(),
});

export const productionTemplateInputSchema = z
  .object({
    name: requiredTextSchema,
    scope: z.enum(productionTemplateScopes),
    productId: z.union([uuidSchema, z.null()]),
    activities: z.array(productionTemplateActivityInputSchema),
  })
  .superRefine((values, context) => {
    const hasCorrectProductPairing =
      (values.scope === "CYCLE" && values.productId === null) ||
      (values.scope === "PRODUCT" && values.productId !== null);
    if (!hasCorrectProductPairing) {
      context.addIssue({
        code: "custom",
        path: ["productId"],
        message: "productId must match the template scope",
      });
    }
  }) satisfies z.ZodType<ProductionTemplateInput>;

const taskFields = {
  title: requiredTextSchema,
  productId: z.union([uuidSchema, z.null()]),
  batchCount: nullablePositiveNumeric18_6Schema,
  scheduledAt: canonicalIsoInstantSchema,
  estimatedDurationMinutes: positiveIntegerSchema,
  notes: nullableTextSchema,
  sequence: positiveIntegerSchema,
  status: z.enum(cycleTaskStatuses),
  skipReason: nullableTextSchema,
};

function validateSkipReason(
  values: Readonly<{ status: CycleTaskStatus; skipReason: string | null }>,
  context: z.RefinementCtx,
) {
  if (values.status === "SKIPPED" && !values.skipReason) {
    context.addIssue({
      code: "custom",
      path: ["skipReason"],
      message: "skipReason is required when a task is skipped",
    });
  }
}

function normalizeSkipReason<T extends { status: CycleTaskStatus; skipReason: string | null }>(
  values: T,
) {
  return {
    ...values,
    skipReason: values.status === "SKIPPED" ? values.skipReason : null,
  };
}

export const updateCycleTaskInputSchema = z
  .object({
    cycleId: uuidSchema,
    taskGenerationId: uuidSchema,
    taskId: uuidSchema,
    ...taskFields,
  })
  .superRefine(validateSkipReason)
  .transform(normalizeSkipReason);

export const createManualTaskInputSchema = z
  .object({
    cycleId: uuidSchema,
    taskGenerationId: uuidSchema,
    creationRequestId: uuidSchema,
    ...taskFields,
  })
  .superRefine(validateSkipReason)
  .transform(normalizeSkipReason);

export const deleteManualTaskInputSchema = z.object({
  cycleId: uuidSchema,
  taskGenerationId: uuidSchema,
  taskId: uuidSchema,
});

export type UpdateCycleTaskInput = Readonly<{
  cycleId: string;
  taskGenerationId: string;
  taskId: string;
  title: string;
  productId: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: CycleTaskStatus;
  skipReason: string | null;
}>;

export type CreateManualTaskInput = Omit<UpdateCycleTaskInput, "taskId"> &
  Readonly<{ creationRequestId: string }>;

export type DeleteManualTaskInput = Readonly<{
  cycleId: string;
  taskGenerationId: string;
  taskId: string;
}>;
