import type { UnitCode } from "@/modules/units/domain/units";

export type BatchPlanInput = Readonly<{
  orderedQuantity: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  sellingUnit: UnitCode;
  selectedBatchCount?: string;
}>;

export type ProductBatchPlan = Readonly<{
  orderedQuantity: string;
  yieldInSellingUnit: string;
  suggestedBatchCount: number;
  selectedBatchCount: string;
  plannedOutput: string;
  outputDifference: string;
}>;

export type WasteSelection = Readonly<{
  percent: string;
  source: "RECIPE" | "SHOP_DEFAULT";
}>;

export type MaterialRequirementInput = Readonly<{
  quantityPerBatch: string;
  selectedBatchCount: string;
  wasteAllowancePercent: string;
}>;

export type MaterialRequirementCalculation = Readonly<{
  baseRequirement: string;
  wasteQuantity: string;
  plannedRequirement: string;
}>;

export type RequirementPrice = Readonly<{
  packPriceSatang: number;
  packBaseQuantity: string;
}> | null;

export type PackagingRequirementCalculation = Readonly<{
  multiplier: string;
  plannedRequirement: string;
}>;

export type PackagingRequirementInput = Readonly<{
  basis: "PER_PRODUCT_UNIT" | "PER_ORDER" | "PER_DELIVERY";
  ruleQuantity: string;
  plannedOutput: string;
  distinctOrderCount: number;
}>;

export type CostComponentInput = ReadonlyArray<number | null>;

export type CostSummaryInput = Readonly<{
  baseIngredientCosts: CostComponentInput;
  wasteCosts: CostComponentInput;
  productPackagingCosts: CostComponentInput;
  deliveryPackagingCosts: CostComponentInput;
  laborCosts: ReadonlyArray<number>;
  utilityCosts: ReadonlyArray<number>;
  missingInventoryItemIds: ReadonlyArray<string>;
}>;

export type ProductCostInput = Omit<
  CostSummaryInput,
  "deliveryPackagingCosts"
>;

export type ProductCostCalculation = Readonly<{
  knownBaseIngredientCostSatang: number;
  knownWasteCostSatang: number;
  knownProductPackagingCostSatang: number;
  laborCostSatang: number;
  utilityCostSatang: number;
  knownProductionCostSatang: number;
  completeProductionCostSatang: number | null;
  costComplete: boolean;
  missingPriceCount: number;
}>;

export type CycleCostCalculation = ProductCostCalculation &
  Readonly<{
    knownDeliveryPackagingCostSatang: number;
  }>;
