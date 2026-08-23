import Decimal from "decimal.js";
import {
  convertQuantity,
  UnitConversionError,
} from "@/modules/units/domain/units";
import type { BatchPlanInput, ProductBatchPlan } from "./types";

const POSTGRESQL_INTEGER_MAX = new Decimal("2147483647");
const QUANTITY_DECIMAL_PLACES = 6;

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

export function calculateBatchPlan(input: BatchPlanInput): ProductBatchPlan {
  const orderedQuantity = parsePositiveDecimal(
    input.orderedQuantity,
    "Ordered quantity",
  );
  const baseYieldQuantity = parsePositiveDecimal(
    input.baseYieldQuantity,
    "Base yield",
  );

  let yieldInSellingUnit: Decimal;
  try {
    yieldInSellingUnit = convertQuantity(
      baseYieldQuantity,
      input.yieldUnit,
      input.sellingUnit,
    );
  } catch (error) {
    if (error instanceof UnitConversionError) {
      throw new Error("Incompatible yield unit");
    }
    throw error;
  }

  const suggestedBatchCount = orderedQuantity.div(yieldInSellingUnit).ceil();
  if (suggestedBatchCount.gt(POSTGRESQL_INTEGER_MAX)) {
    throw new Error("Suggested batch count exceeds PostgreSQL integer range");
  }

  const selectedBatchCount =
    input.selectedBatchCount === undefined
      ? suggestedBatchCount
      : parsePositiveDecimal(input.selectedBatchCount, "Selected batch count");
  const plannedOutput = selectedBatchCount.mul(yieldInSellingUnit);

  return {
    orderedQuantity: orderedQuantity.toString(),
    yieldInSellingUnit: yieldInSellingUnit.toString(),
    suggestedBatchCount: suggestedBatchCount.toNumber(),
    selectedBatchCount: selectedBatchCount.toString(),
    plannedOutput: plannedOutput.toString(),
    outputDifference: plannedOutput.minus(orderedQuantity).toString(),
  };
}
