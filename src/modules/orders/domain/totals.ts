export type CalculatedPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

export type OrderTotalsInput = Readonly<{
  items: ReadonlyArray<
    Readonly<{ quantity: number; unitPriceSatang: number }>
  >;
  discountSatang: number;
  deliveryFeeChargedSatang: number;
  amountPaidSatang: number;
}>;

export type OrderTotals = Readonly<{
  subtotalSatang: number;
  grandTotalSatang: number;
  balanceSatang: number;
  overpaidSatang: number;
  paymentStatus: CalculatedPaymentStatus;
}>;

function requireNonNegativeMoney(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function requirePositiveQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive safe integer");
  }
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error("Order total exceeds the safe integer range");
  }
  return result;
}

function checkedMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error("Order total exceeds the safe integer range");
  }
  return result;
}

export function derivePaymentStatus(
  grandTotalSatang: number,
  amountPaidSatang: number,
): CalculatedPaymentStatus {
  requireNonNegativeMoney(grandTotalSatang, "Grand total");
  requireNonNegativeMoney(amountPaidSatang, "Amount paid");

  if (amountPaidSatang === 0) {
    return "UNPAID";
  }
  if (amountPaidSatang < grandTotalSatang) {
    return "PARTIAL";
  }
  return "PAID";
}

export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  requireNonNegativeMoney(input.discountSatang, "Discount");
  requireNonNegativeMoney(
    input.deliveryFeeChargedSatang,
    "Delivery fee charged",
  );
  requireNonNegativeMoney(input.amountPaidSatang, "Amount paid");

  let subtotalSatang = 0;
  for (const item of input.items) {
    requirePositiveQuantity(item.quantity);
    requireNonNegativeMoney(item.unitPriceSatang, "Unit price");
    subtotalSatang = checkedAdd(
      subtotalSatang,
      checkedMultiply(item.quantity, item.unitPriceSatang),
    );
  }

  const totalBeforeDiscountSatang = checkedAdd(
    subtotalSatang,
    input.deliveryFeeChargedSatang,
  );
  if (input.discountSatang > totalBeforeDiscountSatang) {
    throw new Error("Discount makes grand total negative");
  }

  const grandTotalSatang = totalBeforeDiscountSatang - input.discountSatang;

  return {
    subtotalSatang,
    grandTotalSatang,
    balanceSatang: Math.max(grandTotalSatang - input.amountPaidSatang, 0),
    overpaidSatang: Math.max(input.amountPaidSatang - grandTotalSatang, 0),
    paymentStatus: derivePaymentStatus(
      grandTotalSatang,
      input.amountPaidSatang,
    ),
  };
}
