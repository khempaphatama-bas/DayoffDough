import { describe, expect, it } from "vitest";
import {
  calculateOrderFormTotals,
  normalizeOrderForm,
  orderFormSchema,
} from "./order-form";

const VALID_FORM = {
  customerId: "00000000-0000-4000-8000-000000000010",
  bakeCycleId: "00000000-0000-4000-8000-000000000020",
  sourceChannel: "INSTAGRAM",
  requestedDeliveryDate: "2026-08-30",
  confirmedDeliveryDate: "2026-08-30",
  deliveryMethodId: "00000000-0000-4000-8000-000000000030",
  deliveryFeeChargedBaht: "120",
  deliveryCostBaht: "120",
  deliveryFeePayer: "CUSTOMER",
  discountBaht: "20",
  amountPaidBaht: "200",
  deliveryLocation: "บางรัก กรุงเทพฯ",
  deliveryNote: "โทรก่อนส่ง",
  specialInstructions: "",
  items: [
    {
      productId: "00000000-0000-4000-8000-000000000040",
      quantity: "2",
      unitPriceBaht: "220",
      lineNote: "",
    },
    {
      productId: "00000000-0000-4000-8000-000000000050",
      quantity: "1",
      unitPriceBaht: "80",
      lineNote: "",
    },
  ],
} as const;

describe("order form boundary", () => {
  it("normalizes a valid baht form into satang order input", () => {
    const values = orderFormSchema.parse(VALID_FORM);

    expect(normalizeOrderForm(values)).toMatchObject({
      customerId: VALID_FORM.customerId,
      bakeCycleId: VALID_FORM.bakeCycleId,
      sourceChannel: "INSTAGRAM",
      requestedDeliveryDate: "2026-08-30",
      confirmedDeliveryDate: "2026-08-30",
      deliveryMethodId: VALID_FORM.deliveryMethodId,
      deliveryFeeChargedSatang: 12000,
      deliveryCostSatang: 12000,
      discountSatang: 2000,
      amountPaidSatang: 20000,
      items: [
        {
          productId: VALID_FORM.items[0].productId,
          quantity: 2,
          unitPriceSatang: 22000,
        },
        {
          productId: VALID_FORM.items[1].productId,
          quantity: 1,
          unitPriceSatang: 8000,
        },
      ],
    });
  });

  it.each([
    ["zero quantity", { items: [{ ...VALID_FORM.items[0], quantity: "0" }] }],
    ["three-decimal baht", { discountBaht: "1.001" }],
    ["empty items", { items: [] }],
    ["negative discount", { discountBaht: "-1" }],
  ])("rejects %s", (_name, change) => {
    expect(orderFormSchema.safeParse({ ...VALID_FORM, ...change }).success)
      .toBe(false);
  });

  it("returns live totals only while all financial fields and lines are valid", () => {
    expect(calculateOrderFormTotals(orderFormSchema.parse(VALID_FORM))).toEqual({
      subtotalSatang: 52000,
      grandTotalSatang: 62000,
      balanceSatang: 42000,
      overpaidSatang: 0,
      paymentStatus: "PARTIAL",
    });
    expect(calculateOrderFormTotals({ ...VALID_FORM, discountBaht: "" }))
      .toBeNull();
    expect(calculateOrderFormTotals({ ...VALID_FORM, customerId: "" }))
      .toBeNull();
  });
});
