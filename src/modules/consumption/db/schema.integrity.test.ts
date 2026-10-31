import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { confirmConsumptionStock, prepareConsumptionFixture, seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { loadConsumptionSource } from "../application/load-consumption-source";
import { consumptionOperations, consumptionRevisions, consumptionRevisionItems, cycleConsumptionContexts, cycleConsumptionItems } from "./schema";
import { writeConsumptionOperation } from "../application/command-support";

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

  it("rejects an incomplete initial-use receipt at commit", async () => {
    await expect(fixture.db.execute(sql`INSERT INTO consumption_operations (owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
      VALUES (${owner}, gen_random_uuid(), 'CONFIRM', '{}', '{}', '{}')`)).rejects.toThrow();
    expect(await rows(sql`SELECT id FROM consumption_operations`)).toEqual([]);
  });

  it.each(["missing item", "missing movement", "wrong movement delta", "wrong movement source", "wrong movement type", "wrong initial fence", "wrong direct delta", "missing pointer", "wrong receipt IDs", "noncanonical manifest", "changed manifest source", "unconfirmed use", "duplicate ledger token"])("rejects raw %s atomically", async (attack) => {
    const s = await seedConsumptionScenario(fixture.db);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    let bad = prepared;
    if (attack === "missing item") bad = { ...bad, revisionItems: bad.revisionItems.slice(1), usageMovements: bad.usageMovements.slice(1) };
    if (attack === "missing movement") bad = { ...bad, usageMovements: bad.usageMovements.slice(1) };
    if (attack === "wrong movement delta") bad = { ...bad, usageMovements: bad.usageMovements.map((m) => ({ ...m, quantityDeltaInBaseUnit: "0" })) };
    if (attack === "wrong movement source") bad = { ...bad, usageMovements: bad.usageMovements.map((m) => ({ ...m, referenceId: s.cycleId })) };
    if (attack === "wrong movement type") bad = { ...bad, usageMovements: bad.usageMovements.map((m) => ({ ...m, type: "CORRECTION" })) };
    if (attack === "wrong initial fence") bad = { ...bad, revisionItems: bad.revisionItems.map((i) => ({ ...i, initialCountMovementId: null })) };
    if (attack === "wrong direct delta") bad = { ...bad, revisionItems: bad.revisionItems.map((i) => ({ ...i, quantityDelta: "0" })) };
    if (attack === "missing pointer") bad = { ...bad, pointerUpdates: [] };
    if (attack === "wrong receipt IDs") bad = { ...bad, operation: { ...bad.operation, resultRevisionIds: [s.cycleId] } };
    if (attack === "noncanonical manifest") bad = { ...bad, operation: { ...bad.operation, canonicalManifest: ` ${bad.operation.canonicalManifest}` } };
    if (["changed manifest source", "unconfirmed use", "duplicate ledger token"].includes(attack)) {
      const manifest = JSON.parse(bad.operation.canonicalManifest);
      if (attack === "changed manifest source") manifest.contextId = s.cycleId;
      if (attack === "unconfirmed use") manifest.confirmTakenOutOfUse = false;
      if (attack === "duplicate ledger token") manifest.expectedLedger.splice(1, 0, manifest.expectedLedger[0]);
      bad = { ...bad, operation: { ...bad.operation, canonicalManifest: JSON.stringify(manifest) } };
    }
    await expect(fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, bad, confirmedAt))).rejects.toThrow();
    expect(await rows(sql`SELECT id FROM consumption_operations`)).toEqual([]);
    expect(await rows(sql`SELECT id FROM consumption_revisions`)).toEqual([]);
    expect(await rows(sql`SELECT id FROM consumption_revision_items`)).toEqual([]);
    expect(await rows(sql`SELECT id FROM inventory_movements WHERE type = 'CONSUMPTION'`)).toEqual([]);
    expect(await rows(sql`SELECT current_revision_id FROM cycle_consumption_contexts WHERE bake_cycle_id = ${s.cycleId}`)).toEqual([{ current_revision_id: null }]);
  });

  it("rejects raw shortage before later events can conceal a negative balance", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const confirmedAt = new Date("2026-10-24T12:00:00Z");
    // Preserve applied COUNT identity but consume available stock with a legitimate
    // existing correction; the stale-token check is independently refreshed.
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "CORRECTION", quantityDeltaInBaseUnit: "-1", occurredAt: confirmedAt });
    const refreshed = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    await expect(fixture.db.transaction(async (tx) => {
      await writeConsumptionOperation(tx, OWNER_ID, refreshed.prepared, confirmedAt);
      await tx.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "PURCHASE", quantityDeltaInBaseUnit: "1", occurredAt: confirmedAt });
    })).rejects.toMatchObject({ cause: { message: "consumption cannot make stock negative" } });
    expect(await rows(sql`SELECT id FROM consumption_operations`)).toEqual([]);
  });

  it.each(["\t", "\u00a0", "\ufeff"])("rejects a raw canonical-looking payload with an untrimmed whitespace reason %j", async (reason) => {
    const s = await seedConsumptionScenario(fixture.db);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const manifest = JSON.parse(prepared.operation.canonicalManifest);
    manifest.reason = reason;
    const bad = { ...prepared,
      operation: { ...prepared.operation, canonicalManifest: JSON.stringify(manifest) },
      revisions: prepared.revisions.map((r) => ({ ...r, reason })),
    };
    await expect(fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, bad, confirmedAt))).rejects.toThrow();
  });

  it("rejects a raw planned confirmation after cancellation even with exact plan quantities", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    await fixture.db.execute(sql`UPDATE bake_cycles SET status = 'CANCELLED' WHERE id = ${s.cycleId}`);
    await expect(fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, prepared, confirmedAt)))
      .rejects.toMatchObject({ cause: { message: "initial consumption requires exact usage provenance and direct delta" } });
  });

  it("rejects an intervening event between revision-item preparation and usage application", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    await expect(fixture.db.transaction(async (tx) => {
      const { canonicalManifest, resultRevisionIds, resultCountMovementIds, ...operation } = prepared.operation;
      await tx.insert(consumptionOperations).values({ ...operation, manifest: canonicalManifest, revisionIds: [...resultRevisionIds], countMovementIds: [...resultCountMovementIds], createdAt: confirmedAt });
      await tx.insert(consumptionRevisions).values(prepared.revisions.map((r) => ({ ...r, confirmedAt })));
      await tx.insert(consumptionRevisionItems).values([...prepared.revisionItems]);
      // Deliberately interleave a real event, not a trigger-depth fixture bypass.
      await tx.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "PURCHASE", quantityDeltaInBaseUnit: "0", occurredAt: confirmedAt });
      await tx.insert(inventoryMovements).values([...prepared.usageMovements]);
      await tx.execute(sql`UPDATE cycle_consumption_contexts SET current_revision_id = ${resultRevisionIds[0]} WHERE id = ${prepared.pointerUpdates[0]!.contextId}`);
    })).rejects.toMatchObject({ cause: { message: "consumption requires current applied ledger tokens" } });
    expect(await rows(sql`SELECT id FROM consumption_operations`)).toEqual([]);
  });

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
    const s = await seedConsumptionScenario(fixture.db);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const operation = prepared.operation.id;
    await fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, prepared, confirmedAt));
    await expect(fixture.db.execute(sql`UPDATE consumption_operations SET manifest = '{"changed":true}' WHERE id = ${operation}`)).rejects.toThrow();
    await expect(fixture.db.execute(sql`DELETE FROM consumption_operations WHERE id = ${operation}`)).rejects.toThrow();
  });

  it("reloads the owned receipt when the reusable writer loses the unique request insert", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const first = await fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, prepared, confirmedAt));
    expect(await fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, prepared, confirmedAt)))
      .toEqual({ ...first, replayed: true });
    const changed = { ...prepared, operation: { ...prepared.operation, canonicalManifest: prepared.operation.canonicalManifest.replace('"reason":null', '"reason":"changed"') } };
    await expect(fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, changed, confirmedAt)))
      .rejects.toMatchObject({ kind: "REQUEST_CONFLICT" });
    expect(await rows(sql`SELECT id FROM consumption_operations WHERE owner_id = ${OWNER_ID}`)).toEqual([{ id: first.operationId }]);
    expect(await rows(sql`SELECT id FROM inventory_movements WHERE type = 'CONSUMPTION'`)).toHaveLength(2);
  });

  it("protects immutable context/source/revision rows and only advances to an immediate owned successor", async () => {
    const source = await seedLockedPlanningScenario(fixture.db, { ownerId: owner, includeIngredientPrice: false });
    await confirmConsumptionStock(fixture.db, owner, source.cycleId, source.planningSnapshotId);
    await createCycleOperationsCommandService(fixture.db).startCycle(owner, { cycleId: source.cycleId });
    const [registered] = await rows(sql`SELECT id FROM cycle_consumption_contexts WHERE bake_cycle_id = ${source.cycleId}`) as { id: string }[];
    const context = registered!.id;
    const item = source.ingredientItemId;
    expect(await rows(sql`SELECT unit_cost_satang FROM cycle_inventory_price_snapshots WHERE planning_snapshot_id = ${source.planningSnapshotId} AND inventory_item_id = ${item}`)).toEqual([{ unit_cost_satang: null }]);
    const { prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, owner, source.cycleId);
    const revision = prepared.operation.resultRevisionIds[0]!;
    await fixture.db.transaction((tx) => writeConsumptionOperation(tx, owner, prepared, confirmedAt));
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
    // Valid context/predecessor, but another owner's receipt: assert the actual
    // operation FK, not an unrelated missing-context or duplicate-row failure.
    await expect(fixture.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO consumption_operations (id, owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
        VALUES (${foreignOperation}, '81000000-0000-4000-8000-000000000002', gen_random_uuid(), 'CORRECT', '{}', '{}', '{}')`);
      await tx.execute(sql`INSERT INTO consumption_revisions (owner_id, context_id, operation_id, revision_number, previous_revision_id)
        VALUES (${owner}, ${context}, ${foreignOperation}, 2, ${revision})`);
    })).rejects.toMatchObject({ cause: { constraint: "consumption_revisions_operation_fk" } });
    const skippedRevision = "84000000-0000-4000-8000-000000000009";
    await expect(fixture.db.execute(sql`UPDATE cycle_consumption_contexts SET current_revision_id = ${skippedRevision} WHERE id = ${context}`)).rejects.toMatchObject({ cause: { message: "consumption pointer requires an immediate owned successor" } });
  });
});
