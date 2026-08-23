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

export type PlanningCycleSnapshot = Readonly<{
  id: string;
  cycleNumber: number;
  name: string;
  status:
    | "DRAFT"
    | "OPEN"
    | "LOCKED"
    | "IN_PRODUCTION"
    | "COMPLETED"
    | "CANCELLED";
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string | null;
}>;

export type PlanningSettingsSnapshot = Readonly<{
  laborRateSatangPerHour: number;
  defaultWasteAllowancePercent: string;
  timezone: string;
  currency: string;
}>;

export type PlanningSourceOrderItem = Readonly<{
  id: string;
  productId: string;
  productName: string;
  sellingUnit: UnitCode;
  quantity: number;
  unitPriceSatang: number;
  lineNote: string | null;
}>;

export type PlanningSourceOrder = Readonly<{
  id: string;
  customerId: string;
  customerName: string;
  deliveryMethodId: string | null;
  deliveryMethodName: string | null;
  deliveryRequiresLocation: boolean;
  requestedDeliveryDate: string | null;
  confirmedDeliveryDate: string | null;
  deliveryLocation: string | null;
  deliveryNote: string | null;
  specialInstructions: string | null;
  sourceChannel: "INSTAGRAM" | "FACEBOOK" | "PHONE" | "OTHER" | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  fulfillmentStatus:
    | "NEW"
    | "CONFIRMED"
    | "IN_PRODUCTION"
    | "PACKED"
    | "DELIVERED"
    | "CANCELLED";
  deliveryFeePayer: "CUSTOMER" | "BAKERY" | "SHARED";
  deliveryFeeChargedSatang: number;
  deliveryCostSatang: number;
  discountSatang: number;
  amountPaidSatang: number;
  items: ReadonlyArray<PlanningSourceOrderItem>;
}>;

export type PlanningSourceRecipe = Readonly<{
  recipeId: string;
  recipeName: string;
  recipeVersionId: string;
  versionCode: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string | null;
  instructions: string;
  ingredients: ReadonlyArray<
    Readonly<{
      recipeIngredientId: string;
      inventoryItemId: string;
      quantityInBaseUnit: string;
    }>
  >;
}>;

export type PlanningSourceProduct = Readonly<{
  id: string;
  name: string;
  sellingUnit: UnitCode;
  activeRecipe: PlanningSourceRecipe | null;
}>;

export type PlanningSourcePackagingRule = Readonly<{
  id: string;
  scope: "PRODUCT" | "DELIVERY_METHOD";
  productId: string | null;
  deliveryMethodId: string | null;
  targetName: string;
  inventoryItemId: string;
  consumptionBasis: "PER_PRODUCT_UNIT" | "PER_ORDER" | "PER_DELIVERY";
  quantityInBaseUnit: string;
}>;

export type PlanningSourceInventoryItem = Readonly<{
  id: string;
  name: string;
  category: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
  baseUnit: UnitCode;
  price: Readonly<{
    id: string;
    packPriceSatang: number;
    packBaseQuantity: string;
    effectiveAt: Date;
  }> | null;
}>;

export type PlanningSourceData = Readonly<{
  calculatedAt: Date;
  cycle: PlanningCycleSnapshot;
  settings: PlanningSettingsSnapshot;
  orders: ReadonlyArray<PlanningSourceOrder>;
  products: ReadonlyArray<PlanningSourceProduct>;
  packagingRules: ReadonlyArray<PlanningSourcePackagingRule>;
  inventoryItems: ReadonlyArray<PlanningSourceInventoryItem>;
}>;

export const PLANNING_ISSUE_MESSAGES = {
  CYCLE_NOT_OPEN: "รอบผลิตต้องอยู่ในสถานะเปิดก่อนล็อก",
  MISSING_PRIMARY_DELIVERY_DATE: "รอบผลิตยังไม่มีวันส่งหลัก",
  NO_ACTIVE_ORDERS: "ยังไม่มีออเดอร์ที่ใช้คำนวณ",
  ORDER_WITHOUT_ITEMS: "มีออเดอร์ที่ไม่มีรายการสินค้า",
  MISSING_ACTIVE_RECIPE: "สินค้ายังไม่มีสูตรที่เปิดใช้งาน",
  INVALID_RECIPE_YIELD: "ผลผลิตของสูตรต้องมากกว่า 0",
  INCOMPATIBLE_YIELD_UNIT: "หน่วยผลผลิตของสูตรแปลงเป็นหน่วยขายไม่ได้",
  INVALID_INGREDIENT_QUANTITY: "ปริมาณวัตถุดิบในสูตรต้องมากกว่า 0",
  INVALID_BATCH_OVERRIDE: "จำนวนแบตช์ที่เลือกต้องมากกว่า 0",
  MISSING_OVERRIDE_REASON: "กรุณาระบุเหตุผลที่เปลี่ยนจำนวนแบตช์",
  MISSING_INVENTORY_PRICE: "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
  ORDER_UNPAID: "มีออเดอร์ที่ยังไม่ชำระเงิน",
  ORDER_PARTIAL: "มีออเดอร์ที่ชำระเงินบางส่วน",
  MISSING_DELIVERY_LOCATION: "ออเดอร์ยังไม่มีสถานที่จัดส่ง",
  DELIVERY_DATE_MISMATCH: "วันส่งของออเดอร์ไม่ตรงกับวันส่งหลักของรอบ",
  PLANNED_SHORTFALL: "แผนนี้ผลิตได้น้อยกว่ายอดสั่ง",
} as const;

export type PlanningIssue = Readonly<{
  code: keyof typeof PLANNING_ISSUE_MESSAGES;
  scope: "CYCLE" | "ORDER" | "PRODUCT" | "INVENTORY_ITEM";
  sourceEntityId: string | null;
  message: string;
  context: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type BatchOverride = Readonly<{
  productId: string;
  selectedBatchCount: string;
  reason: string;
}>;

export type PlanningOrderSnapshot = PlanningSourceOrder &
  Readonly<{
    subtotalSatang: number;
    grandTotalSatang: number;
    balanceSatang: number;
  }>;

export type PlanningRecipePlan = Readonly<{
  productId: string;
  recipeId: string;
  recipeVersionId: string;
  recipeName: string;
  versionCode: string;
  instructions: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  yieldInSellingUnit: string;
  sellingUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string;
  wasteAllowanceSource: "RECIPE" | "SHOP_DEFAULT";
}>;

export type PlanningProductPlan = ProductBatchPlan &
  Readonly<{
    productId: string;
    productName: string;
    sellingUnit: UnitCode;
    overrideReason: string | null;
  }>;

export type PlanningInventoryPrice = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryCategory: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
  baseUnit: UnitCode;
  sourcePriceId: string | null;
  packPriceSatang: number | null;
  packBaseQuantity: string | null;
  effectiveAt: Date | null;
  unitCostSatang: string | null;
}>;

export type PlanningMaterialRequirement = MaterialRequirementCalculation &
  Readonly<{
    productId: string;
    recipeIngredientId: string;
    inventoryItemId: string;
    inventoryItemName: string;
    baseUnit: UnitCode;
    quantityPerBatch: string;
    selectedBatchCount: string;
    wasteAllowancePercent: string;
    baseCostSatang: number | null;
    wasteCostSatang: number | null;
  }>;

export type PlanningPackagingRequirement =
  PackagingRequirementCalculation &
    Readonly<{
      packagingRuleId: string;
      scope: "PRODUCT" | "DELIVERY_METHOD";
      consumptionBasis: "PER_PRODUCT_UNIT" | "PER_ORDER" | "PER_DELIVERY";
      productId: string | null;
      deliveryMethodId: string | null;
      targetName: string;
      inventoryItemId: string;
      inventoryItemName: string;
      baseUnit: UnitCode;
      ruleQuantity: string;
      costSatang: number | null;
    }>;

export type PlanningProductCost = ProductCostCalculation &
  Readonly<{
    productId: string;
  }>;

export type PlanningCycleCost = CycleCostCalculation;

export type PlanningPreview = Readonly<{
  calculatedAt: Date;
  cycle: PlanningCycleSnapshot;
  inputFingerprint: string;
  blockers: ReadonlyArray<PlanningIssue>;
  warnings: ReadonlyArray<PlanningIssue>;
  orderSnapshots: ReadonlyArray<PlanningOrderSnapshot>;
  productPlans: ReadonlyArray<PlanningProductPlan>;
  recipePlans: ReadonlyArray<PlanningRecipePlan>;
  inventoryPrices: ReadonlyArray<PlanningInventoryPrice>;
  materialRequirements: ReadonlyArray<PlanningMaterialRequirement>;
  packagingRequirements: ReadonlyArray<PlanningPackagingRequirement>;
  productCosts: ReadonlyArray<PlanningProductCost>;
  cycleCost: PlanningCycleCost;
}>;
