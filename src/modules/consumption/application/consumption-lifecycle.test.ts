import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmConsumptionStock, prepareConsumptionFixture, seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { recipeIngredients } from "@/modules/products/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { cycleInventoryCounts } from "@/modules/shopping/db/schema";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { createCycleService } from "@/modules/cycles/application/cycles";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { consumptionRevisionItems, cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { orders } from "@/modules/orders/db/schema";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { createConsumptionCommandService } from "./consumption-commands";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { assertConsumptionCompleteAllowed, assertConsumptionUnlockAllowed } from "./consumption-lifecycle";
import { createOperationsQueryService } from "@/modules/operations/application/operations-queries";

describe("pending consumption registration", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  async function recordUse(cycleId: string, usedQuantity: string) {
    const { input } = await prepareConsumptionFixture(context.db, OWNER_ID, cycleId);
    const request = { ...input, confirmEmpty: usedQuantity === "0", reason: "Measured unused stock",
      items: input.items.map((item) => ({ ...item, usedQuantity, basis: "OWNER_REPORTED" as const, reason: "Measured unused stock" })) };
    const result = await createConsumptionCommandService(context.db).confirmUse(OWNER_ID, request);
    return { request, result };
  }

  async function correctToZero(recorded: Awaited<ReturnType<typeof recordUse>>) {
    const ledger = await readStockLedger(context.db, OWNER_ID, recorded.request.items.map((i) => i.inventoryItemId));
    return createConsumptionCommandService(context.db).correctUse(OWNER_ID, {
      cycleId: recorded.request.cycleId, planningSnapshotId: recorded.request.planningSnapshotId, contextId: recorded.request.contextId,
      requestId: randomUUID(), expectedRevisionId: recorded.result.revisionIds[0]!, reason: "Unused after remeasurement",
      items: recorded.request.items.map((i) => ({ ...i, usedQuantity: "0", reason: "Unused after remeasurement" })),
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
    });
  }

  const unlock = (cycleId: string) => createPlanningCommandService(context.db).unlock(OWNER_ID, {
    cycleId, reason: "Replan production", confirmation: "ปลดล็อก",
  });

  it("does not disclose foreign or missing lifecycle sources", async () => {
    const s = await seedConsumptionScenario(context.db);
    for (const guard of [assertConsumptionCompleteAllowed, assertConsumptionUnlockAllowed]) {
      await expect(context.db.transaction((tx) => guard(tx, OTHER_OWNER_ID, s.cycleId, s.planningSnapshotId)))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
      await expect(context.db.transaction((tx) => guard(tx, OWNER_ID, s.cycleId, randomUUID())))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    }
  });

  it("blocks pending unlock without changing current snapshot or context", async () => {
    const s = await seedConsumptionScenario(context.db);
    const before = await context.db.select().from(cycleConsumptionContexts);
    await expect(unlock(s.cycleId)).rejects.toMatchObject({ kind: "UNLOCK_BLOCKED" });
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual(before);
    expect((await context.db.select().from(cyclePlanningSnapshots))[0]!.status).toBe("ACTIVE");
    expect((await context.db.select().from(bakeCycles))[0]!.activePlanningSnapshotId).toBe(s.planningSnapshotId);
  });

  it("does not unlock a context ever recorded with positive use even after correcting to zero", async () => {
    const s = await seedConsumptionScenario(context.db);
    const recorded = await recordUse(s.cycleId, "1");
    const corrected = await correctToZero(recorded);
    expect((await context.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, corrected.revisionIds[0]!))).map((i) => i.usedQuantity)).toEqual(["0.000000", "0.000000"]);
    expect((await context.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, recorded.result.revisionIds[0]!))).map((i) => i.usedQuantity)).toEqual(["1.000000", "1.000000"]);
    await expect(unlock(s.cycleId)).rejects.toMatchObject({ kind: "UNLOCK_BLOCKED" });
  });

  it("unlocks explicit all-zero use, keeps old context read-only and starts a fresh context after re-lock", async () => {
    const s = await seedConsumptionScenario(context.db);
    const recorded = await recordUse(s.cycleId, "0");
    const movements = await context.db.select().from(inventoryMovements);
    await unlock(s.cycleId);
    await expect(correctToZero(recorded)).rejects.toMatchObject({ kind: "STALE_DATA" });
    const preview = await createPlanningQueryService(context.db).preview(OWNER_ID, s.cycleId);
    const locked = await createPlanningCommandService(context.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
    expect(await createOperationsQueryService(context.db).getCycleOperations(OWNER_ID, s.cycleId))
      .toMatchObject({ consumption: { required: true, recorded: false, startBlockedByStockCheck: true } });
    await confirmConsumptionStock(context.db, OWNER_ID, s.cycleId, locked.id);
    await createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const contexts = await context.db.select().from(cycleConsumptionContexts);
    expect(contexts).toHaveLength(2);
    expect(contexts.find((c) => c.planningSnapshotId === s.planningSnapshotId)!.currentRevisionId).toBe(recorded.result.revisionIds[0]);
    expect(contexts.find((c) => c.planningSnapshotId === locked.id)).toMatchObject({ currentRevisionId: null });
    expect(await context.db.select().from(consumptionRevisionItems)).toHaveLength(2);
    expect(await context.db.select().from(inventoryMovements)).toHaveLength(movements.length + 2);
  });

  it("keeps original Operations unlock guards even for explicit zero use", async () => {
    const s = await seedConsumptionScenario(context.db);
    await recordUse(s.cycleId, "0");
    const order = (await context.db.select().from(orders)).find((o) => o.bakeCycleId === s.cycleId && o.fulfillmentStatus === "CONFIRMED")!;
    await createOrderOperationsCommandService(context.db).startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [order.id] });
    await expect(unlock(s.cycleId)).rejects.toMatchObject({ kind: "UNLOCK_BLOCKED_BY_OPERATIONS" });
  });

  it.each([false, true])("preserves cancelled production context and stock without reopening Operations (recorded=%s)", async (recorded) => {
    const s = await seedConsumptionScenario(context.db);
    let use = recorded ? await recordUse(s.cycleId, "1") : null;
    const before = await context.db.select().from(cycleConsumptionContexts);
    const movements = await context.db.select().from(inventoryMovements);
    await createCycleService(context.db).changeStatus(OWNER_ID, s.cycleId, "CANCELLED");
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual(before);
    expect(await context.db.select().from(inventoryMovements)).toEqual(movements);
    if (!use) use = await recordUse(s.cycleId, "1");
    await correctToZero(use);
    const cycles = createCycleOperationsCommandService(context.db);
    await expect(cycles.startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
    await expect(cycles.completeCycle(OWNER_ID, { cycleId: s.cycleId, expectedTaskGenerationId: s.taskGenerationId, confirmation: true })).rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
    const order = (await context.db.select().from(orders)).find((o) => o.bakeCycleId === s.cycleId && o.fulfillmentStatus === "CONFIRMED")!;
    await expect(createOrderOperationsCommandService(context.db).startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [order.id] }))
      .rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
    expect((await context.db.select().from(bakeCycles))[0]!.status).toBe("CANCELLED");
    expect(await createOperationsQueryService(context.db).getCycleOperations(OWNER_ID, s.cycleId))
      .toMatchObject({ consumption: { required: true, recorded: true, startBlockedByStockCheck: false } });
  });

  it("cancels before production without registering consumption or changing stock", async () => {
    const s = await seedConsumptionScenario(context.db, { start: false });
    const movements = await context.db.select().from(inventoryMovements);
    await createCycleService(context.db).changeStatus(OWNER_ID, s.cycleId, "CANCELLED");
    expect(await context.db.select().from(cycleConsumptionContexts)).toEqual([]);
    expect(await context.db.select().from(inventoryMovements)).toEqual(movements);
  });

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
    expect(await createOperationsQueryService(context.db).getCycleOperations(OWNER_ID, s.cycleId))
      .toMatchObject({ consumption: { required: true, recorded: false, startBlockedByStockCheck: true } });
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
    const locked = await createPlanningCommandService(context.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: "99999999-9999-4999-8999-999999999998", inputFingerprint: preview.inputFingerprint, overrides: [] });
    expect(await createOperationsQueryService(context.db).getCycleOperations(OWNER_ID, s.cycleId))
      .toMatchObject({ consumption: { required: true, recorded: false, startBlockedByStockCheck: false } });
    await createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    expect(await context.db.select().from(cycleConsumptionContexts)).toHaveLength(1);
    expect(await context.db.select().from(cycleConsumptionItems)).toEqual([]);
    expect(await context.db.select().from(cycleInventoryCounts)).toEqual([]);
    expect(await context.db.select().from(inventoryMovements)).toEqual([]);
    expect(await createOperationsQueryService(context.db).getCycleOperations(OWNER_ID, s.cycleId))
      .toMatchObject({ consumption: { required: true, recorded: false, startBlockedByStockCheck: false } });
    await expect(context.db.transaction((tx) => assertConsumptionCompleteAllowed(tx, OWNER_ID, s.cycleId, locked.id)))
      .rejects.toMatchObject({ kind: "PENDING_USE" });
    const { input } = await prepareConsumptionFixture(context.db, OWNER_ID, s.cycleId);
    await createConsumptionCommandService(context.db).confirmUse(OWNER_ID, input);
    await expect(context.db.transaction((tx) => assertConsumptionCompleteAllowed(tx, OWNER_ID, s.cycleId, locked.id))).resolves.toBeUndefined();
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
