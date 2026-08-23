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
