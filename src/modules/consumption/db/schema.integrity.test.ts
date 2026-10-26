import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { confirmConsumptionStock, seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { loadConsumptionSource } from "../application/load-consumption-source";
import { cycleConsumptionContexts, cycleConsumptionItems } from "./schema";

const owner = "81000000-0000-4000-8000-000000000001";
describe("ledger persistence integrity", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let item: string;
  let movement: string;
  const rows = async (query: ReturnType<typeof sql>) => (await fixture.db.execute(query) as unknown as { rows: unknown[] }).rows;
  beforeEach(async () => {
    fixture = await createTestDatabase();
    const [created] = await fixture.db.insert(inventoryItems).values({ ownerId: owner, name: "Flour", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000" }).returning();
    item = created!.id;
    const [count] = await fixture.db.insert(inventoryMovements).values({ ownerId: owner, inventoryItemId: item, type: "COUNT", quantityDeltaInBaseUnit: "10", countedQuantityInBaseUnit: "10", occurredAt: new Date() }).returning();
    movement = count!.id;
  });
  afterEach(async () => fixture?.close());

  it("rejects direct V1 production INSERT and UPDATE without a registered context", async () => {
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    await expect(fixture.db.execute(sql`UPDATE bake_cycles SET status = 'IN_PRODUCTION' WHERE id = ${s.cycleId}`)).rejects.toThrow();
    await expect(fixture.db.execute(sql`INSERT INTO bake_cycles (owner_id, name, status, target_production_date, primary_delivery_date)
      VALUES (${OWNER_ID}, 'Bypass', 'IN_PRODUCTION', '2026-10-24', '2026-10-25')`)).rejects.toThrow();
    await expect(fixture.db.execute(sql`INSERT INTO bake_cycles (owner_id, name, status, target_production_date, primary_delivery_date)
      VALUES (${OWNER_ID}, 'Bypass', 'COMPLETED', '2026-10-24', '2026-10-25')`)).rejects.toThrow();
  });

  it("rejects orphan and incomplete source registration at commit", async () => {
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    await expect(fixture.db.execute(sql`INSERT INTO cycle_consumption_contexts (owner_id, bake_cycle_id, planning_snapshot_id, task_generation_id)
      VALUES (${OWNER_ID}, ${s.cycleId}, ${s.planningSnapshotId}, ${s.taskGenerationId})`)).rejects.toThrow();
    await expect(fixture.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO cycle_consumption_contexts (owner_id, bake_cycle_id, planning_snapshot_id, task_generation_id)
        VALUES (${OWNER_ID}, ${s.cycleId}, ${s.planningSnapshotId}, ${s.taskGenerationId})`);
      await tx.execute(sql`UPDATE bake_cycles SET status = 'IN_PRODUCTION' WHERE id = ${s.cycleId}`);
    })).rejects.toThrow();
  });

  it("blocks COUNT after a pending context is inserted even before its source children are inserted", async () => {
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    const source = await loadConsumptionSource(fixture.db, OWNER_ID, s.planningSnapshotId);
    await expect(fixture.db.transaction(async (tx) => {
      const [context] = await tx.insert(cycleConsumptionContexts).values({ ownerId: OWNER_ID, bakeCycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: s.taskGenerationId }).returning();
      await tx.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "COUNT", quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: "2200", occurredAt: new Date() });
      await tx.insert(cycleConsumptionItems).values(source.map((item) => ({ ...item, ownerId: OWNER_ID, contextId: context!.id, planningSnapshotId: s.planningSnapshotId })));
      await tx.execute(sql`UPDATE bake_cycles SET status = 'IN_PRODUCTION' WHERE id = ${s.cycleId}`);
    })).rejects.toMatchObject({ cause: { message: "PENDING_USE: record pending consumption before counting stock" } });
  });

  it.each(["quantity", "label", "missing", "extra"])("rejects %s divergence from the exact immutable registered source", async (change) => {
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    const source = await loadConsumptionSource(fixture.db, OWNER_ID, s.planningSnapshotId);
    const [extra] = await fixture.db.insert(inventoryItems).values({ ownerId: OWNER_ID, name: "Extra", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000" }).returning();
    await expect(fixture.db.transaction(async (tx) => {
      const [context] = await tx.insert(cycleConsumptionContexts).values({ ownerId: OWNER_ID, bakeCycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: s.taskGenerationId }).returning();
      const items = source.map((item, index) => ({ ...item, ownerId: OWNER_ID, contextId: context!.id, planningSnapshotId: s.planningSnapshotId,
        ...(change === "quantity" && index === 0 ? { plannedQuantity: "1" } : {}),
        ...(change === "label" && index === 0 ? { inventoryItemName: "Not the snapshot label" } : {}),
      }));
      await tx.insert(cycleConsumptionItems).values(change === "missing" ? items.slice(1) : items);
      if (change === "extra") await tx.insert(cycleConsumptionItems).values({ ...items[0]!, inventoryItemId: extra!.id, priceSnapshotId: null });
      await tx.execute(sql`UPDATE bake_cycles SET status = 'IN_PRODUCTION' WHERE id = ${s.cycleId}`);
    })).rejects.toThrow();
    expect(await rows(sql`SELECT id FROM cycle_consumption_contexts WHERE owner_id = ${OWNER_ID}`)).toEqual([]);
  });

  it("rejects an owned generation belonging to a different Cycle and snapshot", async () => {
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    const otherCycle = "84000000-0000-4000-8000-000000000011";
    const otherSnapshot = "84000000-0000-4000-8000-000000000012";
    const otherGeneration = "84000000-0000-4000-8000-000000000013";
    await fixture.db.execute(sql`INSERT INTO bake_cycles (id, owner_id, name, status, target_production_date, primary_delivery_date)
      VALUES (${otherCycle}, ${OWNER_ID}, 'Another source', 'OPEN', '2026-08-29', '2026-08-30')`);
    await fixture.db.execute(sql`INSERT INTO cycle_planning_snapshots
      (id, owner_id, bake_cycle_id, generation, status, lock_request_id, input_fingerprint, cycle_number, cycle_name, target_production_date, primary_delivery_date, labor_rate_satang_per_hour, default_waste_allowance_percent, timezone, currency, cost_complete, locked_at)
      SELECT ${otherSnapshot}, owner_id, ${otherCycle}, generation, status, gen_random_uuid(), input_fingerprint, cycle_number, cycle_name, target_production_date, primary_delivery_date, labor_rate_satang_per_hour, default_waste_allowance_percent, timezone, currency, cost_complete, locked_at
      FROM cycle_planning_snapshots WHERE id = ${s.planningSnapshotId}`);
    await fixture.db.execute(sql`INSERT INTO cycle_task_generations (id, owner_id, bake_cycle_id, planning_snapshot_id, generation, primary_delivery_date, timezone)
      SELECT ${otherGeneration}, owner_id, ${otherCycle}, ${otherSnapshot}, generation, primary_delivery_date, timezone FROM cycle_task_generations WHERE id = ${s.taskGenerationId}`);
    await expect(fixture.db.insert(cycleConsumptionContexts).values({ ownerId: OWNER_ID, bakeCycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: otherGeneration }))
      .rejects.toMatchObject({ cause: { message: "consumption requires the exact current generation" } });
  });

  it("rejects UPDATE/DELETE of movements and direct metadata reset/delete/insert atomically", async () => {
    const before = await rows(sql`SELECT * FROM inventory_ledger_states`);
    for (const statement of [
      sql`UPDATE inventory_movements SET quantity_delta_in_base_unit = 0 WHERE id = ${movement}`,
      sql`DELETE FROM inventory_movements WHERE id = ${movement}`,
      sql`UPDATE inventory_ledger_states SET ledger_revision = 0, latest_count_movement_id = NULL WHERE inventory_item_id = ${item}`,
      sql`UPDATE inventory_ledger_states SET ledger_revision = 2 WHERE inventory_item_id = ${item}`,
      sql`DELETE FROM inventory_ledger_states WHERE inventory_item_id = ${item}`,
      sql`INSERT INTO inventory_ledger_states (owner_id, inventory_item_id) VALUES (${owner}, ${item}) ON CONFLICT (owner_id, inventory_item_id) DO UPDATE SET ledger_revision = 0`,
    ]) {
      await expect(fixture.db.execute(statement)).rejects.toThrow();
      expect(await rows(sql`SELECT * FROM inventory_ledger_states`)).toEqual(before);
    }
    expect(await rows(sql`SELECT quantity_delta_in_base_unit FROM inventory_movements WHERE id = ${movement}`)).toEqual([{ quantity_delta_in_base_unit: "10.000000" }]);
  });

  it("rolls back applied tokens when a movement transaction fails", async () => {
    const before = await rows(sql`SELECT * FROM inventory_ledger_states`);
    await expect(fixture.db.transaction(async (tx) => {
      await tx.insert(inventoryMovements).values({ ownerId: owner, inventoryItemId: item, type: "PURCHASE", quantityDeltaInBaseUnit: "2", occurredAt: new Date() });
      await tx.execute(sql`SELECT 1 / 0`);
    })).rejects.toThrow();
    expect(await rows(sql`SELECT * FROM inventory_ledger_states`)).toEqual(before);
    expect(await rows(sql`SELECT count(*)::int AS count FROM inventory_movements`)).toEqual([{ count: 1 }]);
  });

  it("does not advance tokens for ignored duplicate movement inserts", async () => {
    const before = await rows(sql`SELECT * FROM inventory_ledger_states`);
    await fixture.db.insert(inventoryMovements).values({ id: movement, ownerId: owner, inventoryItemId: item, type: "PURCHASE", quantityDeltaInBaseUnit: "20", occurredAt: new Date() }).onConflictDoNothing();
    expect(await rows(sql`SELECT * FROM inventory_ledger_states`)).toEqual(before);
  });

  it("rejects TRUNCATE rather than allowing history or fences to be erased", async () => {
    await expect(fixture.db.execute(sql`TRUNCATE inventory_movements CASCADE`)).rejects.toThrow();
    await expect(fixture.db.execute(sql`TRUNCATE inventory_ledger_states`)).rejects.toThrow();
    expect(await rows(sql`SELECT count(*)::int AS count FROM inventory_movements`)).toEqual([{ count: 1 }]);
  });

  it("keeps operation receipts append-only", async () => {
    const operation = "83000000-0000-4000-8000-000000000001";
    await fixture.db.execute(sql`INSERT INTO consumption_operations (id, owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
      VALUES (${operation}, ${owner}, gen_random_uuid(), 'CONFIRM', '{}', '{}', '{}')`);
    await expect(fixture.db.execute(sql`UPDATE consumption_operations SET manifest = '{"changed":true}' WHERE id = ${operation}`)).rejects.toThrow();
    await expect(fixture.db.execute(sql`DELETE FROM consumption_operations WHERE id = ${operation}`)).rejects.toThrow();
  });

  it("protects immutable context/source/revision rows and only advances to an immediate owned successor", async () => {
    const source = await seedLockedPlanningScenario(fixture.db, { ownerId: owner, includeIngredientPrice: false });
    await confirmConsumptionStock(fixture.db, owner, source.cycleId, source.planningSnapshotId);
    await createCycleOperationsCommandService(fixture.db).startCycle(owner, { cycleId: source.cycleId });
    const [registered] = await rows(sql`SELECT id FROM cycle_consumption_contexts WHERE bake_cycle_id = ${source.cycleId}`) as { id: string }[];
    const context = registered!.id;
    const item = source.ingredientItemId;
    const [initial] = await rows(sql`SELECT count_movement_id FROM cycle_inventory_counts WHERE planning_snapshot_id = ${source.planningSnapshotId} AND inventory_item_id = ${item}`) as { count_movement_id: string }[];
    const movement = initial!.count_movement_id;
    expect(await rows(sql`SELECT unit_cost_satang FROM cycle_inventory_price_snapshots WHERE planning_snapshot_id = ${source.planningSnapshotId} AND inventory_item_id = ${item}`)).toEqual([{ unit_cost_satang: null }]);
    const operation = "84000000-0000-4000-8000-000000000005";
    const revision = "84000000-0000-4000-8000-000000000006";
    await fixture.db.execute(sql`INSERT INTO consumption_operations (id, owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
      VALUES (${operation}, ${owner}, gen_random_uuid(), 'CONFIRM', '{}', ARRAY[${revision}]::uuid[], '{}')`);
    await fixture.db.execute(sql`INSERT INTO consumption_revisions (id, owner_id, context_id, operation_id, revision_number)
      VALUES (${revision}, ${owner}, ${context}, ${operation}, 1)`);
    const [use] = await fixture.db.insert(inventoryMovements).values({ ownerId: owner, inventoryItemId: item, type: "CONSUMPTION", quantityDeltaInBaseUnit: "-2", occurredAt: new Date() }).returning();
    await fixture.db.execute(sql`INSERT INTO consumption_revision_items (owner_id, context_id, revision_id, inventory_item_id, used_quantity, basis, mode, quantity_delta, initial_count_movement_id, movement_id)
      VALUES (${owner}, ${context}, ${revision}, ${item}, 2, 'PLANNED', 'DIRECT', -2, ${movement}, ${use!.id})`);
    await fixture.db.execute(sql`UPDATE cycle_consumption_contexts SET current_revision_id = ${revision} WHERE id = ${context}`);
    for (const statement of [
      sql`UPDATE cycle_consumption_contexts SET created_at = now() + interval '1 day' WHERE id = ${context}`,
      sql`UPDATE cycle_consumption_contexts SET current_revision_id = NULL WHERE id = ${context}`,
      sql`DELETE FROM cycle_consumption_contexts WHERE id = ${context}`,
      sql`UPDATE cycle_consumption_items SET planned_quantity = 9 WHERE context_id = ${context}`,
      sql`DELETE FROM cycle_consumption_items WHERE context_id = ${context}`,
      sql`UPDATE consumption_revisions SET reason = 'rewrite' WHERE id = ${revision}`,
      sql`DELETE FROM consumption_revisions WHERE id = ${revision}`,
      sql`UPDATE consumption_revision_items SET used_quantity = 3 WHERE revision_id = ${revision}`,
      sql`DELETE FROM consumption_revision_items WHERE revision_id = ${revision}`,
    ]) await expect(fixture.db.execute(statement)).rejects.toThrow();
    expect(await rows(sql`SELECT current_revision_id FROM cycle_consumption_contexts WHERE id = ${context}`)).toEqual([{ current_revision_id: revision }]);
    const foreignOperation = "84000000-0000-4000-8000-000000000007";
    await fixture.db.execute(sql`INSERT INTO consumption_operations (id, owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
      VALUES (${foreignOperation}, '81000000-0000-4000-8000-000000000002', gen_random_uuid(), 'CORRECT', '{}', '{}', '{}')`);
    // Valid context/predecessor, but another owner's receipt: assert the actual
    // operation FK, not an unrelated missing-context or duplicate-row failure.
    await expect(fixture.db.execute(sql`INSERT INTO consumption_revisions (owner_id, context_id, operation_id, revision_number, previous_revision_id)
      VALUES (${owner}, ${context}, ${foreignOperation}, 2, ${revision})`)).rejects.toMatchObject({ cause: { constraint: "consumption_revisions_operation_fk" } });
    const nextOperation = "84000000-0000-4000-8000-000000000008";
    const skippedRevision = "84000000-0000-4000-8000-000000000009";
    await fixture.db.execute(sql`INSERT INTO consumption_operations (id, owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
      VALUES (${nextOperation}, ${owner}, gen_random_uuid(), 'CORRECT', '{}', ARRAY[${skippedRevision}]::uuid[], '{}')`);
    await fixture.db.execute(sql`INSERT INTO consumption_revisions (id, owner_id, context_id, operation_id, revision_number, previous_revision_id)
      VALUES (${skippedRevision}, ${owner}, ${context}, ${nextOperation}, 3, ${revision})`);
    await expect(fixture.db.execute(sql`UPDATE cycle_consumption_contexts SET current_revision_id = ${skippedRevision} WHERE id = ${context}`)).rejects.toMatchObject({ cause: { message: "consumption pointer requires an immediate owned successor" } });
  });
});
