import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { prepareConsumptionFixture, seedConsumptionScenario, seedSharedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { inventoryItems, inventoryMovements, inventoryPrices } from "@/modules/inventory/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cycleInventoryCounts } from "@/modules/shopping/db/schema";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { consumptionOperations, consumptionRevisions, consumptionRevisionItems, cycleConsumptionContexts } from "../db/schema";
import type { SettleUseInput } from "../domain/types";
import { createConsumptionCommandService } from "./consumption-commands";

describe("selective count settlement", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let intent: SettleUseInput;
  let service: ReturnType<typeof createConsumptionCommandService>;
  let flour: string;
  let boxes: string;
  beforeEach(async () => {
    fixture = await createTestDatabase();
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    [flour, boxes] = s.itemIds as [string, string];
    for (const [id, balance] of [[flour, "50"], [boxes, "12"]]) {
      await fixture.db.execute(sql`INSERT INTO inventory_movements (owner_id, inventory_item_id, type, quantity_delta_in_base_unit, counted_quantity_in_base_unit, occurred_at)
        SELECT ${OWNER_ID}, ${id}, 'COUNT', ${balance}::numeric - coalesce(sum(quantity_delta_in_base_unit), 0), ${balance}, now()
        FROM inventory_movements WHERE owner_id = ${OWNER_ID} AND inventory_item_id = ${id}`);
    }
    await createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    intent = { requestId: randomUUID(), contexts: [{ cycleId: input.cycleId, planningSnapshotId: input.planningSnapshotId,
      contextId: input.contextId, confirmTakenOutOfUse: true, items: [flour, boxes].map((inventoryItemId, i) => ({ inventoryItemId,
        usedQuantity: i ? "10" : "100", basis: "OWNER_REPORTED", reason: "Measured actual use" })) }],
      counts: [{ inventoryItemId: flour, remainingQuantity: "25" }], expectedLedger: input.expectedLedger, reason: "Physical count after production" };
    service = createConsumptionCommandService(fixture.db);
  });
  afterEach(async () => fixture?.close());
  async function assertUnwritten() {
    expect(await fixture.db.select().from(consumptionOperations)).toEqual([]);
    expect(await fixture.db.select().from(consumptionRevisions)).toEqual([]);
    expect(await fixture.db.select().from(consumptionRevisionItems)).toEqual([]);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBeNull();
  }

  it("counts only flour and directly deducts uncounted boxes in one operation", async () => {
    const prices = await fixture.db.select().from(inventoryPrices);
    const snapshots = await fixture.db.select().from(cycleInventoryCounts);
    const purchases = await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.type, "PURCHASE"));
    const result = await service.settleUse(OWNER_ID, intent);
    const ledger = await readStockLedger(fixture.db, OWNER_ID, [flour, boxes]);
    expect(Object.fromEntries(ledger.map((l) => [l.inventoryItemId === flour ? "flour" : "boxes", l.balance]))).toEqual({ flour: "25", boxes: "2" });
    const rows = await fixture.db.select().from(consumptionRevisionItems);
    expect(rows.find((r) => r.inventoryItemId === flour)).toMatchObject({ usedQuantity: "100.000000", mode: "COUNT_SETTLED", quantityDelta: "0.000000", initialCountMovementId: intent.expectedLedger.find((l) => l.inventoryItemId === flour)!.countMovementId });
    expect(rows.find((r) => r.inventoryItemId === boxes)).toMatchObject({ usedQuantity: "10.000000", mode: "DIRECT", quantityDelta: "-10.000000", settlementCountMovementId: null });
    expect(result.countMovementIds).toHaveLength(1);
    expect((await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.id, result.countMovementIds[0]!)))[0])
      .toMatchObject({ inventoryItemId: flour, type: "COUNT", quantityDeltaInBaseUnit: "-25.000000", countedQuantityInBaseUnit: "25.000000" });
    expect(await fixture.db.select().from(inventoryPrices)).toEqual(prices);
    expect(await fixture.db.select().from(cycleInventoryCounts)).toEqual(snapshots);
    expect(await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.type, "PURCHASE"))).toEqual(purchases);
  });

  it("preserves first-use fences for correction and replays the full receipt after later events", async () => {
    const first = await service.settleUse(OWNER_ID, intent);
    const context = intent.contexts[0]!;
    const ledger = await readStockLedger(fixture.db, OWNER_ID, [flour, boxes]);
    const corrected = await service.correctUse(OWNER_ID, { cycleId: context.cycleId, planningSnapshotId: context.planningSnapshotId, contextId: context.contextId, requestId: randomUUID(), expectedRevisionId: first.revisionIds[0]!,
      items: context.items.map((i) => ({ ...i, usedQuantity: i.inventoryItemId === flour ? "90" : "9" })),
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })), reason: "Correct actual use" });
    const rows = await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, corrected.revisionIds[0]!));
    expect(rows.find((r) => r.inventoryItemId === flour)).toMatchObject({ mode: "HISTORY_ONLY", quantityDelta: "0.000000" });
    expect(rows.find((r) => r.inventoryItemId === boxes)).toMatchObject({ mode: "DIRECT", quantityDelta: "1.000000" });
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: boxes, type: "COUNT", quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: "3", occurredAt: new Date() });
    const afterCount = await readStockLedger(fixture.db, OWNER_ID, [flour, boxes]);
    const next = await service.correctUse(OWNER_ID, { cycleId: context.cycleId, planningSnapshotId: context.planningSnapshotId,
      contextId: context.contextId, requestId: randomUUID(), expectedRevisionId: corrected.revisionIds[0]!, reason: "After physical count",
      items: context.items.map((i) => ({ ...i, usedQuantity: "8" })),
      expectedLedger: afterCount.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })) });
    expect((await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, next.revisionIds[0]!)))
      .every((i) => i.mode === "HISTORY_ONLY" && i.quantityDelta === "0.000000")).toBe(true);
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, context.cycleId));
    expect(await service.settleUse(OWNER_ID, intent)).toEqual({ ...first, replayed: true });
    await expect(service.settleUse(OWNER_ID, { ...intent, counts: [{ inventoryItemId: boxes, remainingQuantity: "25" }] })).rejects.toMatchObject({ kind: "REQUEST_CONFLICT" });
    await expect(service.settleUse(OWNER_ID, { ...intent, reason: "Changed" })).rejects.toMatchObject({ kind: "REQUEST_CONFLICT" });
  });

  it("rolls back the entire settlement on a DIRECT shortage", async () => {
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: boxes, type: "CORRECTION", quantityDeltaInBaseUnit: "-3", occurredAt: new Date() });
    const expectedLedger = (await readStockLedger(fixture.db, OWNER_ID, [flour, boxes])).map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId }));
    const before = await fixture.db.select().from(inventoryMovements);
    await expect(service.settleUse(OWNER_ID, { ...intent, expectedLedger })).rejects.toMatchObject({ kind: "INSUFFICIENT_STOCK", details: { shortages: [{ inventoryItemId: boxes, availableQuantity: "9", requiredQuantity: "10" }] } });
    await assertUnwritten();
    expect(await fixture.db.select().from(inventoryMovements)).toEqual(before);
  });

  it.each(["empty", "duplicate", "missing remaining", "missing line", "extra line", "stale token", "missing context"])("rejects %s without writes", async (change) => {
    const altered = { ...intent,
      ...(change === "empty" ? { counts: [] } : {}),
      ...(change === "duplicate" ? { counts: [intent.counts[0]!, intent.counts[0]!] } : {}),
      ...(change === "missing remaining" ? { counts: [{ inventoryItemId: flour }] } : {}),
      ...(change === "missing context" ? { contexts: [] } : {}),
      ...(change === "missing line" ? { contexts: [{ ...intent.contexts[0]!, items: intent.contexts[0]!.items.slice(0, 1) }] } : {}),
      ...(change === "extra line" ? { contexts: [{ ...intent.contexts[0]!, items: [...intent.contexts[0]!.items, { ...intent.contexts[0]!.items[0]!, inventoryItemId: randomUUID() }] }] } : {}),
      ...(change === "stale token" ? { expectedLedger: intent.expectedLedger.map((l) => ({ ...l, ledgerRevision: "999" })) } : {}),
    } as SettleUseInput;
    await expect(service.settleUse(OWNER_ID, altered)).rejects.toMatchObject({ kind: ["stale token", "missing context"].includes(change) ? "STALE_DATA" : "INVALID_INPUT" });
    await assertUnwritten();
  });

  it("requires actual-only cancelled usage and hides foreign context or count items", async () => {
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, intent.contexts[0]!.cycleId));
    await expect(service.settleUse(OWNER_ID, { ...intent, contexts: intent.contexts.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, basis: "PLANNED" })) })) })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await expect(service.settleUse(OTHER_OWNER_ID, intent)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    const [foreign] = await fixture.db.insert(inventoryItems).values({ ownerId: OTHER_OWNER_ID, name: "Foreign", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000" }).returning();
    await expect(service.settleUse(OWNER_ID, { ...intent, counts: [{ inventoryItemId: foreign!.id, remainingQuantity: "25" }] })).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    await expect(service.settleUse(OWNER_ID, intent)).resolves.toMatchObject({ replayed: false });
  });

  it("rejects a purchase since preview and maps upstream lock contention safely", async () => {
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: flour, type: "PURCHASE", quantityDeltaInBaseUnit: "1", occurredAt: new Date() });
    await expect(service.settleUse(OWNER_ID, intent)).rejects.toMatchObject({ kind: "STALE_DATA" });
    const expectedLedger = (await readStockLedger(fixture.db, OWNER_ID, [flour, boxes])).map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId }));
    await fixture.db.execute(sql`CREATE FUNCTION fail_settle_lock() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'private SQL' USING ERRCODE = '55P03'; END; $$ LANGUAGE plpgsql`);
    await fixture.db.execute(sql`CREATE TRIGGER fail_settle_lock BEFORE INSERT ON consumption_revisions FOR EACH ROW EXECUTE FUNCTION fail_settle_lock()`);
    await expect(service.settleUse(OWNER_ID, { ...intent, expectedLedger })).rejects.toMatchObject({ kind: "STALE_DATA", message: "Stock changed; refresh and try again" });
    await assertUnwritten();
  });
});

describe("counted-item context closure", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let intent: SettleUseInput;
  let excluded: string;
  let service: ReturnType<typeof createConsumptionCommandService>;
  beforeEach(async () => {
    fixture = await createTestDatabase();
    const s = await seedSharedConsumptionScenario(fixture.db);
    excluded = s.contexts[2]!.contextId;
    expect(s.contexts[2]!.items.map((i) => i.inventoryItemId)).toEqual([s.itemIds[1]]);
    intent = { requestId: randomUUID(), contexts: s.contexts.slice(0, 2).map((c) => ({ cycleId: c.cycleId,
      planningSnapshotId: c.planningSnapshotId, contextId: c.contextId, confirmTakenOutOfUse: true,
      items: c.items.map((i) => ({ ...i, usedQuantity: i.inventoryItemId === s.itemIds[0] ? "100" : "5", basis: "OWNER_REPORTED", reason: "Measured actual use" })) })),
      counts: [{ inventoryItemId: s.itemIds[0]!, remainingQuantity: "25" }], expectedLedger: s.contexts[0]!.expectedLedger, reason: "Shared physical count" };
    service = createConsumptionCommandService(fixture.db);
  });
  afterEach(async () => fixture?.close());

  it("settles both full contexts once without recursively settling the boxes-only context", async () => {
    const result = await service.settleUse(OWNER_ID, intent);
    expect(result.revisionIds).toHaveLength(2);
    expect(result.countMovementIds).toHaveLength(1);
    const contexts = await fixture.db.select().from(cycleConsumptionContexts);
    expect(contexts.find((c) => c.id === excluded)!.currentRevisionId).toBeNull();
    expect(await fixture.db.select().from(consumptionRevisionItems)).toHaveLength(4);
    const ledger = await readStockLedger(fixture.db, OWNER_ID, intent.expectedLedger.map((l) => l.inventoryItemId));
    expect(ledger.map((l) => l.balance)).toEqual(["25", "2"]);
    expect(ledger.map((l) => BigInt(l.ledgerRevision) - BigInt(intent.expectedLedger.find((e) => e.inventoryItemId === l.inventoryItemId)!.ledgerRevision))).toEqual([3n, 2n]);
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: intent.counts[0]!.inventoryItemId,
      type: "COUNT", quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: "25", occurredAt: new Date() });
    const context = intent.contexts[0]!;
    const [revision] = await fixture.db.select().from(consumptionRevisions).where(eq(consumptionRevisions.contextId, context.contextId));
    const current = await readStockLedger(fixture.db, OWNER_ID, intent.expectedLedger.map((l) => l.inventoryItemId));
    await service.correctUse(OWNER_ID, { cycleId: context.cycleId, planningSnapshotId: context.planningSnapshotId, contextId: context.contextId,
      expectedRevisionId: revision!.id, requestId: randomUUID(), reason: "Later correction", items: context.items.map((i) => ({ ...i, usedQuantity: "1" })),
      expectedLedger: current.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })) });
    expect(await service.settleUse(OWNER_ID, { ...intent, contexts: [...intent.contexts].reverse() })).toEqual({ ...result, replayed: true });
  });

  it("includes the third context only when boxes are also selected and writes one COUNT per item", async () => {
    const [row] = await fixture.db.select().from(cycleConsumptionContexts).where(eq(cycleConsumptionContexts.id, excluded));
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, row!.bakeCycleId);
    const result = await service.settleUse(OWNER_ID, { ...intent,
      contexts: [...intent.contexts, { cycleId: input.cycleId, planningSnapshotId: input.planningSnapshotId, contextId: input.contextId, confirmTakenOutOfUse: true, items: input.items }],
      counts: [...intent.counts, { inventoryItemId: intent.expectedLedger[1]!.inventoryItemId, remainingQuantity: "3" }] });
    expect(result.revisionIds).toHaveLength(3);
    expect(result.countMovementIds).toHaveLength(2);
    expect((await fixture.db.select().from(consumptionRevisionItems)).every((i) => i.mode === "COUNT_SETTLED")).toBe(true);
    expect((await readStockLedger(fixture.db, OWNER_ID, intent.expectedLedger.map((l) => l.inventoryItemId))).map((l) => l.balance)).toEqual(["25", "3"]);
  });

  it.each(["missing", "extra", "stale"])("rejects %s context closure atomically", async (change) => {
    let contexts = [...intent.contexts];
    if (change === "missing") contexts = contexts.slice(0, 1);
    if (change === "extra") {
      const [row] = await fixture.db.select().from(cycleConsumptionContexts).where(eq(cycleConsumptionContexts.id, excluded));
      const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, row!.bakeCycleId);
      contexts.push({ cycleId: input.cycleId, planningSnapshotId: input.planningSnapshotId, contextId: input.contextId, confirmTakenOutOfUse: true, items: input.items });
    }
    if (change === "stale") {
      const c = contexts[1]!;
      await service.confirmUse(OWNER_ID, { ...c, items: c.items.map((i) => ({ ...i, usedQuantity: "0", reason: "No use" })),
        requestId: randomUUID(), expectedLedger: intent.expectedLedger, confirmEmpty: false, reason: "No use" });
    }
    const operations = await fixture.db.select().from(consumptionOperations);
    await expect(service.settleUse(OWNER_ID, { ...intent, contexts })).rejects.toMatchObject({ kind: "STALE_DATA" });
    expect(await fixture.db.select().from(consumptionOperations)).toEqual(operations);
  });

  it("preflights the summed DIRECT shortage across contexts", async () => {
    const boxes = intent.expectedLedger[1]!.inventoryItemId;
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: boxes, type: "CORRECTION", quantityDeltaInBaseUnit: "-3", occurredAt: new Date() });
    const expectedLedger = (await readStockLedger(fixture.db, OWNER_ID, intent.expectedLedger.map((e) => e.inventoryItemId))).map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId }));
    await expect(service.settleUse(OWNER_ID, { ...intent, expectedLedger })).rejects.toMatchObject({ kind: "INSUFFICIENT_STOCK",
      details: { shortages: [{ inventoryItemId: boxes, availableQuantity: "9", requiredQuantity: "10" }] } });
    expect(await fixture.db.select().from(consumptionOperations)).toEqual([]);
  });
});
