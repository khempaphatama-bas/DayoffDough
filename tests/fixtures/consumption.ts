import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { cycleTaskGenerations } from "@/modules/production/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { loadShoppingSource } from "@/modules/shopping/application/load-shopping-source";
import { createShoppingCommandService } from "@/modules/shopping/application/shopping-commands";
import { OWNER_ID } from "./owner";
import { seedLockedPlanningScenario } from "./planning";

export async function confirmConsumptionStock(db: DatabaseClient, ownerId: string, cycleId: string, planningSnapshotId?: string) {
  if (!planningSnapshotId) {
    const [cycle] = await db.select().from(bakeCycles).where(and(eq(bakeCycles.ownerId, ownerId), eq(bakeCycles.id, cycleId)));
    if (!cycle?.activePlanningSnapshotId) throw new Error("Fixture needs a current plan");
    planningSnapshotId = cycle.activePlanningSnapshotId;
  }
  const source = await loadShoppingSource(db, ownerId, planningSnapshotId);
  if (source.length) await createShoppingCommandService(db).confirmStock(ownerId, {
    cycleId, planningSnapshotId, confirmationRequestId: randomUUID(), countedAt: new Date(),
    counts: source.map((item) => ({ inventoryItemId: item.inventoryItemId, countedQuantity: item.requiredQuantity })),
  });
}

export async function seedConsumptionScenario(db: DatabaseClient, input: {
  ownerId?: string; idSet?: "PRIMARY" | "SECONDARY"; start?: boolean;
} = {}) {
  const ownerId = input.ownerId ?? OWNER_ID;
  const s = await seedLockedPlanningScenario(db, input);
  const [generation] = await db.select().from(cycleTaskGenerations).where(and(
    eq(cycleTaskGenerations.ownerId, ownerId), eq(cycleTaskGenerations.planningSnapshotId, s.planningSnapshotId),
  ));
  await confirmConsumptionStock(db, ownerId, s.cycleId, s.planningSnapshotId);
  if (input.start !== false) await createCycleOperationsCommandService(db).startCycle(ownerId, { cycleId: s.cycleId });
  return { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: generation!.id,
    itemIds: [s.ingredientItemId, s.packagingItemId] };
}
