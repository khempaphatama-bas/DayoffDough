import type { CycleOperationsView, OperationsTask } from "@/modules/operations/domain/types";

export const CYCLE_ID = "72000000-0000-4000-8000-000000000001";
export const GENERATION_ID = "72000000-0000-4000-8000-000000000002";
export const TASK: OperationsTask = {
  id: "72000000-0000-4000-8000-000000000010", taskGenerationId: GENERATION_ID,
  origin: "TEMPLATE", sourceTemplateName: "ฟอคคาเซียประจำรอบ", sourceActivityName: "พักแป้ง",
  title: "พักแป้ง", productId: "72000000-0000-4000-8000-000000000004", productName: "ฟอคคาเซีย",
  batchCount: "2.000000", scheduledAt: new Date("2026-09-10T17:30:00.000Z"),
  estimatedDurationMinutes: 45, notes: null, sequence: 1, status: "PENDING", skipReason: null,
};
export const READY_VIEW = {
  kind: "READY",
  cycle: { id: CYCLE_ID, cycleNumber: 12, name: "รอบส่ง 12 ก.ย.", status: "LOCKED", targetProductionDate: "2026-09-11", primaryDeliveryDate: "2026-09-12" },
  cycleOptions: [{ id: CYCLE_ID, cycleNumber: 12, name: "รอบส่ง 12 ก.ย.", status: "LOCKED", primaryDeliveryDate: "2026-09-12" }],
  generation: { id: GENERATION_ID, planningSnapshotId: "72000000-0000-4000-8000-000000000003", generation: 2 },
  products: [{ id: TASK.productId!, name: "ฟอคคาเซีย" }, { id: "72000000-0000-4000-8000-000000000005", name: "บริยอช" }],
  tasks: [TASK], taskBuckets: { overdue: [], today: [TASK], future: [] }, orders: [], cancelledOrders: [],
  completion: { ready: false, remainingTaskCount: 1, remainingOrderCount: 0, unpaidOrderCount: 0, outstandingSatang: 0 },
} satisfies Extract<CycleOperationsView, { kind: "READY" }>;

export const NO_GENERATION_VIEW: Extract<CycleOperationsView, { kind: "NO_GENERATION" }> = {
  kind: "NO_GENERATION", cycle: READY_VIEW.cycle, cycleOptions: READY_VIEW.cycleOptions, reason: "LEGACY_PLAN",
};
