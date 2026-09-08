import { z } from "zod";
import { isNonNegativeNumeric18_6 } from "./storage";

const uuidSchema = z.string().uuid();
const nonNegativeSixDecimalSchema = z
  .string()
  .regex(/^(?:\d+|\d*\.\d{1,6})$/)
  .refine(isNonNegativeNumeric18_6);

export const confirmStockInputSchema = z.object({
  cycleId: uuidSchema,
  planningSnapshotId: uuidSchema,
  confirmationRequestId: uuidSchema,
  countedAt: z.date(),
  counts: z.array(
    z.object({
      inventoryItemId: uuidSchema,
      countedQuantity: nonNegativeSixDecimalSchema,
    }),
  ),
});

export const recordPurchaseInputSchema = z.object({
  cycleId: uuidSchema,
  planningSnapshotId: uuidSchema,
  shoppingItemId: uuidSchema,
  purchaseRequestId: uuidSchema,
  packCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  totalPriceSatang: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  purchasedFrom: z.string().trim().max(200).optional(),
  occurredAt: z.date(),
  notes: z.string().trim().max(2_000).optional(),
});

export type ConfirmStockInput = z.infer<typeof confirmStockInputSchema>;
export type RecordPurchaseInput = z.infer<typeof recordPurchaseInputSchema>;
