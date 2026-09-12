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
