import Decimal from "decimal.js";
import { calculateUnitCostSatang } from "@/modules/inventory/domain/cost";
import type {
  CostComponentInput,
  CostSummaryInput,
  CycleCostCalculation,
  ProductCostCalculation,
  ProductCostInput,
  RequirementPrice,
} from "./types";

const POSTGRESQL_INTEGER_MAX = new Decimal("2147483647");
const SAFE_INTEGER_MAX = new Decimal(Number.MAX_SAFE_INTEGER);

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
  return quantity;
}

function requireStoredInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  if (value > POSTGRESQL_INTEGER_MAX.toNumber()) {
    throw new Error(`${label} exceeds PostgreSQL integer range`);
  }
}

function requireCostComponent(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Cost component must be a non-negative safe integer");
  }
  if (value > POSTGRESQL_INTEGER_MAX.toNumber()) {
    throw new Error("Cost component exceeds PostgreSQL integer range");
  }
}

function sumCostComponents(values: CostComponentInput): number {
  let total = new Decimal(0);
  for (const value of values) {
    if (value === null) continue;
    requireCostComponent(value);
    total = total.plus(value);
    if (total.gt(POSTGRESQL_INTEGER_MAX)) {
      throw new Error("Cost total exceeds PostgreSQL integer range");
    }
  }
  return total.toNumber();
}

function hasMissingDirectCost(
  componentGroups: ReadonlyArray<CostComponentInput>,
): boolean {
  return componentGroups.some((components) =>
    components.some((component) => component === null),
  );
}

export function roundAtomicSatang(value: Decimal.Value): number {
  let cost: Decimal;
  try {
    cost = new Decimal(value);
  } catch {
    throw new Error("Atomic cost must be a non-negative finite value");
  }

  if (!cost.isFinite() || cost.lt(0)) {
    throw new Error("Atomic cost must be a non-negative finite value");
  }

  const roundedCost = cost.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (roundedCost.gt(SAFE_INTEGER_MAX)) {
    throw new Error("Atomic cost exceeds the safe integer range");
  }
  if (roundedCost.gt(POSTGRESQL_INTEGER_MAX)) {
    throw new Error("Atomic cost exceeds PostgreSQL integer range");
  }

  return roundedCost.toNumber();
}

export function calculateRequirementCost(
  quantity: string,
  price: RequirementPrice,
): number | null {
  if (price === null) return null;

  const unitCost = calculateUnitCostSatang(
    price.packPriceSatang,
    price.packBaseQuantity,
  );
  return roundAtomicSatang(unitCost.mul(quantity));
}

export function calculateLaborCost(
  laborMinutesPerBatch: number,
  selectedBatchCount: string,
  laborRateSatangPerHour: number,
): number {
  requireStoredInteger(laborMinutesPerBatch, "Labor minutes per batch");
  requireStoredInteger(laborRateSatangPerHour, "Labor rate");
  const batches = parsePositiveDecimal(
    selectedBatchCount,
    "Selected batch count",
  );

  const cost = new Decimal(laborRateSatangPerHour)
    .div(60)
    .mul(laborMinutesPerBatch)
    .mul(batches);
  return roundAtomicSatang(cost);
}

export function calculateUtilityCost(
  utilityCostSatangPerBatch: number,
  selectedBatchCount: string,
): number {
  requireStoredInteger(
    utilityCostSatangPerBatch,
    "Utility cost per batch",
  );
  const batches = parsePositiveDecimal(
    selectedBatchCount,
    "Selected batch count",
  );
  return roundAtomicSatang(
    new Decimal(utilityCostSatangPerBatch).mul(batches),
  );
}

export function calculateProductCost(
  input: ProductCostInput,
): ProductCostCalculation {
  const knownBaseIngredientCostSatang = sumCostComponents(
    input.baseIngredientCosts,
  );
  const knownWasteCostSatang = sumCostComponents(input.wasteCosts);
  const knownProductPackagingCostSatang = sumCostComponents(
    input.productPackagingCosts,
  );
  const laborCostSatang = sumCostComponents(input.laborCosts);
  const utilityCostSatang = sumCostComponents(input.utilityCosts);
  const knownProductionCostSatang = sumCostComponents([
    knownBaseIngredientCostSatang,
    knownWasteCostSatang,
    knownProductPackagingCostSatang,
    laborCostSatang,
    utilityCostSatang,
  ]);
  const costComplete = !hasMissingDirectCost([
    input.baseIngredientCosts,
    input.wasteCosts,
    input.productPackagingCosts,
  ]);

  return {
    knownBaseIngredientCostSatang,
    knownWasteCostSatang,
    knownProductPackagingCostSatang,
    laborCostSatang,
    utilityCostSatang,
    knownProductionCostSatang,
    completeProductionCostSatang: costComplete
      ? knownProductionCostSatang
      : null,
    costComplete,
    missingPriceCount: new Set(input.missingInventoryItemIds).size,
  };
}

export function calculateCycleCost(
  input: CostSummaryInput,
): CycleCostCalculation {
  const productCost = calculateProductCost(input);
  const knownDeliveryPackagingCostSatang = sumCostComponents(
    input.deliveryPackagingCosts,
  );
  const knownProductionCostSatang = sumCostComponents([
    productCost.knownProductionCostSatang,
    knownDeliveryPackagingCostSatang,
  ]);
  const costComplete =
    productCost.costComplete &&
    !hasMissingDirectCost([input.deliveryPackagingCosts]);

  return {
    knownBaseIngredientCostSatang:
      productCost.knownBaseIngredientCostSatang,
    knownWasteCostSatang: productCost.knownWasteCostSatang,
    knownProductPackagingCostSatang:
      productCost.knownProductPackagingCostSatang,
    knownDeliveryPackagingCostSatang,
    laborCostSatang: productCost.laborCostSatang,
    utilityCostSatang: productCost.utilityCostSatang,
    knownProductionCostSatang,
    completeProductionCostSatang: costComplete
      ? knownProductionCostSatang
      : null,
    costComplete,
    missingPriceCount: productCost.missingPriceCount,
  };
}
