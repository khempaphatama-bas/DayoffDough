import type { DatabaseClient } from "@/lib/db/types";
import { z } from "zod";
import { buildPlanningPreview } from "@/modules/planning/domain/build-preview";
import type { PlanningPreview } from "@/modules/planning/domain/types";
import { loadPlanningSource } from "./load-source";

export type PlanningClock = Readonly<{ now(): Date }>;

const SYSTEM_CLOCK: PlanningClock = { now: () => new Date() };
const uuidSchema = z.string().uuid();

export function createPlanningQueryService(
  db: DatabaseClient,
  clock: PlanningClock = SYSTEM_CLOCK,
) {
  return {
    async preview(ownerId: string, cycleId: string): Promise<PlanningPreview> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (!parsedOwnerId.success || !parsedCycleId.success) {
        throw new Error("Cycle not found");
      }
      const asOf = clock.now();
      const source = await loadPlanningSource(
        db,
        parsedOwnerId.data,
        parsedCycleId.data,
        asOf,
      );
      return buildPlanningPreview(source);
    },
  };
}
