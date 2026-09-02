export const bakeCycleStatus = [
  "DRAFT",
  "OPEN",
  "LOCKED",
  "IN_PRODUCTION",
  "COMPLETED",
  "CANCELLED",
] as const;

export type BakeCycleStatus = (typeof bakeCycleStatus)[number];

export const BAKE_CYCLE_STATUS_TRANSITIONS = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["DRAFT", "CANCELLED"],
  LOCKED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Readonly<
  Record<BakeCycleStatus, ReadonlyArray<BakeCycleStatus>>
>;

export const CYCLE_STATUS_LABELS: Readonly<
  Record<BakeCycleStatus, string>
> = {
  DRAFT: "แบบร่าง",
  OPEN: "เปิดรับออเดอร์",
  LOCKED: "ล็อกรอบแล้ว",
  IN_PRODUCTION: "กำลังผลิต",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
};

export type BakeCycle = Readonly<{
  id: string;
  ownerId: string;
  cycleNumber: number;
  name: string;
  status: BakeCycleStatus;
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string;
  notes: string | null;
  lockedAt: Date | null;
  activePlanningSnapshotId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;
