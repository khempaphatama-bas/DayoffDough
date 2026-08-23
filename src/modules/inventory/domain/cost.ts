import Decimal from "decimal.js";

// A non-tie numeric(18,6) ratio is more than 5e-19 from a half-integer.
// Forty digits keep the internal error far below that boundary, while
// ceiling prevents an exact repeating half-tie from drifting below half.
const UnitCostDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_CEIL,
});

export function calculateUnitCostSatang(
  packPriceSatang: number,
  packBaseQuantity: Decimal.Value,
): Decimal {
  if (!Number.isSafeInteger(packPriceSatang) || packPriceSatang < 0) {
    throw new Error("Pack price must be a non-negative safe integer");
  }
  const quantity = new UnitCostDecimal(packBaseQuantity);
  if (quantity.lte(0)) {
    throw new Error("Pack base quantity must be greater than zero");
  }
  return new UnitCostDecimal(packPriceSatang).div(quantity);
}
