import Decimal from "decimal.js";

export function calculateUnitCostSatang(
  packPriceSatang: number,
  packBaseQuantity: Decimal.Value,
): Decimal {
  if (!Number.isSafeInteger(packPriceSatang) || packPriceSatang < 0) {
    throw new Error("Pack price must be a non-negative safe integer");
  }
  const quantity = new Decimal(packBaseQuantity);
  if (quantity.lte(0)) {
    throw new Error("Pack base quantity must be greater than zero");
  }
  return new Decimal(packPriceSatang).div(quantity);
}
