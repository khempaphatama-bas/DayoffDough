import Decimal from "decimal.js";
import { z } from "zod";

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1).max(2_000);
const selectedBatchCountSchema = z
  .string()
  .regex(/^(?:\d+|\d*\.\d{1,6})$/)
  .refine((value) => {
    try {
      const quantity = new Decimal(value);
      return quantity.isFinite() && quantity.gt(0);
    } catch {
      return false;
    }
  });

export const lockCycleInputSchema = z.object({
  cycleId: uuidSchema,
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lockRequestId: uuidSchema,
  overrides: z.array(
    z.object({
      productId: uuidSchema,
      selectedBatchCount: selectedBatchCountSchema,
      reason: reasonSchema,
    }),
  ),
});

export const unlockCycleInputSchema = z.object({
  cycleId: uuidSchema,
  reason: reasonSchema,
  confirmation: z.literal("ปลดล็อก"),
});

export type LockCycleInput = z.infer<typeof lockCycleInputSchema>;
export type UnlockCycleInput = z.infer<typeof unlockCycleInputSchema>;
