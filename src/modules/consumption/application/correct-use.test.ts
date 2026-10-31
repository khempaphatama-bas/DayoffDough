import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { prepareConsumptionFixture, seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { cycleTasks, cycleTaskGenerations } from "@/modules/production/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { canonicalizeUseRequest } from "../domain/request-manifest";
import { cycleConsumptionContexts, consumptionRevisionItems, consumptionRevisions, consumptionOperations } from "../db/schema";
import { writeConsumptionOperation, type PreparedConsumptionOperation } from "./command-support";
import { createConsumptionCommandService } from "./consumption-commands";
import type { ConfirmUseInput, CorrectUseInput } from "../domain/types";

// This first behavioral RED exercises the existing typed writer and SQL, not a
// missing command import: rejecting legitimate CORRECT lineage is the break.
it("accepts an immediate CORRECT successor with a positive adjustment before COUNT", async () => {
  const fixture = await createTestDatabase();
  try {
    const s = await seedConsumptionScenario(fixture.db);
    const { input, prepared, confirmedAt } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    expect(input.items.map((i) => i.usedQuantity)).toEqual(["2200", "14"]);
    await fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, prepared, confirmedAt));
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    const operationId = randomUUID();
    const revisionId = randomUUID();
    const intent = { cycleId: input.cycleId, planningSnapshotId: input.planningSnapshotId, contextId: input.contextId,
      requestId: randomUUID(), expectedRevisionId: prepared.operation.resultRevisionIds[0]!, reason: "Measured correction",
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
      items: input.items.map((item) => ({ ...item, usedQuantity: "1", basis: "OWNER_REPORTED" as const, reason: "Measured correction" })),
    };
    const revisionItems = prepared.revisionItems.map((row) => ({ ...row, revisionId, usedQuantity: "1", basis: "OWNER_REPORTED" as const,
      reason: "Measured correction", quantityDelta: row.inventoryItemId === s.itemIds[0] ? "2199" : "13", movementId: randomUUID() }));
    const correction: PreparedConsumptionOperation = {
      operation: { id: operationId, ownerId: OWNER_ID, requestId: intent.requestId, kind: "CORRECT", canonicalManifest: canonicalizeUseRequest("CORRECT", intent), resultRevisionIds: [revisionId], resultCountMovementIds: [] },
      revisions: [{ id: revisionId, ownerId: OWNER_ID, contextId: input.contextId, operationId, revisionNumber: 2, previousRevisionId: intent.expectedRevisionId, reason: intent.reason }],
      revisionItems,
      usageMovements: revisionItems.map((row) => ({ id: row.movementId, ownerId: OWNER_ID, inventoryItemId: row.inventoryItemId, type: "CORRECTION", quantityDeltaInBaseUnit: row.quantityDelta,
        referenceType: "CONSUMPTION_REVISION", referenceId: revisionId, occurredAt: confirmedAt, notes: row.reason })),
      countMovements: [], pointerUpdates: [{ contextId: input.contextId, expectedRevisionId: intent.expectedRevisionId, newRevisionId: revisionId }],
    };
    const result = await fixture.db.transaction((tx) => writeConsumptionOperation(tx, OWNER_ID, correction, confirmedAt));
    expect(result.revisionIds).toEqual([revisionId]);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(revisionId);
    expect((await readStockLedger(fixture.db, OWNER_ID, [s.itemIds[0]!]))[0]!.balance).toBe("2199");
    expect(await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, revisionId))).toHaveLength(2);
  } finally { await fixture.close(); }
});

describe("correct use", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let original: ConfirmUseInput;
  let firstRevisionId: string;
  let service: ReturnType<typeof createConsumptionCommandService>;
  const confirmedAt = new Date("2026-10-24T12:00:00Z");
  const ledger = () => readStockLedger(fixture.db, OWNER_ID, original.items.map((i) => i.inventoryItemId));
  const next = async (flour = "90", boxes = "9"): Promise<CorrectUseInput> => ({
    cycleId: original.cycleId, planningSnapshotId: original.planningSnapshotId, contextId: original.contextId,
    requestId: randomUUID(), expectedRevisionId: (await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId!,
    reason: "Corrected measurement", items: original.items.map((i, n) => ({ ...i, usedQuantity: n === 0 ? flour : boxes })),
    expectedLedger: (await ledger()).map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
  });
  const state = async () => ({
    contexts: await fixture.db.select().from(cycleConsumptionContexts),
    operations: await fixture.db.select().from(consumptionOperations),
    revisions: await fixture.db.select().from(consumptionRevisions),
    items: await fixture.db.select().from(consumptionRevisionItems),
    movements: await fixture.db.select().from(inventoryMovements),
    ledger: await ledger(),
  });
  const count = async (quantity: string, occurredAt = confirmedAt) => {
    const [balance] = await ledger();
    await fixture.db.execute(sql`INSERT INTO inventory_movements (owner_id, inventory_item_id, type, quantity_delta_in_base_unit, counted_quantity_in_base_unit, occurred_at)
      VALUES (${OWNER_ID}, ${original.items[0]!.inventoryItemId}, 'COUNT', ${quantity}::numeric - ${balance!.balance}::numeric, ${quantity}, ${occurredAt})`);
  };
  beforeEach(async () => {
    fixture = await createTestDatabase();
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    for (const [index, itemId] of s.itemIds.entries()) {
      const [balance] = await readStockLedger(fixture.db, OWNER_ID, [itemId]);
      const quantity = index === 0 ? "150" : "12";
      await fixture.db.execute(sql`INSERT INTO inventory_movements (owner_id, inventory_item_id, type, quantity_delta_in_base_unit, counted_quantity_in_base_unit, occurred_at)
        VALUES (${OWNER_ID}, ${itemId}, 'COUNT', ${quantity}::numeric - ${balance!.balance}::numeric, ${quantity}, ${confirmedAt})`);
    }
    await createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const prepared = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    original = { ...prepared.input, items: s.itemIds.map((inventoryItemId, n) => ({ inventoryItemId, usedQuantity: n === 0 ? "100" : "10", basis: "OWNER_REPORTED", reason: "Measured" })) };
    service = createConsumptionCommandService(fixture.db, { now: () => confirmedAt });
    firstRevisionId = (await service.confirmUse(OWNER_ID, original)).revisionIds[0]!;
  });
  afterEach(async () => fixture?.close());

  it("returns +10 for 100→90 then -20 for 90→110 without changing Cycle or Ops history", async () => {
    const cycles = await fixture.db.select().from(bakeCycles);
    const ops = async () => ({ tasks: await fixture.db.execute(sql`SELECT * FROM cycle_tasks ORDER BY id`),
      orders: await fixture.db.select().from(orders), packing: await fixture.db.execute(sql`SELECT * FROM order_item_packing_progress ORDER BY id`) });
    const opsBefore = await ops();
    const first = await service.correctUse(OWNER_ID, await next());
    const second = await service.correctUse(OWNER_ID, await next("110", "9"));
    const rows = await fixture.db.select().from(consumptionRevisionItems);
    expect(rows.find((r) => r.revisionId === first.revisionIds[0] && r.inventoryItemId === original.items[0]!.inventoryItemId)).toMatchObject({ usedQuantity: "90.000000", quantityDelta: "10.000000", mode: "DIRECT" });
    expect(rows.find((r) => r.revisionId === second.revisionIds[0] && r.inventoryItemId === original.items[0]!.inventoryItemId)).toMatchObject({ usedQuantity: "110.000000", quantityDelta: "-20.000000", mode: "DIRECT" });
    expect((await ledger()).map((r) => r.balance)).toEqual(["40", "3"]);
    expect(await fixture.db.select().from(bakeCycles)).toEqual(cycles);
    expect(await ops()).toEqual(opsBefore);
  });

  it.each(["same-time", "backdated"])("keeps counted stock at 25 and the initial fence forever after a %s COUNT", async (kind) => {
    const originalRevision = await fixture.db.select().from(consumptionRevisions);
    const originalItems = await fixture.db.select().from(consumptionRevisionItems);
    await count("25", kind === "backdated" ? new Date("2020-01-01") : confirmedAt);
    const result = await service.correctUse(OWNER_ID, await next());
    const rows = await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, result.revisionIds[0]!));
    const flour = rows.find((r) => r.inventoryItemId === original.items[0]!.inventoryItemId)!;
    expect(flour).toMatchObject({ usedQuantity: "90.000000", mode: "HISTORY_ONLY", quantityDelta: "0.000000", initialCountMovementId: original.expectedLedger[0]!.countMovementId });
    expect(rows.find((r) => r.inventoryItemId === original.items[1]!.inventoryItemId)).toMatchObject({ mode: "DIRECT", quantityDelta: "1.000000" });
    await service.correctUse(OWNER_ID, await next("140", "8"));
    expect((await ledger()).map((r) => r.balance)).toEqual(["25", "4"]);
    expect(await fixture.db.select().from(consumptionRevisions).where(eq(consumptionRevisions.id, firstRevisionId))).toEqual(originalRevision);
    expect(await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, firstRevisionId))).toEqual(originalItems);
    const movements = await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.type, "CORRECTION"));
    expect(movements).toHaveLength(4);
    expect(movements.filter((m) => m.inventoryItemId === flour.inventoryItemId).every((m) => m.quantityDeltaInBaseUnit === "0.000000")).toBe(true);
  });

  it("freezes old stock effects even when the only later COUNT has zero delta", async () => {
    const [before] = await ledger();
    expect(before!.balance).toBe("50");
    await count("50");
    const [after] = await ledger();
    expect(after!.countMovementId).not.toBe(before!.countMovementId);
    const result = await service.correctUse(OWNER_ID, await next());
    const [flour] = (await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, result.revisionIds[0]!))).filter((i) => i.inventoryItemId === original.items[0]!.inventoryItemId);
    expect(flour).toMatchObject({ mode: "HISTORY_ONLY", quantityDelta: "0.000000", initialCountMovementId: before!.countMovementId });
    expect((await ledger())[0]!.balance).toBe("50");
  });

  it.each(["COUNT", "PURCHASE"] as const)("rejects a %s after preview before silently changing mode", async (type) => {
    const input = await next();
    if (type === "COUNT") await count("25");
    else await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: original.items[0]!.inventoryItemId, type, quantityDeltaInBaseUnit: "1", occurredAt: confirmedAt });
    const before = await state();
    await expect(service.correctUse(OWNER_ID, input)).rejects.toMatchObject({ kind: "STALE_DATA" });
    expect(await state()).toEqual(before);
  });

  it("rejects shortage and expected predecessor mismatch atomically", async () => {
    const before = await state();
    await expect(service.correctUse(OWNER_ID, await next("151"))).rejects.toMatchObject({ kind: "INSUFFICIENT_STOCK" });
    expect(await state()).toEqual(before);
    await expect(service.correctUse(OWNER_ID, { ...await next(), expectedRevisionId: randomUUID() })).rejects.toMatchObject({ kind: "STALE_DATA" });
    expect(await state()).toEqual(before);
  });

  it("replays original CONFIRM and CORRECT receipts after a further correction and terminal state", async () => {
    const firstReceipt = (await state()).operations[0]!;
    const input = await next();
    const first = await service.correctUse(OWNER_ID, input);
    await service.correctUse(OWNER_ID, await next("110"));
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, original.cycleId));
    const before = await state();
    expect(await service.confirmUse(OWNER_ID, original)).toEqual({ operationId: firstReceipt.id, revisionIds: [firstRevisionId], countMovementIds: [], replayed: true });
    expect(await service.correctUse(OWNER_ID, { ...input, reason: " Corrected measurement ", items: [...input.items].reverse().map((i) => ({ ...i, usedQuantity: `${i.usedQuantity}.000000` })), expectedLedger: [...input.expectedLedger].reverse() })).toEqual({ ...first, replayed: true });
    expect(await state()).toEqual(before);
    await expect(service.correctUse(OWNER_ID, { ...input, reason: "Different" })).rejects.toMatchObject({ kind: "REQUEST_CONFLICT" });
  });

  it.each(["predecessor", "quantity", "token", "source"])("rejects a reused correction key with changed %s before stale gates", async (change) => {
    const input = await next();
    await service.correctUse(OWNER_ID, input);
    const bad = { ...input,
      ...(change === "predecessor" ? { expectedRevisionId: randomUUID() } : {}),
      ...(change === "source" ? { contextId: randomUUID() } : {}),
      ...(change === "token" ? { expectedLedger: input.expectedLedger.map((e) => ({ ...e, ledgerRevision: "999" })) } : {}),
      ...(change === "quantity" ? { items: input.items.map((i) => ({ ...i, usedQuantity: "1" })) } : {}),
    };
    const before = await state();
    await expect(service.correctUse(OWNER_ID, bad)).rejects.toMatchObject({ kind: "REQUEST_CONFLICT" });
    expect(await state()).toEqual(before);
  });

  it.each(["reason", "missing", "duplicate", "extra", "planned", "item reason", "zero", "client mode"])("rejects invalid %s correction without writes", async (attack) => {
    const input = await next();
    let bad: CorrectUseInput = input;
    if (attack === "reason") bad = { ...input, reason: " \t " };
    if (attack === "missing") bad = { ...input, items: input.items.slice(1) };
    if (attack === "duplicate") bad = { ...input, items: [...input.items, input.items[0]!] };
    if (attack === "extra") bad = { ...input, items: [...input.items, { ...input.items[0]!, inventoryItemId: randomUUID() }] };
    if (attack === "planned") bad = { ...input, items: input.items.map((i) => ({ ...i, basis: "PLANNED" })) };
    if (attack === "item reason") bad = { ...input, items: input.items.map((i) => ({ ...i, reason: null })) };
    if (attack === "zero") bad = { ...input, items: input.items.map((i) => ({ ...i, usedQuantity: "0", reason: null })) };
    if (attack === "client mode") bad = { ...input, items: input.items.map((i) => ({ ...i, mode: "HISTORY_ONLY" })) };
    const before = await state();
    await expect(service.correctUse(OWNER_ID, bad)).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    expect(await state()).toEqual(before);
  });

  it.each(["CANCELLED", "COMPLETED"] as const)("allows correcting the current %s context", async (status) => {
    if (status === "COMPLETED") {
      const commands = createOrderOperationsCommandService(fixture.db);
      const activeOrders = (await fixture.db.select().from(orders)).filter((o) => o.fulfillmentStatus !== "CANCELLED");
      const orderIds = activeOrders.map((o) => o.id);
      await commands.startOrders(OWNER_ID, { cycleId: original.cycleId, orderIds });
      for (const orderId of orderIds) {
        const [item] = await fixture.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        await commands.setPackedQuantity(OWNER_ID, { cycleId: original.cycleId, orderItemId: item!.id, packedQuantity: item!.quantity, expectedPackedQuantity: 0 });
        await commands.confirmOrderPacked(OWNER_ID, { cycleId: original.cycleId, orderId });
      }
      await commands.deliverOrders(OWNER_ID, { cycleId: original.cycleId, orderIds });
      await fixture.db.update(cycleTasks).set({ status: "DONE" });
      const [generation] = await fixture.db.select().from(cycleTaskGenerations);
      await createCycleOperationsCommandService(fixture.db).completeCycle(OWNER_ID, { cycleId: original.cycleId, expectedTaskGenerationId: generation!.id, confirmation: true });
    } else await fixture.db.update(bakeCycles).set({ status }).where(eq(bakeCycles.id, original.cycleId));
    await expect(service.correctUse(OWNER_ID, await next())).resolves.toMatchObject({ replayed: false });
  });

  it.each(["PLANNED", "OWNER_REPORTED"] as const)("accepts unchanged planned quantity with %s basis and no extra item reason", async (basis) => {
    await count("3000");
    const input = await next("2200", "14");
    // Flour is frozen; add enough boxes without changing its applied COUNT.
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: original.items[1]!.inventoryItemId, type: "PURCHASE", quantityDeltaInBaseUnit: "20", occurredAt: confirmedAt });
    const refreshed = await next("2200", "14");
    const result = await service.correctUse(OWNER_ID, { ...refreshed, items: input.items.map((i) => ({ ...i, basis, reason: null })) });
    const rows = await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, result.revisionIds[0]!));
    expect(rows.every((i) => i.basis === basis && i.reason === null)).toBe(true);
  });

  it("requires owner-reported cancellation corrections even at exact planned quantities", async () => {
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, original.cycleId));
    const input = await next("2200", "14");
    const before = await state();
    await expect(service.correctUse(OWNER_ID, { ...input, items: input.items.map((i) => ({ ...i, basis: "PLANNED", reason: null })) })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    expect(await state()).toEqual(before);
  });

  it("rejects correcting a superseded zero-use context", async () => {
    const s = await seedConsumptionScenario(fixture.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const { input } = await prepareConsumptionFixture(fixture.db, OTHER_OWNER_ID, s.cycleId);
    const zero = { ...input, items: input.items.map((i) => ({ ...i, usedQuantity: "0", basis: "OWNER_REPORTED" as const, reason: "No use" })) };
    const receipt = await service.confirmUse(OTHER_OWNER_ID, zero);
    const expectedLedger = (await readStockLedger(fixture.db, OTHER_OWNER_ID, s.itemIds)).map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId }));
    await createPlanningCommandService(fixture.db).unlock(OTHER_OWNER_ID, { cycleId: s.cycleId, reason: "Replan zero use", confirmation: "ปลดล็อก" });
    const before = await fixture.db.select().from(consumptionRevisions);
    await expect(service.correctUse(OTHER_OWNER_ID, { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, contextId: zero.contextId,
      requestId: randomUUID(), expectedRevisionId: receipt.revisionIds[0]!, expectedLedger, items: zero.items, reason: "Correction" })).rejects.toMatchObject({ kind: "STALE_DATA" });
    expect(await fixture.db.select().from(consumptionRevisions)).toEqual(before);
  });

  it("uses safe not-found errors and maps lock failure without partial correction", async () => {
    const input = await next();
    for (const bad of [input, { ...input, cycleId: randomUUID() }])
      await expect(service.correctUse(OTHER_OWNER_ID, bad)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    const before = await state();
    await fixture.db.execute(sql`CREATE FUNCTION fail_correction_lock() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'private SQL' USING ERRCODE = '55P03'; END; $$ LANGUAGE plpgsql`);
    await fixture.db.execute(sql`CREATE TRIGGER fail_correction_lock BEFORE INSERT ON consumption_revisions FOR EACH ROW EXECUTE FUNCTION fail_correction_lock()`);
    await expect(service.correctUse(OWNER_ID, input)).rejects.toMatchObject({ kind: "STALE_DATA", message: "Stock changed; refresh and try again" });
    expect(await state()).toEqual(before);
  });

  it("leaves predecessor pointer and all rows unchanged when the final pointer write fails", async () => {
    const before = await state();
    await fixture.db.execute(sql`CREATE FUNCTION fail_correction_pointer() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced pointer failure'; END; $$ LANGUAGE plpgsql`);
    await fixture.db.execute(sql`CREATE TRIGGER fail_correction_pointer BEFORE UPDATE ON cycle_consumption_contexts FOR EACH ROW EXECUTE FUNCTION fail_correction_pointer()`);
    await expect(service.correctUse(OWNER_ID, await next())).rejects.toThrow();
    expect(await state()).toEqual(before);
  });
});
