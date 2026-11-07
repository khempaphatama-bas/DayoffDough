import type { CycleShoppingHeader, SnapshotRequirementInput } from "@/modules/shopping/domain/types";
import type { PlanningGenerationSummary } from "@/modules/planning/application/planning-queries";

export type ConsumptionBasis = "PLANNED" | "OWNER_REPORTED";
export type StockEffectMode = "DIRECT" | "HISTORY_ONLY" | "COUNT_SETTLED";
export type ConsumptionSource = Readonly<{
  cycleId: string; planningSnapshotId: string; contextId: string;
}>;
export type UsageItemInput = Readonly<{
  inventoryItemId: string; usedQuantity: string;
  basis: ConsumptionBasis; reason: string | null;
}>;
export type LedgerExpectation = Readonly<{
  inventoryItemId: string; ledgerRevision: string;
  countMovementId: string | null;
}>;
export type UseIntent = ConsumptionSource & Readonly<{
  requestId: string; items: readonly UsageItemInput[];
  expectedLedger: readonly LedgerExpectation[];
}>;
export type ConfirmUseInput = UseIntent & Readonly<{
  confirmTakenOutOfUse: true; confirmEmpty: boolean; reason: string | null;
}>;
export type CorrectUseInput = UseIntent & Readonly<{
  expectedRevisionId: string; reason: string;
}>;
export type SettlementContextInput = ConsumptionSource & Readonly<{
  items: readonly UsageItemInput[]; confirmTakenOutOfUse: true;
}>;
export type SettleUseInput = Readonly<{
  requestId: string; contexts: readonly SettlementContextInput[];
  counts: readonly Readonly<{ inventoryItemId: string; remainingQuantity: string }>[];
  expectedLedger: readonly LedgerExpectation[]; reason: string;
}>;
export type ConsumptionWriteResult = Readonly<{
  operationId: string; revisionIds: readonly string[];
  countMovementIds: readonly string[]; replayed: boolean;
}>;
export type ConsumptionBlocker = Readonly<{ cycleId: string; cycleName: string }>;
export type ConsumptionActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
  stale: boolean;
  result: ConsumptionWriteResult | null;
  blockers: readonly ConsumptionBlocker[];
}>;
export type ConsumptionClock = Readonly<{ now(): Date }>;
export type ConsumptionRequirement = Pick<SnapshotRequirementInput,
  "inventoryItemId" | "inventoryItemName" | "inventoryCategory" | "baseUnit"
> & Readonly<{ priceSnapshotId: string | null; plannedQuantity: string }>;

export type ConsumptionCycleHeader = CycleShoppingHeader & Readonly<{
  consumptionPolicy: "LEGACY" | "CONSUMPTION_V1";
}>;
export type ConsumptionContextView = Readonly<{
  id: string; taskGenerationId: string; currentRevisionId: string | null; createdAt: Date;
}>;
export type ConsumptionStockView = LedgerExpectation & Readonly<{ balance: string }>;
export type ConsumptionRevisionItemView = ConsumptionRequirement & UsageItemInput & Readonly<{
  mode: StockEffectMode; quantityDelta: string; initialCountMovementId: string | null;
  movementId: string; settlementCountMovementId: string | null;
}>;
export type ConsumptionRevisionView = Readonly<{
  id: string; contextId: string; operationId: string; revisionNumber: number;
  previousRevisionId: string | null; reason: string | null; confirmedAt: Date;
  items: readonly ConsumptionRevisionItemView[];
}>;
// These are draft defaults, not actual-use claims. PLANNED values are estimates;
// unresolved cancelled use and physical COUNT inputs deliberately remain null.
export type ConsumptionUsageItemView = ConsumptionRequirement & Readonly<{
  usedQuantity: string | null; basis: ConsumptionBasis; reason: string | null;
  mode: StockEffectMode; quantityDelta: string | null;
}>;
type CycleConsumptionData = Readonly<{
  cycle: ConsumptionCycleHeader; generations: readonly PlanningGenerationSummary[];
  source: ConsumptionSource | null; context: ConsumptionContextView | null;
  currentRevision: ConsumptionRevisionView | null; history: readonly ConsumptionRevisionView[];
  requirements: readonly ConsumptionRequirement[]; items: readonly ConsumptionUsageItemView[];
  stock: readonly ConsumptionStockView[]; expectedLedger: readonly LedgerExpectation[];
}>;
export type CycleConsumptionView = CycleConsumptionData & (
  | Readonly<{ kind: "LEGACY" | "NO_PLAN" | "NOT_STARTED" | "HISTORY"; canConfirm: false; canCorrect: false }>
  | Readonly<{ kind: "PENDING_USE"; canConfirm: boolean; canCorrect: false }>
  | Readonly<{ kind: "RECORDED"; canConfirm: false; canCorrect: boolean }>
);
export type SettlementContextView = Readonly<{
  source: ConsumptionSource; cycle: ConsumptionCycleHeader;
  context: ConsumptionContextView; items: readonly ConsumptionUsageItemView[];
}>;
export type SettlementPreview = Readonly<{
  countedItemIds: readonly string[]; contexts: readonly SettlementContextView[];
  counts: readonly Readonly<{
    inventoryItemId: string; remainingQuantity: null; mode: "COUNT"; quantityDelta: null;
  }>[];
  stock: readonly ConsumptionStockView[]; expectedLedger: readonly LedgerExpectation[];
}>;

export type ConsumptionStateErrorKind =
  | "NOT_FOUND" | "INVALID_INPUT" | "STALE_DATA" | "INVALID_CYCLE_STATE"
  | "STOCK_CHECK_REQUIRED" | "PENDING_USE" | "INSUFFICIENT_STOCK"
  | "UNLOCK_BLOCKED" | "REQUEST_CONFLICT";
export type ConsumptionStateErrorDetails = Readonly<{
  blockerCycleIds?: readonly string[];
  shortages?: readonly Readonly<{
    inventoryItemId: string; availableQuantity: string; requiredQuantity: string;
  }>[];
}>;

export class ConsumptionStateError extends Error {
  constructor(
    readonly kind: ConsumptionStateErrorKind,
    message: string,
    readonly details: ConsumptionStateErrorDetails = {},
  ) {
    super(message);
    this.name = "ConsumptionStateError";
  }
}
