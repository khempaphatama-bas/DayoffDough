import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { confirmConsumptionStock, prepareConsumptionFixture, seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { loadConsumptionSource } from "../application/load-consumption-source";
import { consumptionOperations, consumptionRevisions, consumptionRevisionItems, cycleConsumptionContexts, cycleConsumptionItems } from "./schema";
import { writeConsumptionOperation, type PreparedConsumptionOperation } from "../application/command-support";
import { createConsumptionCommandService } from "../application/consumption-commands";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { canonicalizeUseRequest } from "../domain/request-manifest";
import { cycleTasks } from "@/modules/production/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { recordOperationsConsumption } from "@tests/fixtures/operations";

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

  async function finishWork(s: Awaited<ReturnType<typeof seedConsumptionScenario>>) {
    const operationalOrders = await fixture.db.select().from(orders).where(eq(orders.bakeCycleId, s.cycleId));
    const ids = operationalOrders.filter((o) => o.fulfillmentStatus !== "CANCELLED").map((o) => o.id);
    const commands = createOrderOperationsCommandService(fixture.db);
    await commands.startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: ids });
    for (const id of ids) {
      const [item] = await fixture.db.select().from(orderItems).where(eq(orderItems.orderId, id));
      await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: item!.id, packedQuantity: item!.quantity, expectedPackedQuantity: 0 });
      await commands.confirmOrderPacked(OWNER_ID, { cycleId: s.cycleId, orderId: id });
    }
    await commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: ids });
    await fixture.db.update(cycleTasks).set({ status: "DONE" }).where(eq(cycleTasks.cycleTaskGenerationId, s.taskGenerationId));
  }

  it("rejects raw completion of finished V1 work while consumption is pending", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    await finishWork(s);
    await expect(fixture.db.execute(sql`UPDATE bake_cycles SET status = 'COMPLETED' WHERE id = ${s.cycleId}`))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining("PENDING_USE") } });
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    await createConsumptionCommandService(fixture.db).confirmUse(OWNER_ID, input);
    await fixture.db.execute(sql`UPDATE bake_cycles SET status = 'COMPLETED' WHERE id = ${s.cycleId}`);
  });

  it.each([
    ["COMPLETED", "status"], ["COMPLETED", "pointer"], ["COMPLETED", "snapshot"],
    ["CANCELLED", "status"], ["CANCELLED", "pointer"], ["CANCELLED", "snapshot"],
  ] as const)("protects the V1 terminal %s %s after explicit zero use", async (status, target) => {
    const s = await seedConsumptionScenario(fixture.db);
    await recordOperationsConsumption(fixture.db, OWNER_ID, s.cycleId, true);
    if (status === "COMPLETED") {
      await finishWork(s);
      await createCycleOperationsCommandService(fixture.db).completeCycle(OWNER_ID, {
        cycleId: s.cycleId, expectedTaskGenerationId: s.taskGenerationId, confirmation: true,
      });
    } else await fixture.db.update(bakeCycles).set({ status }).where(eq(bakeCycles.id, s.cycleId));
    const contextBefore = await fixture.db.select().from(cycleConsumptionContexts);
    const movementsBefore = await fixture.db.select().from(inventoryMovements);
    const mutation = target === "status" ? sql`UPDATE bake_cycles SET status = 'OPEN' WHERE id = ${s.cycleId}`
      : target === "pointer" ? sql`UPDATE bake_cycles SET active_planning_snapshot_id = NULL WHERE id = ${s.cycleId}`
      : sql`UPDATE cycle_planning_snapshots SET status = 'SUPERSEDED', unlocked_at = now(), unlock_reason = 'raw terminal bypass', unlocked_from_status = 'IN_PRODUCTION' WHERE id = ${s.planningSnapshotId}`;
    await expect(fixture.db.execute(mutation)).rejects.toThrow();
    expect((await fixture.db.select().from(bakeCycles).where(eq(bakeCycles.id, s.cycleId)))[0])
      .toMatchObject({ status, activePlanningSnapshotId: s.planningSnapshotId });
    expect((await fixture.db.select().from(cyclePlanningSnapshots).where(eq(cyclePlanningSnapshots.id, s.planningSnapshotId)))[0]!.status).toBe("ACTIVE");
    expect(await fixture.db.select().from(cycleConsumptionContexts)).toEqual(contextBefore);
    expect(await fixture.db.select().from(inventoryMovements)).toEqual(movementsBefore);
    // The guard protects lifecycle identity, not unrelated terminal metadata.
    await fixture.db.update(bakeCycles).set({ notes: "Historical note" }).where(eq(bakeCycles.id, s.cycleId));
  });

  it("keeps pending cancelled contexts protected from source supersession", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
    await expect(fixture.db.execute(sql`UPDATE cycle_planning_snapshots SET status = 'SUPERSEDED', unlocked_at = now(), unlock_reason = 'pending terminal bypass', unlocked_from_status = 'IN_PRODUCTION' WHERE id = ${s.planningSnapshotId}`)).rejects.toThrow();
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBeNull();
  });

  it.each(["cycle", "snapshot"])("rejects raw pending unlock through %s without dropping the current context", async (target) => {
    const s = await seedConsumptionScenario(fixture.db);
    const mutation = target === "cycle"
      ? sql`UPDATE bake_cycles SET status = 'OPEN', active_planning_snapshot_id = NULL WHERE id = ${s.cycleId}`
      : sql`UPDATE cycle_planning_snapshots SET status = 'SUPERSEDED', unlocked_at = now(), unlock_reason = 'raw bypass', unlocked_from_status = 'IN_PRODUCTION' WHERE id = ${s.planningSnapshotId}`;
    await expect(fixture.db.execute(mutation)).rejects.toMatchObject({ cause: { message: expect.stringContaining("UNLOCK_BLOCKED") } });
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBeNull();
  });

  it("rejects an incomplete initial-use receipt at commit", async () => {
    await expect(fixture.db.execute(sql`INSERT INTO consumption_operations (owner_id, request_id, kind, manifest, revision_ids, count_movement_ids)
      VALUES (${owner}, gen_random_uuid(), 'CONFIRM', '{}', '{}', '{}')`)).rejects.toThrow();
    expect(await rows(sql`SELECT id FROM consumption_operations`)).toEqual([]);
  });

  // Start with a real CONFIRM. Every attack below mutates a complete, legitimate
  // successor; no dangling rows, disabled triggers or fake predecessor fixture.
  const prepareCorrection = async (counted = false) => {
    const s = await seedConsumptionScenario(fixture.db);
    const initial = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const service = createConsumptionCommandService(fixture.db, { now: () => initial.confirmedAt });
    const first = await service.confirmUse(OWNER_ID, initial.input);
    if (counted) await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "COUNT", quantityDeltaInBaseUnit: "25", countedQuantityInBaseUnit: "25", occurredAt: initial.confirmedAt });
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    const operationId = randomUUID();
    const revisionId = randomUUID();
    const input = { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, contextId: initial.input.contextId,
      requestId: randomUUID(), expectedRevisionId: first.revisionIds[0]!, reason: "Measured again",
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
      items: initial.input.items.map((i) => ({ ...i, usedQuantity: "1", basis: "OWNER_REPORTED" as const, reason: "Measured again" })),
    };
    const revisionItems = initial.prepared.revisionItems.map((i) => ({ ...i, revisionId, usedQuantity: "1", basis: "OWNER_REPORTED" as const, reason: "Measured again", movementId: randomUUID(),
      mode: counted && i.inventoryItemId === s.itemIds[0] ? "HISTORY_ONLY" as const : "DIRECT" as const,
      quantityDelta: i.inventoryItemId === s.itemIds[0] ? (counted ? "0" : "2199") : "13" }));
    const prepared: PreparedConsumptionOperation = {
      operation: { id: operationId, ownerId: OWNER_ID, requestId: input.requestId, kind: "CORRECT", canonicalManifest: canonicalizeUseRequest("CORRECT", input), resultRevisionIds: [revisionId], resultCountMovementIds: [] },
      revisions: [{ id: revisionId, ownerId: OWNER_ID, contextId: input.contextId, operationId, revisionNumber: 2, previousRevisionId: input.expectedRevisionId, reason: input.reason }], revisionItems,
      usageMovements: revisionItems.map((i) => ({ id: i.movementId, ownerId: OWNER_ID, inventoryItemId: i.inventoryItemId, type: "CORRECTION", quantityDeltaInBaseUnit: i.quantityDelta,
        referenceType: "CONSUMPTION_REVISION", referenceId: revisionId, occurredAt: initial.confirmedAt, notes: i.reason })),
      countMovements: [], pointerUpdates: [{ contextId: input.contextId, expectedRevisionId: input.expectedRevisionId, newRevisionId: revisionId }],
    };
    return { s, input, prepared, confirmedAt: initial.confirmedAt, service };
  };

  it("rejects raw unlock of historical positive use corrected to zero", async () => {
    const { s, input, service } = await prepareCorrection();
    const result = await service.correctUse(OWNER_ID, { ...input, items: input.items.map((i) => ({ ...i, usedQuantity: "0" })) });
    expect((await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, result.revisionIds[0]!))).map((i) => i.usedQuantity)).toEqual(["0.000000", "0.000000"]);
    await expect(fixture.db.execute(sql`UPDATE bake_cycles SET status = 'OPEN', active_planning_snapshot_id = NULL WHERE id = ${s.cycleId}`))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining("UNLOCK_BLOCKED") } });
  });

  it.each(["skip", "predecessor", "fence", "delta", "mode", "movement type", "missing movement", "missing item", "missing pointer", "absolute target", "reason", "SETTLE"])("rejects raw CORRECT %s without moving the predecessor pointer", async (attack) => {
    const { prepared, confirmedAt } = await prepareCorrection();
    const before = await rows(sql`SELECT * FROM consumption_revisions ORDER BY id`);
    const movements = await rows(sql`SELECT * FROM inventory_movements ORDER BY id`);
    let bad = prepared;
    if (attack === "skip") bad = { ...bad, revisions: bad.revisions.map((r) => ({ ...r, revisionNumber: 3 })) };
    if (attack === "predecessor") bad = { ...bad, revisions: bad.revisions.map((r) => ({ ...r, previousRevisionId: randomUUID() })) };
    if (attack === "fence") bad = { ...bad, revisionItems: bad.revisionItems.map((i) => ({ ...i, initialCountMovementId: null })) };
    if (attack === "delta") bad = { ...bad, revisionItems: bad.revisionItems.map((i) => ({ ...i, quantityDelta: "0" })), usageMovements: bad.usageMovements.map((m) => ({ ...m, quantityDeltaInBaseUnit: "0" })) };
    if (attack === "mode") bad = { ...bad, revisionItems: bad.revisionItems.map((i) => ({ ...i, mode: "HISTORY_ONLY", quantityDelta: "0" })), usageMovements: bad.usageMovements.map((m) => ({ ...m, quantityDeltaInBaseUnit: "0" })) };
    if (attack === "movement type") bad = { ...bad, usageMovements: bad.usageMovements.map((m) => ({ ...m, type: "CONSUMPTION" })) };
    if (attack === "missing movement") bad = { ...bad, usageMovements: bad.usageMovements.slice(1) };
    if (attack === "missing item") bad = { ...bad, revisionItems: bad.revisionItems.slice(1), usageMovements: bad.usageMovements.slice(1) };
    if (attack === "missing pointer") bad = { ...bad, pointerUpdates: [] };
    if (attack === "absolute target") bad = { ...bad, operation: { ...bad.operation, canonicalManifest: bad.operation.canonicalManifest.replace('"usedQuantity":"1"', '"usedQuantity":"2"') } };
    if (attack === "reason") bad = { ...bad, revisions: bad.revisions.map((r) => ({ ...r, reason: "\t" })) };
    if (attack === "SETTLE") bad = { ...bad, operation: { ...bad.operation, kind: "SETTLE" } };
    await expect(fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, bad, confirmedAt))).rejects.toThrow();
    expect(await rows(sql`SELECT * FROM consumption_revisions ORDER BY id`)).toEqual(before);
    expect(await rows(sql`SELECT * FROM inventory_movements ORDER BY id`)).toEqual(movements);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(prepared.revisions[0]!.previousRevisionId);
    expect(await fixture.db.select().from(consumptionOperations)).toHaveLength(1);
  });

  it.each(["reset fence", "direct recut"])("rejects raw CORRECT %s after an applied COUNT", async (attack) => {
    const { s, prepared, confirmedAt } = await prepareCorrection(true);
    const [current] = await readStockLedger(fixture.db, OWNER_ID, [s.itemIds[0]!]);
    const bad = { ...prepared, revisionItems: prepared.revisionItems.map((i) => i.inventoryItemId !== s.itemIds[0] ? i : {
      ...i, ...(attack === "reset fence" ? { initialCountMovementId: current!.countMovementId } : { mode: "DIRECT" as const, quantityDelta: "2199" }),
    }), usageMovements: prepared.usageMovements.map((m) => attack === "direct recut" && m.inventoryItemId === s.itemIds[0] ? { ...m, quantityDeltaInBaseUnit: "2199" } : m) };
    await expect(fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, bad, confirmedAt))).rejects.toThrow();
    expect((await readStockLedger(fixture.db, OWNER_ID, [s.itemIds[0]!]))[0]!.balance).toBe("25");
  });

  it.each(["COUNT", "PURCHASE"] as const)("rejects a raw %s interleaved between correction preparation and application", async (type) => {
    const { s, prepared, confirmedAt } = await prepareCorrection();
    await expect(fixture.db.transaction(async (tx) => {
      const { canonicalManifest, resultRevisionIds, resultCountMovementIds, ...operation } = prepared.operation;
      await tx.insert(consumptionOperations).values({ ...operation, manifest: canonicalManifest, revisionIds: [...resultRevisionIds], countMovementIds: [...resultCountMovementIds], createdAt: confirmedAt });
      await tx.insert(consumptionRevisions).values(prepared.revisions.map((r) => ({ ...r, confirmedAt })));
      await tx.insert(consumptionRevisionItems).values([...prepared.revisionItems]);
      await tx.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type,
        quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: type === "COUNT" ? "0" : null, occurredAt: confirmedAt });
      await tx.insert(inventoryMovements).values([...prepared.usageMovements]);
      await tx.update(cycleConsumptionContexts).set({ currentRevisionId: resultRevisionIds[0]! }).where(eq(cycleConsumptionContexts.id, prepared.pointerUpdates[0]!.contextId));
    })).rejects.toMatchObject({ cause: { message: "consumption requires current applied ledger tokens" } });
    expect(await fixture.db.select().from(consumptionOperations)).toHaveLength(1);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(prepared.revisions[0]!.previousRevisionId);
  });

  it("rejects raw correction shortage before a later PURCHASE could conceal it", async () => {
    const { s, input, prepared, confirmedAt } = await prepareCorrection();
    const changedInput = { ...input, items: input.items.map((i) => i.inventoryItemId === s.itemIds[0] ? { ...i, usedQuantity: "2201" } : i) };
    const bad = { ...prepared, operation: { ...prepared.operation, canonicalManifest: canonicalizeUseRequest("CORRECT", changedInput) },
      revisionItems: prepared.revisionItems.map((i) => i.inventoryItemId === s.itemIds[0] ? { ...i, usedQuantity: "2201", quantityDelta: "-1" } : i),
      usageMovements: prepared.usageMovements.map((m) => m.inventoryItemId === s.itemIds[0] ? { ...m, quantityDeltaInBaseUnit: "-1" } : m),
    };
    await expect(fixture.db.transaction(async (tx) => {
      await writeConsumptionOperation(tx, OWNER_ID, bad, confirmedAt);
      await tx.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "PURCHASE", quantityDeltaInBaseUnit: "1", occurredAt: confirmedAt });
    })).rejects.toMatchObject({ cause: { message: "consumption cannot make stock negative" } });
    expect(await fixture.db.select().from(consumptionOperations)).toHaveLength(1);
    expect((await readStockLedger(fixture.db, OWNER_ID, [s.itemIds[0]!]))[0]!.balance).toBe("0");
  });

  it("advances a real CORRECT successor, rejects rewind, and keeps original history immutable", async () => {
    const { input, service } = await prepareCorrection();
    const before = await rows(sql`SELECT * FROM consumption_revisions ORDER BY id`);
    const oldItems = await fixture.db.select().from(consumptionRevisionItems);
    const result = await service.correctUse(OWNER_ID, input);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(result.revisionIds[0]);
    await expect(fixture.db.execute(sql`UPDATE cycle_consumption_contexts SET current_revision_id = ${input.expectedRevisionId} WHERE id = ${input.contextId}`))
      .rejects.toMatchObject({ cause: { message: "consumption pointer requires an immediate owned successor" } });
    await expect(fixture.db.execute(sql`UPDATE consumption_revision_items SET used_quantity = 2 WHERE revision_id = ${input.expectedRevisionId}`)).rejects.toThrow();
    expect(await rows(sql`SELECT * FROM consumption_revisions WHERE id = ${input.expectedRevisionId} ORDER BY id`)).toEqual(before);
    expect(await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, input.expectedRevisionId))).toEqual(oldItems);
    // The failed rewind leaves the legitimate successor current.
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(result.revisionIds[0]);
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
