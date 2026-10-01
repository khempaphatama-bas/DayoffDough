import { describe, expect, it } from "vitest";
import {
  batchOrderOperationInputSchema,
  completeCycleInputSchema,
  cycleOperationInputSchema,
  orderOperationInputSchema,
  packingQuantityInputSchema,
  paymentTargetInputSchema,
} from "./forms";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ITEM_ID = "44444444-4444-4444-8444-444444444444";
const GENERATION_ID = "55555555-5555-4555-8555-555555555555";

describe("operations command input schemas", () => {
  it("keeps the cycle and order identifiers required for one-order operations", () => {
    expect(cycleOperationInputSchema.parse({ cycleId: CYCLE_ID })).toEqual({
      cycleId: CYCLE_ID,
    });
    expect(orderOperationInputSchema.parse({
      cycleId: CYCLE_ID,
      orderId: ORDER_ID,
    })).toEqual({ cycleId: CYCLE_ID, orderId: ORDER_ID });
  });

  it("normalizes duplicate batch ids and rejects an empty batch", () => {
    expect(batchOrderOperationInputSchema.parse({
      cycleId: CYCLE_ID,
      orderIds: [SECOND_ORDER_ID, ORDER_ID, SECOND_ORDER_ID],
    }).orderIds).toEqual([ORDER_ID, SECOND_ORDER_ID]);
    expect(batchOrderOperationInputSchema.safeParse({
      cycleId: CYCLE_ID,
      orderIds: [],
    }).success).toBe(false);
  });

  it("rejects malformed UUIDs and batches larger than one hundred order ids", () => {
    expect(cycleOperationInputSchema.safeParse({ cycleId: "not-a-uuid" }).success)
      .toBe(false);
    expect(orderOperationInputSchema.safeParse({
      cycleId: CYCLE_ID,
      orderId: "not-a-uuid",
    }).success).toBe(false);
    expect(batchOrderOperationInputSchema.safeParse({
      cycleId: CYCLE_ID,
      orderIds: Array.from({ length: 101 }, () => ORDER_ID),
    }).success).toBe(false);
  });

  it("accepts only PostgreSQL-range integer packing quantities", () => {
    expect(packingQuantityInputSchema.parse({
      cycleId: CYCLE_ID,
      orderItemId: ORDER_ITEM_ID,
      packedQuantity: 0,
      expectedPackedQuantity: 2_147_483_647,
    })).toMatchObject({ packedQuantity: 0, expectedPackedQuantity: 2_147_483_647 });

    for (const packedQuantity of [-1, 1.5, 2_147_483_648]) {
      expect(packingQuantityInputSchema.safeParse({
        cycleId: CYCLE_ID,
        orderItemId: ORDER_ITEM_ID,
        packedQuantity,
        expectedPackedQuantity: 0,
      }).success).toBe(false);
    }
  });

  it("accepts only PostgreSQL-range integer cumulative payment targets", () => {
    expect(paymentTargetInputSchema.parse({
      orderId: ORDER_ID,
      targetAmountPaidSatang: 2_147_483_647,
      expectedAmountPaidSatang: 0,
    })).toMatchObject({ targetAmountPaidSatang: 2_147_483_647 });

    for (const targetAmountPaidSatang of [-1, 1.5, 2_147_483_648]) {
      expect(paymentTargetInputSchema.safeParse({
        orderId: ORDER_ID,
        targetAmountPaidSatang,
        expectedAmountPaidSatang: 0,
      }).success).toBe(false);
    }
  });

  it("requires the displayed task generation and an explicit completion confirmation", () => {
    expect(completeCycleInputSchema.parse({
      cycleId: CYCLE_ID,
      expectedTaskGenerationId: GENERATION_ID,
      confirmation: true,
    })).toEqual({
      cycleId: CYCLE_ID,
      expectedTaskGenerationId: GENERATION_ID,
      confirmation: true,
    });
    expect(completeCycleInputSchema.safeParse({
      cycleId: CYCLE_ID,
      expectedTaskGenerationId: GENERATION_ID,
      confirmation: false,
    }).success).toBe(false);
  });
});
