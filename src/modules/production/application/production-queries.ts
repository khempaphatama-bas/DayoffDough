import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import {
  cycleTaskGenerations,
  cycleTasks,
} from "@/modules/production/db/schema";
import type {
  CycleProductionHeader,
  CycleProductionView,
  CycleTaskGenerationView,
  CycleTaskView,
  ProductOption,
  ProductionGenerationSummary,
} from "@/modules/production/domain/types";

const uuidSchema = z.string().uuid();

function generationNotFound(): never {
  throw new Error("Production generation not found");
}

function toHeader(
  cycle: typeof bakeCycles.$inferSelect,
  snapshot: typeof cyclePlanningSnapshots.$inferSelect | null,
): CycleProductionHeader {
  return {
    cycleId: cycle.id,
    cycleNumber: snapshot?.cycleNumber ?? cycle.cycleNumber,
    cycleName: snapshot?.cycleName ?? cycle.name,
    cycleStatus: cycle.status,
  };
}

function toGenerationSummary(
  snapshot: typeof cyclePlanningSnapshots.$inferSelect,
  hasTimeline: boolean,
): ProductionGenerationSummary {
  return {
    planningSnapshotId: snapshot.id,
    generation: snapshot.generation,
    planningStatus: snapshot.status,
    hasTimeline,
    lockedAt: snapshot.lockedAt,
    unlockedAt: snapshot.unlockedAt,
    unlockReason: snapshot.unlockReason,
  };
}

function toGenerationView(
  row: typeof cycleTaskGenerations.$inferSelect,
  planningStatus: "ACTIVE" | "SUPERSEDED",
): CycleTaskGenerationView {
  return {
    id: row.id,
    cycleId: row.bakeCycleId,
    planningSnapshotId: row.planningSnapshotId,
    generation: row.generation,
    primaryDeliveryDate: row.primaryDeliveryDate,
    timezone: row.timezone,
    createdAt: row.createdAt,
    planningStatus,
  };
}

function toTaskView(row: typeof cycleTasks.$inferSelect): CycleTaskView {
  return {
    id: row.id,
    taskGenerationId: row.cycleTaskGenerationId,
    origin: row.origin,
    sourceTemplateName: row.sourceTemplateName,
    sourceActivityName: row.sourceActivityName,
    title: row.title,
    productId: row.productId,
    productName: row.productName,
    batchCount: row.batchCount?.toString() ?? null,
    scheduledAt: row.scheduledAt,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    notes: row.notes,
    sequence: row.sequence,
    status: row.status,
    skipReason: row.skipReason,
  };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareTasks(left: CycleTaskView, right: CycleTaskView): number {
  const scheduled = left.scheduledAt.getTime() - right.scheduledAt.getTime();
  if (scheduled !== 0) return scheduled;
  const sequence = left.sequence - right.sequence;
  if (sequence !== 0) return sequence;
  const product = compareText(left.productName ?? "", right.productName ?? "");
  if (product !== 0) return product;
  return compareText(left.id, right.id);
}

function isCurrent(
  cycle: typeof bakeCycles.$inferSelect,
  snapshot: typeof cyclePlanningSnapshots.$inferSelect,
): boolean {
  return (
    snapshot.status === "ACTIVE" &&
    cycle.activePlanningSnapshotId === snapshot.id &&
    (cycle.status === "LOCKED" || cycle.status === "IN_PRODUCTION")
  );
}

export function createProductionQueryService(db: DatabaseClient) {
  return {
    async getCycleProduction(
      ownerId: string,
      cycleId: string,
      generation?: number,
    ): Promise<CycleProductionView> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (
        !parsedOwnerId.success ||
        !parsedCycleId.success ||
        (generation !== undefined &&
          (!Number.isSafeInteger(generation) || generation <= 0))
      ) {
        generationNotFound();
      }
      const verifiedOwnerId = parsedOwnerId.data;
      const verifiedCycleId = parsedCycleId.data;
      const [cycle] = await db
        .select()
        .from(bakeCycles)
        .where(
          and(
            eq(bakeCycles.ownerId, verifiedOwnerId),
            eq(bakeCycles.id, verifiedCycleId),
          ),
        )
        .limit(1);
      if (!cycle) generationNotFound();

      const snapshotRows = await db
        .select()
        .from(cyclePlanningSnapshots)
        .where(
          and(
            eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
            eq(cyclePlanningSnapshots.bakeCycleId, verifiedCycleId),
          ),
        )
        .orderBy(desc(cyclePlanningSnapshots.generation));
      const taskGenerationRows = await db
        .select()
        .from(cycleTaskGenerations)
        .where(
          and(
            eq(cycleTaskGenerations.ownerId, verifiedOwnerId),
            eq(cycleTaskGenerations.bakeCycleId, verifiedCycleId),
          ),
        );
      const taskGenerationBySnapshot = new Map(
        taskGenerationRows.map((row) => [row.planningSnapshotId, row]),
      );
      const generations = snapshotRows.map((snapshot) =>
        toGenerationSummary(snapshot, taskGenerationBySnapshot.has(snapshot.id)),
      );

      let snapshot: typeof cyclePlanningSnapshots.$inferSelect | undefined;
      if (generation === undefined) {
        if (!cycle.activePlanningSnapshotId) {
          return {
            kind: "NO_GENERATION",
            cycle: toHeader(cycle, null),
            selectedPlanningGeneration: null,
            generations,
            reason: "NO_PLAN",
            writable: false,
          };
        }
        snapshot = snapshotRows.find(
          (row) => row.id === cycle.activePlanningSnapshotId,
        );
      } else {
        snapshot = snapshotRows.find((row) => row.generation === generation);
      }
      if (!snapshot) generationNotFound();

      const taskGeneration = taskGenerationBySnapshot.get(snapshot.id);
      if (!taskGeneration) {
        return {
          kind: "NO_GENERATION",
          cycle: toHeader(cycle, snapshot),
          selectedPlanningGeneration: snapshot.generation,
          generations,
          reason: "LEGACY_SNAPSHOT",
          writable: false,
        };
      }

      const rows = await db
        .select()
        .from(cycleTasks)
        .where(
          and(
            eq(cycleTasks.ownerId, verifiedOwnerId),
            eq(cycleTasks.cycleTaskGenerationId, taskGeneration.id),
            isNull(cycleTasks.deletedAt),
          ),
        );
      const tasks = rows.map(toTaskView).sort(compareTasks);
      const activeProductRows = await db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(eq(products.ownerId, verifiedOwnerId), eq(products.active, true)))
        .orderBy(asc(products.name), asc(products.id));
      const productOptions: ProductOption[] = activeProductRows;
      const planningStatus = snapshot.status;
      const generationView = toGenerationView(taskGeneration, planningStatus);
      if (isCurrent(cycle, snapshot)) {
        return {
          kind: "CURRENT",
          cycle: toHeader(cycle, snapshot),
          generation: generationView,
          generations,
          tasks,
          products: productOptions,
          writable: true,
        };
      }
      return {
        kind: "HISTORY",
        cycle: toHeader(cycle, snapshot),
        generation: generationView,
        generations,
        tasks,
        products: productOptions,
        writable: false,
      };
    },
  };
}
