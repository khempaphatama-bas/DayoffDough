import type { SnapshotRequirementInput } from "@/modules/shopping/domain/types";

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
export type ConsumptionClock = Readonly<{ now(): Date }>;
export type ConsumptionRequirement = Pick<SnapshotRequirementInput,
  "inventoryItemId" | "inventoryItemName" | "inventoryCategory" | "baseUnit" | "priceSnapshotId"
> & Readonly<{ plannedQuantity: string }>;

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
