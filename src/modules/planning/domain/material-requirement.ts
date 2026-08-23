import Decimal from "decimal.js";
import type {
  MaterialRequirementCalculation,
  MaterialRequirementInput,
  WasteSelection,
} from "./types";

const QUANTITY_DECIMAL_PLACES = 6;
const WASTE_DECIMAL_PLACES = 4;

function parsePositiveDecimal(value: string, label: string): Decimal {
  let quantity: Decimal;
  try {
    quantity = new Decimal(value);
  } catch {
    throw new Error(`${label} must be greater than zero`);
  }

  if (!quantity.isFinite() || !quantity.gt(0)) {
    throw new Error(`${label} must be greater than zero`);
  }
  if (quantity.decimalPlaces() > QUANTITY_DECIMAL_PLACES) {
    throw new Error(`${label} must have at most 6 decimal places`);
  }
  return quantity;
}

function parseWastePercentage(value: string): Decimal {
  let percentage: Decimal;
  try {
    percentage = new Decimal(value);
  } catch {
    throw new Error(
      "Waste allowance must be between 0 and 100 with up to 4 decimal places",
    );
  }

  if (
    !percentage.isFinite() ||
    percentage.lt(0) ||
    percentage.gt(100) ||
    percentage.decimalPlaces() > WASTE_DECIMAL_PLACES
  ) {
    throw new Error(
      "Waste allowance must be between 0 and 100 with up to 4 decimal places",
    );
  }
  return percentage;
}

export function resolveWasteAllowance(
  recipePercent: string | null,
  shopPercent: string,
): WasteSelection {
  const source = recipePercent === null ? "SHOP_DEFAULT" : "RECIPE";
  const percentage = parseWastePercentage(
    recipePercent === null ? shopPercent : recipePercent,
  );
  return { percent: percentage.toString(), source };
}

export function calculateMaterialRequirement(
  input: MaterialRequirementInput,
): MaterialRequirementCalculation {
  const quantityPerBatch = parsePositiveDecimal(
    input.quantityPerBatch,
    "Ingredient quantity",
  );
  const selectedBatchCount = parsePositiveDecimal(
    input.selectedBatchCount,
    "Selected batch count",
  );
  const wasteAllowancePercent = parseWastePercentage(
    input.wasteAllowancePercent,
  );

  const baseRequirement = quantityPerBatch.mul(selectedBatchCount);
  const wasteQuantity = baseRequirement.mul(wasteAllowancePercent).div(100);

  return {
    baseRequirement: baseRequirement.toString(),
    wasteQuantity: wasteQuantity.toString(),
    plannedRequirement: baseRequirement.plus(wasteQuantity).toString(),
  };
}
