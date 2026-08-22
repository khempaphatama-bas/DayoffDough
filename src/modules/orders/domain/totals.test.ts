import { describe, expect, it } from "vitest";
import { calculateOrderTotals, derivePaymentStatus } from "./totals";

describe("order totals", () => {
  it("calculates items, discount, delivery, balance, and partial payment", () => {
    expect(calculateOrderTotals({
      items: [
        { quantity: 2, unitPriceSatang: 22000 },
        { quantity: 1, unitPriceSatang: 8000 },
      ],
      discountSatang: 2000,
      deliveryFeeChargedSatang: 12000,
      amountPaidSatang: 20000,
    })).toEqual({
      subtotalSatang: 52000,
      grandTotalSatang: 62000,
      balanceSatang: 42000,
      overpaidSatang: 0,
      paymentStatus: "PARTIAL",
    });
  });

  it.each([
    [0, 10000, "UNPAID"],
    [1, 10000, "PARTIAL"],
    [10000, 10000, "PAID"],
    [12000, 10000, "PAID"],
  ] as const)("derives payment from %i paid against %i", (paid, total, status) => {
    expect(derivePaymentStatus(total, paid)).toBe(status);
  });

  it("reports overpayment and rejects a discount larger than items plus delivery", () => {
    expect(calculateOrderTotals({
      items: [{ quantity: 1, unitPriceSatang: 10000 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 12000,
    }).overpaidSatang).toBe(2000);

    expect(() => calculateOrderTotals({
      items: [{ quantity: 1, unitPriceSatang: 1000 }],
      discountSatang: 2000,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    })).toThrow("Discount makes grand total negative");
  });

  it("keeps a zero-total order unpaid when nothing has been paid", () => {
    expect(calculateOrderTotals({
      items: [],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    }).paymentStatus).toBe("UNPAID");
  });

  it.each([
    {
      items: [{ quantity: 0, unitPriceSatang: 1000 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    },
    {
      items: [{ quantity: 1.5, unitPriceSatang: 1000 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    },
    {
      items: [{ quantity: 1, unitPriceSatang: -1 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    },
    {
      items: [{ quantity: 1, unitPriceSatang: 1000 }],
      discountSatang: -1,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    },
    {
      items: [{ quantity: 1, unitPriceSatang: 1000 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: Number.MAX_SAFE_INTEGER + 1,
      amountPaidSatang: 0,
    },
    {
      items: [{ quantity: 1, unitPriceSatang: 1000 }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: -1,
    },
  ])("rejects invalid quantities and money", (input) => {
    expect(() => calculateOrderTotals(input)).toThrow();
  });

  it("rejects arithmetic that exceeds the safe integer range", () => {
    expect(() => calculateOrderTotals({
      items: [{ quantity: 2, unitPriceSatang: Number.MAX_SAFE_INTEGER }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 0,
      amountPaidSatang: 0,
    })).toThrow();

    expect(() => calculateOrderTotals({
      items: [{ quantity: 1, unitPriceSatang: Number.MAX_SAFE_INTEGER }],
      discountSatang: 0,
      deliveryFeeChargedSatang: 1,
      amountPaidSatang: 0,
    })).toThrow();
  });

  it.each([
    [-1, 0],
    [0, -1],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid payment inputs", (total, paid) => {
    expect(() => derivePaymentStatus(total, paid)).toThrow();
  });
});
