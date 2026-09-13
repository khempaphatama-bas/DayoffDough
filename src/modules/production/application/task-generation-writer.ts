import type { DatabaseClient } from "@/lib/db/types";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import {
  buildCycleTaskDrafts,
} from "@/modules/production/domain/task-generation";
import type {
  CycleTaskGenerationSummary,
  ProductionTemplateSource,
  TaskGenerationProduct,
} from "@/modules/production/domain/types";

export type PersistCycleTaskGenerationInput = Readonly<{
  cycleId: string;
  planningSnapshotId: string;
  generation: number;
  primaryDeliveryDate: string;
  timezone: string;
  templates: ReadonlyArray<ProductionTemplateSource>;
  productPlans: ReadonlyArray<TaskGenerationProduct>;
}>;

export type PersistCycleTaskGeneration = (
  tx: Pick<DatabaseClient, "insert">,
  ownerId: string,
  input: PersistCycleTaskGenerationInput,
) => Promise<CycleTaskGenerationSummary>;

export const persistCycleTaskGeneration: PersistCycleTaskGeneration = async (
  tx,
  ownerId,
  input,
) => {
  const drafts = buildCycleTaskDrafts({
    primaryDeliveryDate: input.primaryDeliveryDate,
    timezone: input.timezone,
    templates: input.templates,
    products: input.productPlans,
  });
  if (
    drafts.length === 0 &&
    (input.productPlans.length > 0 ||
      input.templates.some((template) => template.scope === "CYCLE"))
  ) {
    throw new Error("Task generation has no tasks");
  }

  const [generation] = await tx
    .insert(cycleTaskGenerations)
    .values({
      ownerId,
      bakeCycleId: input.cycleId,
      planningSnapshotId: input.planningSnapshotId,
      generation: input.generation,
      primaryDeliveryDate: input.primaryDeliveryDate,
      timezone: input.timezone,
    })
    .returning();
  if (!generation) {
    throw new Error("Task generation insert returned no row");
  }

  if (drafts.length > 0) {
    await tx.insert(cycleTasks).values(
      drafts.map((draft) => ({
        ownerId,
        cycleTaskGenerationId: generation.id,
        origin: draft.origin,
        sourceTemplateId: draft.sourceTemplateId,
        sourceActivityId: draft.sourceActivityId,
        sourceTemplateScope: draft.sourceTemplateScope,
        sourceProductId: draft.sourceProductId,
        sourceTemplateName: draft.sourceTemplateName,
        sourceActivityName: draft.sourceActivityName,
        sourceProductName: draft.sourceProductName,
        creationRequestId: null,
        title: draft.title,
        productId: draft.productId,
        productName: draft.productName,
        batchCount: draft.batchCount,
        scheduledAt: draft.scheduledAt,
        estimatedDurationMinutes: draft.estimatedDurationMinutes,
        notes: draft.notes,
        sequence: draft.sequence,
        status: draft.status,
        skipReason: draft.skipReason,
      })),
    );
  }

  return {
    id: generation.id,
    cycleId: generation.bakeCycleId,
    planningSnapshotId: generation.planningSnapshotId,
    generation: generation.generation,
    primaryDeliveryDate: generation.primaryDeliveryDate,
    timezone: generation.timezone,
    createdAt: generation.createdAt,
  };
};
