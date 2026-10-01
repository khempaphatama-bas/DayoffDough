import { z } from "zod";

const uuidSchema = z.string().uuid();
const postgresInteger = z.number().int().min(0).max(2_147_483_647);

export const cycleOperationInputSchema = z.object({
  cycleId: uuidSchema,
});

export const orderOperationInputSchema = z.object({
  cycleId: uuidSchema,
  orderId: uuidSchema,
});

export const batchOrderOperationInputSchema = z
  .object({
    cycleId: uuidSchema,
    orderIds: z.array(uuidSchema).min(1).max(100),
  })
  .transform((values) => ({
    ...values,
    orderIds: [...new Set(values.orderIds)].sort((left, right) => left.localeCompare(right)),
  }));

export const packingQuantityInputSchema = z.object({
  cycleId: uuidSchema,
  orderItemId: uuidSchema,
  packedQuantity: postgresInteger,
  expectedPackedQuantity: postgresInteger,
});

export const paymentTargetInputSchema = z.object({
  orderId: uuidSchema,
  targetAmountPaidSatang: postgresInteger,
  expectedAmountPaidSatang: postgresInteger,
});

export const completeCycleInputSchema = z.object({
  cycleId: uuidSchema,
  expectedTaskGenerationId: uuidSchema,
  confirmation: z.literal(true),
});
