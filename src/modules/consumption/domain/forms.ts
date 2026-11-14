import { z } from "zod";
import { canonicalQuantity } from "./rules";
import type { ConfirmUseInput, CorrectUseInput, SettleUseInput } from "./types";

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const requiredReason = z.string().trim().min(1);
const nullableReason = z.string().trim().nullable();
const quantitySchema = z.string().transform((value, context) => {
  try {
    return canonicalQuantity(value);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid consumption quantity" });
    return z.NEVER;
  }
});
const revisionSchema = z.string().regex(/^\d+$/).transform((value) => value.replace(/^0+(?=\d)/, ""));

// Detect duplicates on the original array; never silently deduplicate intent.
function uniqueBy<T>(schema: z.ZodType<T>, key: (row: T) => string) {
  return z.array(schema).superRefine((rows, context) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const id = key(row);
      if (seen.has(id)) {
        context.addIssue({ code: "custom", path: [index], message: "Duplicate consumption ID" });
      }
      seen.add(id);
    });
  });
}

const sourceFields = { cycleId: uuidSchema, planningSnapshotId: uuidSchema, contextId: uuidSchema };
const usageItemSchema = z.strictObject({
  inventoryItemId: uuidSchema,
  usedQuantity: quantitySchema,
  basis: z.enum(["PLANNED", "OWNER_REPORTED"]),
  reason: nullableReason,
}).superRefine((item, context) => {
  if (item.usedQuantity === "0" && !item.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for zero use" });
  }
});
const itemsSchema = uniqueBy(usageItemSchema, (row) => row.inventoryItemId);
const expectedLedgerSchema = uniqueBy(z.strictObject({
  inventoryItemId: uuidSchema,
  ledgerRevision: revisionSchema,
  countMovementId: uuidSchema.nullable(),
}), (row) => row.inventoryItemId);
const intentFields = { ...sourceFields, requestId: uuidSchema, items: itemsSchema, expectedLedger: expectedLedgerSchema };

export const confirmUseInputSchema = z.strictObject({
  ...intentFields,
  confirmTakenOutOfUse: z.literal(true),
  confirmEmpty: z.boolean(),
  reason: nullableReason,
}).superRefine((input, context) => {
  if (input.items.length !== 0) return;
  if (!input.confirmEmpty) {
    context.addIssue({ code: "custom", path: ["confirmEmpty"], message: "Explicit empty-use confirmation is required" });
  }
  if (!input.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "An empty use requires a reason" });
  }
}) satisfies z.ZodType<ConfirmUseInput>;

export const correctUseInputSchema = z.strictObject({
  ...intentFields,
  expectedRevisionId: uuidSchema,
  reason: requiredReason,
}) satisfies z.ZodType<CorrectUseInput>;

const settlementContextSchema = z.strictObject({
  ...sourceFields, items: itemsSchema, confirmTakenOutOfUse: z.literal(true),
});
export const settleUseInputSchema = z.strictObject({
  requestId: uuidSchema,
  contexts: uniqueBy(settlementContextSchema, (row) => row.contextId).superRefine((rows, context) => {
    const cycles = new Set<string>();
    rows.forEach((row, index) => {
      if (cycles.has(row.cycleId)) {
        context.addIssue({ code: "custom", path: [index, "cycleId"], message: "Duplicate settlement cycle" });
      }
      cycles.add(row.cycleId);
    });
  }),
  counts: uniqueBy(z.strictObject({ inventoryItemId: uuidSchema, remainingQuantity: quantitySchema }), (row) => row.inventoryItemId),
  expectedLedger: expectedLedgerSchema,
  reason: requiredReason,
}) satisfies z.ZodType<SettleUseInput>;
