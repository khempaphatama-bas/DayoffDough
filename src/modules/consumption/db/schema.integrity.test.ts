import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";

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
    const cycle = "84000000-0000-4000-8000-000000000001";
    const snapshot = "84000000-0000-4000-8000-000000000002";
    const generation = "84000000-0000-4000-8000-000000000003";
    const context = "84000000-0000-4000-8000-000000000004";
    const operation = "84000000-0000-4000-8000-000000000005";
    const revision = "84000000-0000-4000-8000-000000000006";
    await fixture.db.execute(sql`INSERT INTO bake_cycles (id, owner_id, name, target_production_date, primary_delivery_date)
      VALUES (${cycle}, ${owner}, 'Source', '2026-10-24', '2026-10-25')`);
    await fixture.db.execute(sql`INSERT INTO cycle_planning_snapshots
      (id, owner_id, bake_cycle_id, generation, status, lock_request_id, input_fingerprint, cycle_number, cycle_name,
       target_production_date, primary_delivery_date, labor_rate_satang_per_hour, default_waste_allowance_percent, timezone, currency, cost_complete, locked_at)
      VALUES (${snapshot}, ${owner}, ${cycle}, 1, 'ACTIVE', gen_random_uuid(), ${"a".repeat(64)}, 1, 'Source',
        '2026-10-24', '2026-10-25', 0, 0, 'Asia/Bangkok', 'THB', true, now())`);
    await fixture.db.execute(sql`INSERT INTO cycle_task_generations (id, owner_id, bake_cycle_id, planning_snapshot_id, generation, primary_delivery_date, timezone)
      VALUES (${generation}, ${owner}, ${cycle}, ${snapshot}, 1, '2026-10-25', 'Asia/Bangkok')`);
    await fixture.db.execute(sql`INSERT INTO cycle_consumption_contexts (id, owner_id, bake_cycle_id, planning_snapshot_id, task_generation_id)
      VALUES (${context}, ${owner}, ${cycle}, ${snapshot}, ${generation})`);
    // No price snapshot is required for an unpriced requirement.
    await fixture.db.execute(sql`INSERT INTO cycle_consumption_items (owner_id, context_id, planning_snapshot_id, inventory_item_id, inventory_item_name, inventory_category, base_unit, planned_quantity)
      VALUES (${owner}, ${context}, ${snapshot}, ${item}, 'Source flour', 'INGREDIENT', 'g', 2)`);
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
