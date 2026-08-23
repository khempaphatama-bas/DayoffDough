import Decimal from "decimal.js";

// Planning multiplies this ratio by another numeric(18,6) quantity before
// rounding. Forty digits keep non-tie error below 5e-19, while ceiling keeps
// an exact repeating half-tie from drifting below the final HALF_UP boundary.
const PlanningUnitCostDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_CEIL,
});

export function calculateUnitCostSatang(
  packPriceSatang: number,
  packBaseQuantity: Decimal.Value,
  mode: "DEFAULT" | "PLANNING_EXACT" = "DEFAULT",
): Decimal {
  if (!Number.isSafeInteger(packPriceSatang) || packPriceSatang < 0) {
    throw new Error("Pack price must be a non-negative safe integer");
  }
  const UnitCostDecimal =
    mode === "PLANNING_EXACT" ? PlanningUnitCostDecimal : Decimal;
  const quantity = new UnitCostDecimal(packBaseQuantity);
  if (quantity.lte(0)) {
    throw new Error("Pack base quantity must be greater than zero");
  }
  return new UnitCostDecimal(packPriceSatang).div(quantity);
}
