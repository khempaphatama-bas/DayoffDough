export const productionTemplateScopes = ["CYCLE", "PRODUCT"] as const;
export const cycleTaskOrigins = ["TEMPLATE", "MANUAL"] as const;
export const cycleTaskStatuses = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "SKIPPED",
] as const;

export type ProductionTemplateScope =
  (typeof productionTemplateScopes)[number];
export type CycleTaskOrigin = (typeof cycleTaskOrigins)[number];
export type CycleTaskStatus = (typeof cycleTaskStatuses)[number];

export type ProductionTemplateSource = Readonly<{
  id: string;
  name: string;
  scope: "CYCLE" | "PRODUCT";
  productId: string | null;
  active: true;
  activities: ReadonlyArray<
    Readonly<{
      id: string;
      name: string;
      offsetDaysFromDelivery: number;
      defaultTime: string;
      estimatedDurationMinutes: number;
      sequence: number;
      notes: string | null;
    }>
  >;
}>;

export type TaskGenerationProduct = Readonly<{
  productId: string;
  productName: string;
  selectedBatchCount: string;
}>;

export type ProductionTemplateActivityInput = Readonly<{
  id: string | null;
  name: string;
  offsetDaysFromDelivery: number;
  defaultTime: string;
  estimatedDurationMinutes: number;
  sequence: number;
  notes: string | null;
  active: boolean;
}>;

export type ProductionTemplateInput = Readonly<{
  name: string;
  scope: "CYCLE" | "PRODUCT";
  productId: string | null;
  activities: ReadonlyArray<ProductionTemplateActivityInput>;
}>;

export type CycleTaskDraft = Readonly<{
  origin: "TEMPLATE";
  sourceTemplateId: string;
  sourceActivityId: string;
  sourceTemplateScope: "CYCLE" | "PRODUCT";
  sourceProductId: string | null;
  sourceTemplateName: string;
  sourceActivityName: string;
  sourceProductName: string | null;
  title: string;
  productId: string | null;
  productName: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: "PENDING";
  skipReason: null;
}>;

export type CycleTaskGenerationSummary = Readonly<{
  id: string;
  cycleId: string;
  planningSnapshotId: string;
  generation: number;
  primaryDeliveryDate: string;
  timezone: string;
  createdAt: Date;
}>;

export type CycleProductionHeader = Readonly<{
  cycleId: string;
  cycleNumber: number;
  cycleName: string;
  cycleStatus:
    | "DRAFT"
    | "OPEN"
    | "LOCKED"
    | "IN_PRODUCTION"
    | "COMPLETED"
    | "CANCELLED";
}>;

export type ProductionGenerationSummary = Readonly<{
  planningSnapshotId: string;
  generation: number;
  planningStatus: "ACTIVE" | "SUPERSEDED";
  hasTimeline: boolean;
  lockedAt: Date;
  unlockedAt: Date | null;
  unlockReason: string | null;
}>;

export type CycleTaskGenerationView = CycleTaskGenerationSummary &
  Readonly<{
    planningStatus: "ACTIVE" | "SUPERSEDED";
  }>;

export type ProductOption = Readonly<{ id: string; name: string }>;

export type CycleTaskView = Readonly<{
  id: string;
  taskGenerationId: string;
  origin: "TEMPLATE" | "MANUAL";
  sourceTemplateName: string | null;
  sourceActivityName: string | null;
  title: string;
  productId: string | null;
  productName: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: CycleTaskStatus;
  skipReason: string | null;
}>;

export type CycleProductionView =
  | Readonly<{
      kind: "CURRENT";
      cycle: CycleProductionHeader;
      generation: CycleTaskGenerationView;
      generations: readonly ProductionGenerationSummary[];
      tasks: readonly CycleTaskView[];
      products: readonly ProductOption[];
      writable: true;
    }>
  | Readonly<{
      kind: "HISTORY";
      cycle: CycleProductionHeader;
      generation: CycleTaskGenerationView;
      generations: readonly ProductionGenerationSummary[];
      tasks: readonly CycleTaskView[];
      products: readonly ProductOption[];
      writable: false;
    }>
  | Readonly<{
      kind: "NO_GENERATION";
      cycle: CycleProductionHeader;
      selectedPlanningGeneration: number | null;
      generations: readonly ProductionGenerationSummary[];
      reason: "NO_PLAN" | "LEGACY_SNAPSHOT";
      writable: false;
    }>;
