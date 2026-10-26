import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { cycleConsumptionContexts } from "../db/schema";
import { findPendingConsumption } from "./count-barrier";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { cycleMaterialRequirements } from "@/modules/planning/db/schema";

describe("ordinary COUNT barrier", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());
  it.each([false, true])("blocks a pending-use item without writing COUNT (cancelled=%s)", async (cancelled) => {
    const s = await seedConsumptionScenario(context.db);
    if (cancelled) await context.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
    const before = await context.db.select().from(inventoryMovements);
    await expect(createInventoryService(context.db).recordCount(OWNER_ID, s.itemIds[0]!, "25", new Date()))
      .rejects.toMatchObject({ kind: "PENDING_USE" });
    expect(await context.db.select().from(inventoryMovements)).toEqual(before);
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([expect.objectContaining({ currentRevisionId: null })]);
  });
  it("rejects direct SQL COUNT while an item has pending use", async () => {
    const s = await seedConsumptionScenario(context.db);
    await expect(context.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "COUNT", quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: "2200", occurredAt: new Date() })).rejects.toThrow();
  });
  it("uses the immutable copied item membership even if a source requirement is later removed", async () => {
    const s = await seedConsumptionScenario(context.db);
    await context.db.delete(cycleMaterialRequirements).where(eq(cycleMaterialRequirements.planningSnapshotId, s.planningSnapshotId));
    await expect(context.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "COUNT", quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: "2200", occurredAt: new Date() })).rejects.toThrow();
  });
  it("deduplicates owned blockers, hides foreign blockers and allows unrelated item counts", async () => {
    const s = await seedConsumptionScenario(context.db);
    expect(await findPendingConsumption(context.db, OWNER_ID, s.itemIds)).toEqual([expect.objectContaining({ cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId })]);
    expect(await findPendingConsumption(context.db, "00000000-0000-4000-8000-000000000002", s.itemIds)).toEqual([]);
    expect(await findPendingConsumption(context.db, OWNER_ID, [])).toEqual([]);
    const inventory = createInventoryService(context.db);
    const other = await inventory.createItem(OWNER_ID, { name: "Unrelated", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "100", minimumStockQuantity: "0" });
    await expect(inventory.recordCount(OWNER_ID, other.id, "25", new Date())).resolves.toMatchObject({ type: "COUNT", countedQuantityInBaseUnit: "25.000000" });
  });
  it("keeps true pre-cutover LEGACY starts and ordinary counts usable without creating contexts", async () => {
    await context.close();
    context = await createTestDatabase({ beforeConsumptionCutover: async (db) => {
      await db.execute(sql`INSERT INTO bake_cycles (id, owner_id, name, status, target_production_date, primary_delivery_date)
        VALUES ('10000000-0000-4000-8000-000000000009', ${OWNER_ID}, 'Legacy cycle', 'OPEN', '2026-08-29', '2026-08-30')`);
    } });
    const s = await seedLockedPlanningScenario(context.db, { reusePreCutoverCycle: true });
    await createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
    await expect(createInventoryService(context.db).recordCount(OWNER_ID, s.ingredientItemId, "25", new Date())).resolves.toMatchObject({ type: "COUNT" });
  });
});
