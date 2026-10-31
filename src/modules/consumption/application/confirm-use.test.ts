import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { prepareConsumptionFixture, seedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { cycleConsumptionContexts, consumptionOperations, consumptionRevisions, consumptionRevisionItems } from "../db/schema";
import type { ConfirmUseInput } from "../domain/types";
import { createConsumptionCommandService } from "./consumption-commands";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { recipeIngredients } from "@/modules/products/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";

describe("confirm use", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let intent: ConfirmUseInput;
  let service: ReturnType<typeof createConsumptionCommandService>;
  const confirmedAt = new Date("2026-10-24T12:00:00Z");
  beforeEach(async () => {
    fixture = await createTestDatabase();
    const s = await seedConsumptionScenario(fixture.db, { start: false });
    // Count before production: pending-use barriers must remain active.
    const existing = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    for (const [index, inventoryItemId] of s.itemIds.entries()) {
      const balance = existing.find((row) => row.inventoryItemId === inventoryItemId)!.balance;
      await fixture.db.execute(sql`INSERT INTO inventory_movements (owner_id, inventory_item_id, type, quantity_delta_in_base_unit, counted_quantity_in_base_unit, occurred_at)
        VALUES (${OWNER_ID}, ${inventoryItemId}, 'COUNT', ${index === 0 ? "150" : "12"}::numeric - ${balance}::numeric, ${index === 0 ? "150" : "12"}, now())`);
    }
    await createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const [context] = await fixture.db.select().from(cycleConsumptionContexts);
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    expect(s.itemIds.map((id) => ledger.find((row) => row.inventoryItemId === id)!.balance)).toEqual(["150", "12"]);
    intent = { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, contextId: context!.id,
      requestId: randomUUID(), confirmTakenOutOfUse: true, confirmEmpty: false, reason: null,
      items: s.itemIds.map((inventoryItemId, i) => ({ inventoryItemId, usedQuantity: i === 0 ? "100" : "10", basis: "OWNER_REPORTED", reason: "Measured after production" })),
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
    };
    service = createConsumptionCommandService(fixture.db, { now: () => confirmedAt });
  });
  afterEach(async () => fixture?.close());
  const assertUnwritten = async () => {
    expect(await fixture.db.select().from(consumptionOperations)).toEqual([]);
    expect(await fixture.db.select().from(consumptionRevisions)).toEqual([]);
    expect(await fixture.db.select().from(consumptionRevisionItems)).toEqual([]);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBeNull();
    expect(await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.type, "CONSUMPTION"))).toEqual([]);
  };

  it("deducts confirmed use once and returns its original receipt on retry", async () => {
    const first = await service.confirmUse(OWNER_ID, intent);
    const retry = await service.confirmUse(OWNER_ID, { ...intent, items: [...intent.items].reverse(), expectedLedger: [...intent.expectedLedger].reverse() });
    expect(retry).toEqual({ ...first, replayed: true });
    const balances = await readStockLedger(fixture.db, OWNER_ID, intent.items.map((i) => i.inventoryItemId));
    expect(intent.items.map((i) => balances.find((b) => b.inventoryItemId === i.inventoryItemId)!.balance)).toEqual(["50", "2"]);
    const movements = await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.type, "CONSUMPTION"));
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.occurredAt.getTime() === confirmedAt.getTime())).toBe(true);
    const rows = await fixture.db.select().from(consumptionRevisionItems);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.mode === "DIRECT" && row.initialCountMovementId === intent.expectedLedger.find((e) => e.inventoryItemId === row.inventoryItemId)!.countMovementId)).toBe(true);
    expect(rows.map((r) => r.movementId).sort()).toEqual(movements.map((m) => m.id).sort());
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(first.revisionIds[0]);
    expect((await fixture.db.select().from(bakeCycles))[0]!.status).toBe("IN_PRODUCTION");
  });

  it("canonicalizes database precision and replays before terminal and COUNT gates", async () => {
    const small = { ...intent, items: intent.items.map((i) => ({ ...i, usedQuantity: "1" })) };
    const first = await service.confirmUse(OWNER_ID, small);
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: intent.items[0]!.inventoryItemId, type: "COUNT", quantityDeltaInBaseUnit: "0", countedQuantityInBaseUnit: "149", occurredAt: new Date() });
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, intent.cycleId));
    expect(await service.confirmUse(OWNER_ID, { ...small, items: small.items.map((i) => ({ ...i, usedQuantity: "1.000000" })) })).toEqual({ ...first, replayed: true });
  });

  it.each(["reason", "basis", "source", "token", "quantity"])("rejects reused request with changed %s", async (change) => {
    await service.confirmUse(OWNER_ID, intent);
    const changed = { ...intent,
      ...(change === "reason" ? { reason: "different" } : {}),
      ...(change === "source" ? { contextId: randomUUID() } : {}),
      ...(change === "token" ? { expectedLedger: intent.expectedLedger.map((e) => ({ ...e, ledgerRevision: "999" })) } : {}),
      items: intent.items.map((i) => ({ ...i, ...(change === "basis" ? { basis: "PLANNED" as const } : {}), ...(change === "quantity" ? { usedQuantity: "1" } : {}) })),
    };
    await expect(service.confirmUse(OWNER_ID, changed)).rejects.toMatchObject({ kind: "REQUEST_CONFLICT" });
  });

  it("rolls back every row when one item is insufficient", async () => {
    await expect(service.confirmUse(OWNER_ID, { ...intent, items: intent.items.map((i, n) => ({ ...i, usedQuantity: n === 1 ? "13" : "100" })) })).rejects.toMatchObject({ kind: "INSUFFICIENT_STOCK" });
    await assertUnwritten();
  });

  it.each(["missing", "duplicate", "extra", "foreign", "planned", "noReason", "zero"])("rejects invalid %s usage without writes", async (change) => {
    let items = [...intent.items];
    if (change === "missing") items = items.slice(1);
    if (change === "duplicate") items.push(items[0]!);
    if (change === "extra") items.push({ ...items[0]!, inventoryItemId: randomUUID() });
    if (change === "foreign") {
      const [foreign] = await fixture.db.insert(inventoryItems).values({ ownerId: OTHER_OWNER_ID, name: "Foreign", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000" }).returning();
      items[0] = { ...items[0]!, inventoryItemId: foreign!.id };
    }
    if (change === "planned") items = items.map((i) => ({ ...i, basis: "PLANNED" }));
    if (change === "noReason") items = items.map((i) => ({ ...i, reason: null }));
    if (change === "zero") items = items.map((i) => ({ ...i, usedQuantity: "0", reason: null }));
    await expect(service.confirmUse(OWNER_ID, { ...intent, items })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await assertUnwritten();
  });

  it("requires owner-reported cancellation usage and persists zero audit rows", async () => {
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, intent.cycleId));
    await expect(service.confirmUse(OWNER_ID, { ...intent, items: intent.items.map((i) => ({ ...i, basis: "PLANNED" })) })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    const result = await service.confirmUse(OWNER_ID, { ...intent, items: intent.items.map((i) => ({ ...i, usedQuantity: "0", reason: "Cancelled before use" })) });
    const rows = await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, result.revisionIds[0]!));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.usedQuantity === "0.000000" && row.quantityDelta === "0.000000")).toBe(true);
    expect(await fixture.db.select().from(inventoryMovements).where(eq(inventoryMovements.type, "CONSUMPTION"))).toHaveLength(2);
  });

  it("rejects a stale purchase token", async () => {
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: intent.items[0]!.inventoryItemId, type: "PURCHASE", quantityDeltaInBaseUnit: "2", occurredAt: new Date() });
    await expect(service.confirmUse(OWNER_ID, intent)).rejects.toMatchObject({ kind: "STALE_DATA" });
    await assertUnwritten();
  });

  it.each(["PLANNED", "OWNER_REPORTED"] as const)("accepts unchanged %s quantities without inventing an item reason", async (basis) => {
    const s = await seedConsumptionScenario(fixture.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const { input } = await prepareConsumptionFixture(fixture.db, OTHER_OWNER_ID, s.cycleId);
    const result = await service.confirmUse(OTHER_OWNER_ID, { ...input, items: input.items.map((item) => ({ ...item, basis })) });
    const items = await fixture.db.select().from(consumptionRevisionItems).where(eq(consumptionRevisionItems.revisionId, result.revisionIds[0]!));
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.basis === basis && item.reason === null)).toBe(true);
  });

  it("requires actual basis after cancellation even when quantities match the plan", async () => {
    const s = await seedConsumptionScenario(fixture.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const { input } = await prepareConsumptionFixture(fixture.db, OTHER_OWNER_ID, s.cycleId);
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
    await expect(service.confirmUse(OTHER_OWNER_ID, input)).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await expect(service.confirmUse(OTHER_OWNER_ID, { ...input, items: input.items.map((i) => ({ ...i, basis: "OWNER_REPORTED" })) })).resolves.toMatchObject({ replayed: false });
  });

  it("maps upstream lock contention to a safe stale error without retry writes", async () => {
    await fixture.db.execute(sql`CREATE FUNCTION fail_use_lock() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'private SQL' USING ERRCODE = '55P03'; END; $$ LANGUAGE plpgsql`);
    await fixture.db.execute(sql`CREATE TRIGGER fail_use_lock BEFORE INSERT ON consumption_revisions FOR EACH ROW EXECUTE FUNCTION fail_use_lock()`);
    await expect(service.confirmUse(OWNER_ID, intent)).rejects.toMatchObject({ kind: "STALE_DATA", message: "Stock changed; refresh and try again" });
    await assertUnwritten();
  });

  it("scopes the same request ID independently to another owner", async () => {
    const first = await service.confirmUse(OWNER_ID, intent);
    const s = await seedConsumptionScenario(fixture.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const { input } = await prepareConsumptionFixture(fixture.db, OTHER_OWNER_ID, s.cycleId);
    const second = await service.confirmUse(OTHER_OWNER_ID, { ...input, requestId: intent.requestId });
    expect(second.replayed).toBe(false);
    expect(second.operationId).not.toBe(first.operationId);
    expect(await service.confirmUse(OWNER_ID, intent)).toEqual({ ...first, replayed: true });
  });

  it("returns the same safe not-found for unknown and foreign cycles and request IDs", async () => {
    await service.confirmUse(OWNER_ID, intent);
    for (const input of [intent, { ...intent, cycleId: randomUUID(), requestId: randomUUID() }]) {
      await expect(service.confirmUse(OTHER_OWNER_ID, input)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    }
  });

  it("rolls back receipt, items, movements and pointer after a forced write failure", async () => {
    await fixture.db.execute(sql`CREATE FUNCTION fail_use_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced fixture failure'; END; $$ LANGUAGE plpgsql`);
    await fixture.db.execute(sql`CREATE TRIGGER fail_use_write BEFORE UPDATE ON cycle_consumption_contexts FOR EACH ROW EXECUTE FUNCTION fail_use_write()`);
    await expect(service.confirmUse(OWNER_ID, intent)).rejects.toThrow();
    await assertUnwritten();
  });
});

it("requires explicit empty confirmation and reason, and records an empty revision without movements", async () => {
  const fixture = await createTestDatabase();
  try {
    const s = await seedPlanningScenario(fixture.db);
    await fixture.db.delete(recipeIngredients);
    await fixture.db.delete(productPackagingRules);
    const preview = await createPlanningQueryService(fixture.db).preview(OWNER_ID, s.cycleId);
    await createPlanningCommandService(fixture.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
    await createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const service = createConsumptionCommandService(fixture.db);
    await expect(service.confirmUse(OWNER_ID, { ...input, confirmEmpty: false })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await expect(service.confirmUse(OWNER_ID, { ...input, reason: null })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    const result = await service.confirmUse(OWNER_ID, input);
    expect(result.revisionIds).toHaveLength(1);
    expect((await fixture.db.select().from(cycleConsumptionContexts))[0]!.currentRevisionId).toBe(result.revisionIds[0]);
    expect(await fixture.db.select().from(consumptionRevisionItems)).toEqual([]);
    expect(await fixture.db.select().from(inventoryMovements)).toEqual([]);
    expect(await service.confirmUse(OWNER_ID, input)).toEqual({ ...result, replayed: true });
  } finally { await fixture.close(); }
});
