import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { recipeIngredients } from "@/modules/products/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { cycleInventoryCounts } from "@/modules/shopping/db/schema";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";

describe("pending consumption registration", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  it("rejects a V1 start without stock check and rolls back status and context", async () => {
    const s = await seedLockedPlanningScenario(context.db);
    await expect(createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId }))
      .rejects.toMatchObject({ kind: "STOCK_CHECK_REQUIRED" });
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
    expect((await context.db.select().from(bakeCycles).where(eq(bakeCycles.id, s.cycleId)))[0]!.status).toBe("LOCKED");
  });

  it("starts with one complete immutable pending context and does not deduct stock", async () => {
    const s = await seedConsumptionScenario(context.db, { start: false });
    const before = await context.db.select().from(inventoryMovements);
    const commands = createCycleOperationsCommandService(context.db);
    await commands.startCycle(OWNER_ID, { cycleId: s.cycleId });
    await commands.startCycle(OWNER_ID, { cycleId: s.cycleId });
    const rows = await context.db.select().from(cycleConsumptionContexts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bakeCycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: s.taskGenerationId, currentRevisionId: null });
    expect((await context.db.select().from(cycleConsumptionItems).orderBy(cycleConsumptionItems.inventoryItemId)).map((item) => ({ id: item.inventoryItemId, quantity: item.plannedQuantity })))
      .toEqual([{ id: s.itemIds[0], quantity: "2200.000000" }, { id: s.itemIds[1], quantity: "14.000000" }]);
    expect(await context.db.select().from(inventoryMovements)).toEqual(before);
  });

  it("requires a new stock check after an unstarted plan is unlocked and regenerated", async () => {
    const s = await seedConsumptionScenario(context.db, { start: false });
    const planning = createPlanningCommandService(context.db);
    await planning.unlock(OWNER_ID, { cycleId: s.cycleId, reason: "New plan", confirmation: "ปลดล็อก" });
    const preview = await createPlanningQueryService(context.db).preview(OWNER_ID, s.cycleId);
    await planning.lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: "99999999-9999-4999-8999-999999999999", inputFingerprint: preview.inputFingerprint, overrides: [] });
    await expect(createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toMatchObject({ kind: "STOCK_CHECK_REQUIRED" });
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
  });

  it("rejects a partial current-generation stock check even though ordinary COUNT movements exist", async () => {
    const s = await seedConsumptionScenario(context.db, { start: false });
    await context.db.delete(cycleInventoryCounts).where(eq(cycleInventoryCounts.inventoryItemId, s.itemIds[0]!));
    await expect(createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toMatchObject({ kind: "STOCK_CHECK_REQUIRED" });
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
    expect(await context.db.select().from(inventoryMovements)).toHaveLength(2);
  });

  it("creates an empty context without a COUNT when the exact required set is empty", async () => {
    const s = await seedPlanningScenario(context.db);
    await context.db.delete(recipeIngredients);
    await context.db.delete(productPackagingRules);
    const preview = await createPlanningQueryService(context.db).preview(OWNER_ID, s.cycleId);
    await createPlanningCommandService(context.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: "99999999-9999-4999-8999-999999999998", inputFingerprint: preview.inputFingerprint, overrides: [] });
    await createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    expect(await context.db.select().from(cycleConsumptionContexts)).toHaveLength(1);
    expect(await context.db.select().from(cycleConsumptionItems)).toEqual([]);
    expect(await context.db.select().from(cycleInventoryCounts)).toEqual([]);
    expect(await context.db.select().from(inventoryMovements)).toEqual([]);
  });

  it("rolls back registered context and source items if the production status write fails", async () => {
    const s = await seedConsumptionScenario(context.db, { start: false });
    await context.db.execute(sql`CREATE FUNCTION fail_test_start() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test start failed'; END; $$ LANGUAGE plpgsql`);
    await context.db.execute(sql`CREATE TRIGGER test_start_failure BEFORE UPDATE OF status ON bake_cycles FOR EACH ROW WHEN (NEW.status = 'IN_PRODUCTION') EXECUTE FUNCTION fail_test_start()`);
    await expect(createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toThrow();
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
    expect(await context.db.select().from(cycleConsumptionItems)).toEqual([]);
    expect((await context.db.select().from(bakeCycles).where(eq(bakeCycles.id, s.cycleId)))[0]!.status).toBe("LOCKED");
  });
  it("maps registration lock contention to safe STALE_DATA without leaving a pending context", async () => {
    const s = await seedConsumptionScenario(context.db, { start: false });
    await context.db.execute(sql`CREATE FUNCTION test_start_contention() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'private SQL detail' USING ERRCODE = '55P03'; END; $$ LANGUAGE plpgsql`);
    await context.db.execute(sql`CREATE TRIGGER test_start_contention BEFORE INSERT ON cycle_consumption_contexts FOR EACH ROW EXECUTE FUNCTION test_start_contention()`);
    await expect(createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId }))
      .rejects.toMatchObject({ kind: "STALE_DATA", message: "Stock changed; refresh and try again" });
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
  });
});
