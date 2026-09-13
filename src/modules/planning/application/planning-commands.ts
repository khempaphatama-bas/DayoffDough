import { and, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedBakeCycle } from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { buildPlanningPreview } from "@/modules/planning/domain/build-preview";
import { createPlanningFingerprint } from "@/modules/planning/domain/fingerprint";
import {
  lockCycleInputSchema,
  type LockCycleInput,
  unlockCycleInputSchema,
  type UnlockCycleInput,
} from "@/modules/planning/domain/lock-form";
import type { PlanningIssue } from "@/modules/planning/domain/types";
import { loadPlanningSource } from "./load-source";
import type {
  PlanningClock,
  PlanningGenerationSummary,
} from "./planning-queries";
import { persistPlanningSnapshot } from "./snapshot-writer";
import {
  persistCycleTaskGeneration,
  type PersistCycleTaskGeneration,
} from "@/modules/production/application/task-generation-writer";

export type { LockCycleInput } from "@/modules/planning/domain/lock-form";

export class PlanningStaleError extends Error {
  constructor() {
    super("Planning preview is stale");
    this.name = "PlanningStaleError";
  }
}

export class PlanningBlockedError extends Error {
  constructor(readonly blockers: ReadonlyArray<PlanningIssue>) {
    super("Planning preview has blockers");
    this.name = "PlanningBlockedError";
  }
}

export class PlanningStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningStateError";
  }
}

export type PlanningCommandDependencies = Readonly<{
  persistCycleTaskGeneration?: PersistCycleTaskGeneration;
}>;

export function createPlanningCommandService(
  db: DatabaseClient,
  clock: PlanningClock = { now: () => new Date() },
  dependencies: PlanningCommandDependencies = {},
) {
  const writeCycleTaskGeneration =
    dependencies.persistCycleTaskGeneration ?? persistCycleTaskGeneration;
  return {
    async unlock(
      ownerId: string,
      input: UnlockCycleInput,
    ): Promise<PlanningGenerationSummary> {
      const parsedOwnerId = z.string().uuid().safeParse(ownerId);
      const parsedInput = unlockCycleInputSchema.safeParse(input);
      if (!parsedOwnerId.success || !parsedInput.success) {
        throw new PlanningStateError("Invalid planning unlock input");
      }
      const verifiedOwnerId = parsedOwnerId.data;
      const verifiedInput = parsedInput.data;

      return db.transaction(async (tx) => {
        const cycle = await lockOwnedBakeCycle(
          tx,
          verifiedOwnerId,
          verifiedInput.cycleId,
        );
        if (!cycle) throw new Error("Cycle not found");
        if (
          (cycle.status !== "LOCKED" &&
            cycle.status !== "IN_PRODUCTION") ||
          cycle.activePlanningSnapshotId === null
        ) {
          throw new PlanningStateError("Cycle cannot be unlocked");
        }

        const [activeSnapshot] = await tx
          .select()
          .from(cyclePlanningSnapshots)
          .where(
            and(
              eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
              eq(cyclePlanningSnapshots.bakeCycleId, cycle.id),
              eq(
                cyclePlanningSnapshots.id,
                cycle.activePlanningSnapshotId,
              ),
            ),
          )
          .limit(1)
          .for("update");
        if (!activeSnapshot || activeSnapshot.status !== "ACTIVE") {
          throw new PlanningStateError("Cycle cannot be unlocked");
        }

        const unlockedAt = clock.now();
        const [superseded] = await tx
          .update(cyclePlanningSnapshots)
          .set({
            status: "SUPERSEDED",
            unlockedAt,
            unlockReason: verifiedInput.reason,
            unlockedFromStatus: cycle.status,
          })
          .where(
            and(
              eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
              eq(cyclePlanningSnapshots.bakeCycleId, cycle.id),
              eq(cyclePlanningSnapshots.id, activeSnapshot.id),
              eq(cyclePlanningSnapshots.status, "ACTIVE"),
            ),
          )
          .returning();
        if (!superseded) {
          throw new PlanningStateError("Cycle changed while unlocking");
        }

        const [opened] = await tx
          .update(bakeCycles)
          .set({
            status: "OPEN",
            activePlanningSnapshotId: null,
            lockedAt: null,
            updatedAt: unlockedAt,
          })
          .where(
            and(
              eq(bakeCycles.ownerId, verifiedOwnerId),
              eq(bakeCycles.id, cycle.id),
              eq(bakeCycles.status, cycle.status),
              eq(
                bakeCycles.activePlanningSnapshotId,
                activeSnapshot.id,
              ),
            ),
          )
          .returning({ id: bakeCycles.id });
        if (!opened) {
          throw new PlanningStateError("Cycle changed while unlocking");
        }
        return toGenerationSummary(superseded);
      });
    },

    async lock(
      ownerId: string,
      input: LockCycleInput,
    ): Promise<PlanningGenerationSummary> {
      const parsedOwnerId = z.string().uuid().safeParse(ownerId);
      const parsedInput = lockCycleInputSchema.safeParse(input);
      if (!parsedOwnerId.success || !parsedInput.success) {
        throw new PlanningStateError("Invalid planning lock input");
      }
      const verifiedOwnerId = parsedOwnerId.data;
      const verifiedInput = parsedInput.data;

      return db.transaction(
        async (tx) => {
          const cycle = await lockOwnedBakeCycle(
            tx,
            verifiedOwnerId,
            verifiedInput.cycleId,
          );
          if (!cycle) throw new Error("Cycle not found");

          const [existing] = await tx
            .select()
            .from(cyclePlanningSnapshots)
            .where(
              and(
                eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
                eq(
                  cyclePlanningSnapshots.lockRequestId,
                  verifiedInput.lockRequestId,
                ),
              ),
            )
            .limit(1);
          if (existing) {
            if (existing.bakeCycleId !== verifiedInput.cycleId) {
              throw new PlanningStateError(
                "Lock request belongs to another cycle",
              );
            }
            return toGenerationSummary(existing);
          }

          if (
            cycle.status !== "OPEN" ||
            cycle.activePlanningSnapshotId !== null
          ) {
            throw new PlanningStateError("Cycle is not open for locking");
          }

          const lockedAt = clock.now();
          const source = await loadPlanningSource(
            tx,
            verifiedOwnerId,
            verifiedInput.cycleId,
            lockedAt,
          );
          const authoritativeFingerprint = createPlanningFingerprint(source);
          if (authoritativeFingerprint !== verifiedInput.inputFingerprint) {
            throw new PlanningStaleError();
          }

          const authoritative = buildPlanningPreview(
            source,
            verifiedInput.overrides,
          );
          if (authoritative.blockers.length > 0) {
            throw new PlanningBlockedError(authoritative.blockers);
          }

          const [generationRow] = await tx
            .select({ value: max(cyclePlanningSnapshots.generation) })
            .from(cyclePlanningSnapshots)
            .where(
              and(
                eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
                eq(
                  cyclePlanningSnapshots.bakeCycleId,
                  verifiedInput.cycleId,
                ),
              ),
            );
          const generation = (generationRow?.value ?? 0) + 1;

          const planningSnapshot = await persistPlanningSnapshot(
            tx,
            verifiedOwnerId,
            cycle,
            { ...authoritative, settings: source.settings },
            verifiedInput,
            generation,
            lockedAt,
          );
          await writeCycleTaskGeneration(tx, verifiedOwnerId, {
            cycleId: cycle.id,
            planningSnapshotId: planningSnapshot.id,
            generation,
            primaryDeliveryDate: authoritative.cycle.primaryDeliveryDate!,
            timezone: source.settings.timezone,
            templates: source.productionTemplates,
            productPlans: authoritative.productPlans.map((product) => ({
              productId: product.productId,
              productName: product.productName,
              selectedBatchCount: product.selectedBatchCount,
            })),
          });
          const [updated] = await tx
            .update(bakeCycles)
            .set({
              status: "LOCKED",
              lockedAt,
              activePlanningSnapshotId: planningSnapshot.id,
              updatedAt: lockedAt,
            })
            .where(
              and(
                eq(bakeCycles.ownerId, verifiedOwnerId),
                eq(bakeCycles.id, cycle.id),
                eq(bakeCycles.status, "OPEN"),
                isNull(bakeCycles.activePlanningSnapshotId),
              ),
            )
            .returning({ id: bakeCycles.id });
          if (!updated) {
            throw new PlanningStateError("Cycle changed while locking");
          }
          return planningSnapshot;
        },
        { isolationLevel: "repeatable read" },
      );
    },
  };
}

function toGenerationSummary(
  row: typeof cyclePlanningSnapshots.$inferSelect,
): PlanningGenerationSummary {
  return {
    id: row.id,
    cycleId: row.bakeCycleId,
    generation: row.generation,
    status: row.status,
    costComplete: row.costComplete,
    lockedAt: row.lockedAt,
    unlockedAt: row.unlockedAt,
    unlockReason: row.unlockReason,
    unlockedFromStatus:
      row.unlockedFromStatus === "LOCKED" ||
      row.unlockedFromStatus === "IN_PRODUCTION"
        ? row.unlockedFromStatus
        : null,
  };
}
