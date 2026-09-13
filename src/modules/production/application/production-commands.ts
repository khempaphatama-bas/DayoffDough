import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedBakeCycle, lockOwnedCycleTask } from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import {
  cycleTaskGenerations,
  cycleTasks,
} from "@/modules/production/db/schema";
import {
  createManualTaskInputSchema,
  deleteManualTaskInputSchema,
  updateCycleTaskInputSchema,
  type CreateManualTaskInput,
  type DeleteManualTaskInput,
  type UpdateCycleTaskInput,
} from "@/modules/production/domain/forms";

export type ProductionClock = Readonly<{ now(): Date }>;

export class ProductionStateError extends Error {
  constructor(
    message: string,
    readonly kind: "STALE_GENERATION" | "TASK_NOT_FOUND" | "TASK_NOT_DELETABLE" | "STATE" = "STATE",
  ) {
    super(message);
    this.name = "ProductionStateError";
  }
}

export class ProductionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionValidationError";
  }
}

const uuidSchema = z.string().uuid();
const systemClock: ProductionClock = { now: () => new Date() };

type CommandExecutor = Pick<DatabaseClient, "select" | "insert" | "update">;

function parseOwner(ownerId: string): string {
  const parsed = uuidSchema.safeParse(ownerId);
  if (!parsed.success) throw new ProductionValidationError("Invalid owner");
  return parsed.data;
}

function parseDate(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function parseInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, input: unknown, message: string): T {
  const parsed = schema.safeParse(input && typeof input === "object"
    ? { ...(input as Record<string, unknown>), scheduledAt: parseDate((input as Record<string, unknown>).scheduledAt) }
    : input);
  if (!parsed.success) throw new ProductionValidationError(message);
  return parsed.data;
}

function stateNotFound(): never {
  throw new ProductionStateError("Production task not found", "TASK_NOT_FOUND");
}

async function lockCurrentGeneration(
  tx: CommandExecutor,
  ownerId: string,
  cycleId: string,
  taskGenerationId: string,
) {
  const cycle = await lockOwnedBakeCycle(tx, ownerId, cycleId);
  if (!cycle) stateNotFound();
  if (cycle.status !== "LOCKED" && cycle.status !== "IN_PRODUCTION") {
    if (cycle.status === "COMPLETED" || cycle.status === "CANCELLED") {
      throw new ProductionStateError("Cycle cannot be edited", "STATE");
    }
    throw new ProductionStateError("Task generation is stale", "STALE_GENERATION");
  }

  const [generation] = await tx
    .select()
    .from(cycleTaskGenerations)
    .where(
      and(
        eq(cycleTaskGenerations.ownerId, ownerId),
        eq(cycleTaskGenerations.id, taskGenerationId),
        eq(cycleTaskGenerations.bakeCycleId, cycle.id),
      ),
    )
    .limit(1)
    .for("update");
  if (!generation) stateNotFound();

  const [snapshot] = await tx
    .select()
    .from(cyclePlanningSnapshots)
    .where(
      and(
        eq(cyclePlanningSnapshots.ownerId, ownerId),
        eq(cyclePlanningSnapshots.id, generation.planningSnapshotId),
        eq(cyclePlanningSnapshots.bakeCycleId, cycle.id),
      ),
    )
    .limit(1)
    .for("update");
  if (
    !snapshot ||
    snapshot.status !== "ACTIVE" ||
    cycle.activePlanningSnapshotId !== snapshot.id
  ) {
    throw new ProductionStateError("Task generation is stale", "STALE_GENERATION");
  }
  return { cycle, generation, snapshot };
}

async function resolveProductName(
  tx: CommandExecutor,
  ownerId: string,
  productId: string | null,
): Promise<string | null> {
  if (productId === null) return null;
  const [product] = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.ownerId, ownerId),
        eq(products.id, productId),
        eq(products.active, true),
      ),
    )
    .limit(1)
    .for("update");
  if (!product) throw new ProductionValidationError("Product must be active and owned");
  return product.name;
}

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function canonicalNumeric(value: string | null): string | null {
  return value === null ? null : new Decimal(value).toString();
}

function sameManualPayload(
  existing: typeof cycleTasks.$inferSelect,
  input: CreateManualTaskInput,
): boolean {
  return existing.origin === "MANUAL" &&
    existing.cycleTaskGenerationId === input.taskGenerationId &&
    existing.title === input.title &&
    existing.productId === input.productId &&
    canonicalNumeric(existing.batchCount?.toString() ?? null) === canonicalNumeric(input.batchCount) &&
    sameInstant(existing.scheduledAt, input.scheduledAt) &&
    existing.estimatedDurationMinutes === input.estimatedDurationMinutes &&
    existing.notes === input.notes &&
    existing.sequence === input.sequence &&
    existing.status === input.status &&
    existing.skipReason === input.skipReason;
}

function changedRequest(): never {
  throw new ProductionStateError("Creation request payload does not match", "STATE");
}

type ParsedUpdate = UpdateCycleTaskInput;
type ParsedCreate = CreateManualTaskInput;
type ParsedDelete = DeleteManualTaskInput;

export function createProductionCommandService(
  db: DatabaseClient,
  clock: ProductionClock = systemClock,
) {
  return {
    async updateTask(ownerId: string, input: UpdateCycleTaskInput) {
      const verifiedOwnerId = parseOwner(ownerId);
      const verifiedInput = parseInput<ParsedUpdate>(updateCycleTaskInputSchema, input, "Invalid production task update");
      return db.transaction(async (tx) => {
        const { generation } = await lockCurrentGeneration(
          tx,
          verifiedOwnerId,
          verifiedInput.cycleId,
          verifiedInput.taskGenerationId,
        );
        const task = await lockOwnedCycleTask(tx, verifiedOwnerId, generation.id, verifiedInput.taskId);
        if (!task || task.deletedAt !== null) stateNotFound();
        const productName = await resolveProductName(tx, verifiedOwnerId, verifiedInput.productId);
        const [updated] = await tx
          .update(cycleTasks)
          .set({
            title: verifiedInput.title,
            productId: verifiedInput.productId,
            productName,
            batchCount: verifiedInput.batchCount,
            scheduledAt: verifiedInput.scheduledAt,
            estimatedDurationMinutes: verifiedInput.estimatedDurationMinutes,
            notes: verifiedInput.notes,
            sequence: verifiedInput.sequence,
            status: verifiedInput.status,
            skipReason: verifiedInput.skipReason,
            updatedAt: clock.now(),
          })
          .where(
            and(
              eq(cycleTasks.ownerId, verifiedOwnerId),
              eq(cycleTasks.id, task.id),
              eq(cycleTasks.cycleTaskGenerationId, generation.id),
            ),
          )
          .returning();
        if (!updated) stateNotFound();
        return updated;
      });
    },

    async createManualTask(ownerId: string, input: CreateManualTaskInput) {
      const verifiedOwnerId = parseOwner(ownerId);
      const verifiedInput = parseInput<ParsedCreate>(createManualTaskInputSchema, input, "Invalid manual production task");
      try {
        return await db.transaction(async (tx) => {
          const { generation } = await lockCurrentGeneration(
            tx,
            verifiedOwnerId,
            verifiedInput.cycleId,
            verifiedInput.taskGenerationId,
          );
          const [existing] = await tx
            .select()
            .from(cycleTasks)
            .where(
              and(
                eq(cycleTasks.ownerId, verifiedOwnerId),
                eq(cycleTasks.creationRequestId, verifiedInput.creationRequestId),
              ),
            )
            .limit(1)
            .for("update");
          if (existing) {
            if (!sameManualPayload(existing, verifiedInput)) changedRequest();
            return existing;
          }
          const productName = await resolveProductName(tx, verifiedOwnerId, verifiedInput.productId);
          const [created] = await tx
            .insert(cycleTasks)
            .values({
              ownerId: verifiedOwnerId,
              cycleTaskGenerationId: generation.id,
              origin: "MANUAL",
              sourceTemplateId: null,
              sourceActivityId: null,
              sourceTemplateScope: null,
              sourceProductId: null,
              sourceTemplateName: null,
              sourceActivityName: null,
              sourceProductName: null,
              creationRequestId: verifiedInput.creationRequestId,
              title: verifiedInput.title,
              productId: verifiedInput.productId,
              productName,
              batchCount: verifiedInput.batchCount,
              scheduledAt: verifiedInput.scheduledAt,
              estimatedDurationMinutes: verifiedInput.estimatedDurationMinutes,
              notes: verifiedInput.notes,
              sequence: verifiedInput.sequence,
              status: verifiedInput.status,
              skipReason: verifiedInput.skipReason,
            })
            .returning();
          if (!created) throw new ProductionStateError("Manual task was not created");
          return created;
        });
      } catch (error) {
        if (error instanceof ProductionStateError) throw error;
        const [existing] = await db
          .select()
          .from(cycleTasks)
          .where(
            and(
              eq(cycleTasks.ownerId, verifiedOwnerId),
              eq(cycleTasks.creationRequestId, verifiedInput.creationRequestId),
            ),
          )
          .limit(1);
        if (existing) {
          if (!sameManualPayload(existing, verifiedInput)) changedRequest();
          return existing;
        }
        throw error;
      }
    },

    async softDeleteManualTask(ownerId: string, input: DeleteManualTaskInput) {
      const verifiedOwnerId = parseOwner(ownerId);
      const verifiedInput = parseInput<ParsedDelete>(deleteManualTaskInputSchema, input, "Invalid production task delete");
      return db.transaction(async (tx) => {
        const { generation } = await lockCurrentGeneration(
          tx,
          verifiedOwnerId,
          verifiedInput.cycleId,
          verifiedInput.taskGenerationId,
        );
        const task = await lockOwnedCycleTask(tx, verifiedOwnerId, generation.id, verifiedInput.taskId);
        if (!task) stateNotFound();
        if (task.origin !== "MANUAL" || task.status !== "PENDING" || task.deletedAt !== null) {
          throw new ProductionStateError("Task cannot be deleted", "TASK_NOT_DELETABLE");
        }
        const deletedAt = clock.now();
        const [deleted] = await tx
          .update(cycleTasks)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(
            and(
              eq(cycleTasks.ownerId, verifiedOwnerId),
              eq(cycleTasks.id, task.id),
              eq(cycleTasks.cycleTaskGenerationId, generation.id),
            ),
          )
          .returning();
        if (!deleted) stateNotFound();
        return deleted;
      });
    },
  };
}
