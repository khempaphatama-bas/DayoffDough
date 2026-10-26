import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { inventoryItems } from "@/modules/inventory/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { loadSnapshotStockRequirements } from "@/modules/shopping/application/load-shopping-source";
import { ConsumptionStateError, type ConsumptionRequirement } from "../domain/types";

export async function loadConsumptionSource(
  reader: Pick<DatabaseClient, "select">, ownerId: string, planningSnapshotId: string,
): Promise<readonly ConsumptionRequirement[]> {
  const [snapshot] = await reader.select({ id: cyclePlanningSnapshots.id }).from(cyclePlanningSnapshots)
    .where(and(eq(cyclePlanningSnapshots.ownerId, ownerId), eq(cyclePlanningSnapshots.id, planningSnapshotId))).limit(1);
  if (!snapshot) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  const source = await loadSnapshotStockRequirements(reader, ownerId, planningSnapshotId);
  if (!source.length) return [];
  const items = await reader.select({ id: inventoryItems.id }).from(inventoryItems).where(and(
    eq(inventoryItems.ownerId, ownerId), inArray(inventoryItems.id, source.map((item) => item.inventoryItemId)),
  ));
  if (items.length !== source.length) throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
  return source.map(({ requiredQuantity, inventoryItemId, inventoryItemName, inventoryCategory, baseUnit, priceSnapshotId }) => ({
    inventoryItemId, inventoryItemName, inventoryCategory, baseUnit, priceSnapshotId, plannedQuantity: requiredQuantity,
  })).sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId));
}
