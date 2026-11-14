import type { CycleConsumptionView, ConsumptionRevisionView, SettlementContextView, SettlementPreview } from "@/modules/consumption/domain/types";

// Browser-safe complete view data: deliberately no database/test-db imports.
export const CONSUMPTION_IDS = {
  cycle: "10000000-0000-4000-8000-000000000001",
  snapshot: "10000000-0000-4000-8000-000000000002",
  context: "10000000-0000-4000-8000-000000000003",
  generation: "10000000-0000-4000-8000-000000000004",
  flour: "10000000-0000-4000-8000-000000000005",
  bag: "10000000-0000-4000-8000-000000000006",
  revision: "10000000-0000-4000-8000-000000000007",
  count: "10000000-0000-4000-8000-000000000008",
  operation: "10000000-0000-4000-8000-000000000009",
  countedOnly: "10000000-0000-4000-8000-000000000010",
} as const;
const id = CONSUMPTION_IDS;
const requirements = [
  { inventoryItemId: id.flour, inventoryItemName: "แป้งขนมปังจากแผน", inventoryCategory: "INGREDIENT", baseUnit: "g", priceSnapshotId: null, plannedQuantity: "0.3" },
  { inventoryItemId: id.bag, inventoryItemName: "ถุงขนมจากแผน", inventoryCategory: "PACKAGING", baseUnit: "piece", priceSnapshotId: null, plannedQuantity: "2" },
] as const;
const expectedLedger = [
  { inventoryItemId: id.flour, ledgerRevision: "4", countMovementId: id.count },
  { inventoryItemId: id.bag, ledgerRevision: "2", countMovementId: null },
] as const;
export const USAGE_REVISION: ConsumptionRevisionView = {
  id: id.revision, contextId: id.context, operationId: id.operation, revisionNumber: 1,
  previousRevisionId: null, reason: null, confirmedAt: new Date("2026-10-24T03:00:00Z"),
  items: requirements.map((item, index) => ({
    ...item, usedQuantity: item.plannedQuantity, basis: "PLANNED", reason: null,
    mode: "DIRECT", quantityDelta: index === 0 ? "-0.3" : "-2", initialCountMovementId: null,
    movementId: index === 0 ? "20000000-0000-4000-8000-000000000001" : "20000000-0000-4000-8000-000000000002",
    settlementCountMovementId: null,
  })),
};
export const PENDING_USAGE: CycleConsumptionView = {
  kind: "PENDING_USE", canConfirm: true, canCorrect: false,
  cycle: { cycleId: id.cycle, cycleNumber: 12, cycleName: "รอบขนมวันหยุด", cycleStatus: "IN_PRODUCTION", planningSnapshotId: id.snapshot, generation: 1, planningStatus: "ACTIVE", consumptionPolicy: "CONSUMPTION_V1" },
  generations: [{ id: id.snapshot, cycleId: id.cycle, generation: 1, status: "ACTIVE", costComplete: true, lockedAt: new Date("2026-10-24T01:00:00Z"), unlockedAt: null, unlockReason: null, unlockedFromStatus: null }],
  source: { cycleId: id.cycle, planningSnapshotId: id.snapshot, contextId: id.context },
  context: { id: id.context, taskGenerationId: id.generation, currentRevisionId: null, createdAt: new Date("2026-10-24T02:00:00Z") },
  currentRevision: null, history: [], requirements,
  items: requirements.map((item) => ({ ...item, usedQuantity: item.plannedQuantity, basis: "PLANNED", reason: null, mode: "DIRECT", quantityDelta: item.inventoryItemId === id.flour ? "-0.3" : "-2" })),
  stock: expectedLedger.map((item, index) => ({ ...item, balance: index === 0 ? "10.7" : "8" })),
  expectedLedger,
};
export const CANCELLED_USAGE: CycleConsumptionView = {
  ...PENDING_USAGE, kind: "PENDING_USE", canConfirm: true, canCorrect: false,
  cycle: { ...PENDING_USAGE.cycle, cycleStatus: "CANCELLED" },
  items: requirements.map((item) => ({ ...item, usedQuantity: null, basis: "OWNER_REPORTED", reason: null, mode: "DIRECT", quantityDelta: null })),
};
export const RECORDED_USAGE: CycleConsumptionView = {
  ...PENDING_USAGE, kind: "RECORDED", canConfirm: false, canCorrect: true,
  cycle: { ...PENDING_USAGE.cycle, cycleStatus: "COMPLETED" },
  context: { ...PENDING_USAGE.context!, currentRevisionId: id.revision },
  currentRevision: USAGE_REVISION, history: [USAGE_REVISION],
  items: PENDING_USAGE.items.map((item, index) => ({ ...item, mode: index === 0 ? "HISTORY_ONLY" : "DIRECT", quantityDelta: "0" })),
};
export const HISTORY_USAGE: CycleConsumptionView = {
  ...RECORDED_USAGE, kind: "HISTORY", canConfirm: false, canCorrect: false,
  cycle: { ...RECORDED_USAGE.cycle, planningStatus: "SUPERSEDED" },
};
export const LEGACY_USAGE: CycleConsumptionView = {
  ...PENDING_USAGE, kind: "LEGACY", canConfirm: false, canCorrect: false,
  cycle: { ...PENDING_USAGE.cycle, consumptionPolicy: "LEGACY" },
  source: null, context: null, currentRevision: null, history: [], requirements: [], items: [], stock: [], expectedLedger: [],
};

export const SETTLEMENT_PREVIEW: SettlementPreview = {
  countedItemIds: [id.flour],
  counts: [{ inventoryItemId: id.flour, inventoryItemName: "แป้งชื่อปัจจุบัน", baseUnit: "kg", remainingQuantity: null, mode: "COUNT", quantityDelta: null }],
  contexts: [{ source: PENDING_USAGE.source!, cycle: PENDING_USAGE.cycle, context: PENDING_USAGE.context!, items: PENDING_USAGE.items.map(item => ({ ...item, mode: item.inventoryItemId === id.flour ? "COUNT_SETTLED" : "DIRECT", quantityDelta: item.inventoryItemId === id.flour ? "0" : "-2" })) }],
  stock: PENDING_USAGE.stock, expectedLedger: PENDING_USAGE.expectedLedger,
};
// An owned selected item may have no pending context at all. Its identity and
// stock tokens are present without inventing a snapshot label or usage line.
export const MIXED_SETTLEMENT_PREVIEW: SettlementPreview = {
  ...SETTLEMENT_PREVIEW,
  countedItemIds: [id.flour, id.countedOnly],
  counts: [...SETTLEMENT_PREVIEW.counts, { inventoryItemId: id.countedOnly, inventoryItemName: "น้ำตาลทราย", baseUnit: "kg", remainingQuantity: null, mode: "COUNT", quantityDelta: null }],
  stock: [...SETTLEMENT_PREVIEW.stock, { inventoryItemId: id.countedOnly, ledgerRevision: "3", countMovementId: null, balance: "9.25" }],
  expectedLedger: [...SETTLEMENT_PREVIEW.expectedLedger, { inventoryItemId: id.countedOnly, ledgerRevision: "3", countMovementId: null }],
};
export const CANCELLED_SETTLEMENT: SettlementPreview = {
  ...SETTLEMENT_PREVIEW,
  contexts: [{ ...SETTLEMENT_PREVIEW.contexts[0]!, cycle: CANCELLED_USAGE.cycle, items: CANCELLED_USAGE.items.map(item => ({ ...item, mode: item.inventoryItemId === id.flour ? "COUNT_SETTLED" : "DIRECT" })) }],
};
export const RELATED_SETTLEMENT_CONTEXT: SettlementContextView = {
  source: { cycleId: "20000000-0000-4000-8000-000000000001", planningSnapshotId: "20000000-0000-4000-8000-000000000002", contextId: "20000000-0000-4000-8000-000000000003" },
  context: { id: "20000000-0000-4000-8000-000000000003", taskGenerationId: "20000000-0000-4000-8000-000000000004", currentRevisionId: null, createdAt: new Date("2026-10-25T02:00:00Z") },
  cycle: { ...PENDING_USAGE.cycle, cycleId: "20000000-0000-4000-8000-000000000001", planningSnapshotId: "20000000-0000-4000-8000-000000000002", cycleNumber: 13, cycleName: "รอบเกี่ยวข้อง" },
  items: SETTLEMENT_PREVIEW.contexts[0]!.items.map(item => item.inventoryItemId === id.bag ? { ...item, plannedQuantity: "1.75", usedQuantity: "1.75", quantityDelta: "-1.75" } : item),
};
