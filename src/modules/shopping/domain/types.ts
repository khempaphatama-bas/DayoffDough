import type { BakeCycleStatus } from "@/modules/cycles/domain/cycle-lifecycle";
import type { PlanningGenerationSummary } from "@/modules/planning/application/planning-queries";
import type { UnitCode } from "@/modules/units/domain/units";

export type ShoppingStatus = "TO_BUY" | "PARTIAL" | "COMPLETE";

export type ShoppingRecommendation = Readonly<{
  shortfallQuantity: string;
  suggestedPackCount: number;
  suggestedPurchaseQuantity: string;
  estimatedCostSatang: number | null;
}>;

export type ShoppingItemProgress = Readonly<{
  status: ShoppingStatus;
  purchasedQuantity: string;
  remainingQuantity: string;
  overageQuantity: string;
}>;

export type StockRequirementCategory = "INGREDIENT" | "PACKAGING";

export type SnapshotRequirementInput = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryCategory: StockRequirementCategory;
  baseUnit: UnitCode;
  priceSnapshotId: string;
  unitCostSatang: string | null;
  plannedRequirement: string;
}>;

export type AggregateSnapshotRequirementsInput = Readonly<{
  materials: ReadonlyArray<SnapshotRequirementInput>;
  packaging: ReadonlyArray<SnapshotRequirementInput>;
}>;

export type StockRequirement = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryCategory: StockRequirementCategory;
  baseUnit: UnitCode;
  priceSnapshotId: string;
  unitCostSatang: string | null;
  requiredQuantity: string;
}>;

export type ShoppingRecommendationInput = Readonly<{
  requiredQuantity: string;
  countedQuantity: string;
  packBaseQuantity: string;
  unitCostSatang: string | null;
}>;

export type StockCountCandidate = StockRequirement &
  Readonly<{
    purchaseUnitLabel: string;
    baseQuantityPerPurchasePack: string;
    systemBalance: string;
  }>;

export type CycleInventoryCountView = Readonly<{
  id: string;
  cycleId: string;
  planningSnapshotId: string;
  inventoryItemId: string;
  priceSnapshotId: string;
  inventoryItemName: string;
  inventoryCategory: StockRequirementCategory;
  baseUnit: UnitCode;
  requiredQuantity: string;
  systemBalanceBeforeCount: string;
  countedQuantity: string;
  countDeltaQuantity: string;
  purchaseUnitLabel: string;
  baseQuantityPerPurchasePack: string;
  countMovementId: string;
  countedAt: Date;
  confirmationRequestId: string;
  createdAt: Date;
}>;

export type CyclePurchaseEntryView = Readonly<{
  id: string;
  cycleId: string;
  planningSnapshotId: string;
  shoppingItemId: string;
  inventoryItemId: string;
  purchaseRequestId: string;
  packCount: number;
  packBaseQuantity: string;
  purchasedQuantity: string;
  totalPriceSatang: number;
  purchasedFrom: string | null;
  occurredAt: Date;
  notes: string | null;
  inventoryMovementId: string;
  inventoryPriceId: string;
  createdAt: Date;
}>;

export type CycleShoppingItemView = ShoppingRecommendation &
  Readonly<{
    id: string;
    cycleId: string;
    planningSnapshotId: string;
    inventoryCountId: string;
    inventoryItemId: string;
    inventoryItemName: string;
    inventoryCategory: StockRequirementCategory;
    baseUnit: UnitCode;
    requiredQuantity: string;
    countedQuantity: string;
    purchaseUnitLabel: string;
    baseQuantityPerPurchasePack: string;
    createdAt: Date;
    progress: ShoppingItemProgress;
    purchases: ReadonlyArray<CyclePurchaseEntryView>;
  }>;

export type CycleShoppingHeader = Readonly<{
  cycleId: string;
  cycleNumber: number;
  cycleName: string;
  cycleStatus: BakeCycleStatus;
  planningSnapshotId: string | null;
  generation: number | null;
  planningStatus: "ACTIVE" | "SUPERSEDED" | null;
}>;

export type CountRequiredView = Readonly<{
  kind: "COUNT_REQUIRED";
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  items: ReadonlyArray<StockCountCandidate>;
  writable: true;
}>;

export type ShoppingView = Readonly<{
  kind: "SHOPPING";
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  confirmedAt: Date;
  counts: ReadonlyArray<CycleInventoryCountView>;
  items: ReadonlyArray<CycleShoppingItemView>;
  writable: boolean;
}>;

export type HistoryView = Readonly<{
  kind: "HISTORY";
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  confirmedAt: Date | null;
  counts: ReadonlyArray<CycleInventoryCountView>;
  items: ReadonlyArray<CycleShoppingItemView>;
  writable: false;
}>;

export type NoPlanView = Readonly<{
  kind: "NO_PLAN";
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  writable: false;
}>;

export type CycleStockShoppingView =
  | CountRequiredView
  | ShoppingView
  | HistoryView
  | NoPlanView;
