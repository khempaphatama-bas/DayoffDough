import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { prepareConsumptionFixture, seedConsumptionScenario, seedSharedConsumptionScenario } from "@tests/fixtures/consumption";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { recipeIngredients } from "@/modules/products/db/schema";
import { createConsumptionCommandService } from "./consumption-commands";
import { createConsumptionQueryService } from "./consumption-queries";

describe("consumption read models", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createConsumptionQueryService>;
  const queries: string[] = [];
  beforeEach(async () => {
    fixture = await createTestDatabase({ logger: { logQuery: (query) => queries.push(query.toLowerCase()) } });
    service = createConsumptionQueryService(fixture.db);
    queries.length = 0;
  });
  afterEach(async () => fixture?.close());

  async function record(cycleId: string, quantity = "0") {
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, cycleId);
    const request = { ...input, reason: "Measured after production", items: input.items.map((item) => ({ ...item,
      usedQuantity: item.inventoryItemId === input.items[0]!.inventoryItemId ? quantity : "0",
      basis: "OWNER_REPORTED" as const, reason: "Measured quantity" })) };
    const result = await createConsumptionCommandService(fixture.db).confirmUse(OWNER_ID, request);
    return { request, result };
  }

  it("returns NO_PLAN without inventing actionable source or stock", async () => {
    const s = await seedPlanningScenario(fixture.db, { cycleStatus: "DRAFT" });
    expect(await service.getCycleConsumption(OWNER_ID, s.cycleId)).toMatchObject({ kind: "NO_PLAN",
      source: null, context: null, currentRevision: null, history: [], requirements: [], items: [], stock: [], expectedLedger: [], canConfirm: false, canCorrect: false });
  });

  it("exposes NOT_STARTED immutable estimates including unpriced deactivated owned items", async () => {
    const s = await seedLockedPlanningScenario(fixture.db, { includeIngredientPrice: false });
    await fixture.db.update(inventoryItems).set({ active: false, name: "Changed master", baseUnit: "kg" }).where(eq(inventoryItems.id, s.ingredientItemId));
    const view = await service.getCycleConsumption(OWNER_ID, s.cycleId);
    expect(view).toMatchObject({ kind: "NOT_STARTED", context: null, canConfirm: false, canCorrect: false });
    expect(view.requirements).toHaveLength(2);
    expect(view.requirements[0]).toMatchObject({ inventoryItemId: s.ingredientItemId, inventoryItemName: "แป้งขนมปัง", baseUnit: "g", plannedQuantity: "2200" });
    expect(view.requirements[0]).not.toHaveProperty("unitCostSatang");
  });

  it("defaults pending use to explicitly PLANNED estimates and reads balances and fence tokens", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const view = await service.getCycleConsumption(OWNER_ID, s.cycleId);
    expect(view).toMatchObject({ kind: "PENDING_USE", canConfirm: true, canCorrect: false, currentRevision: null, history: [],
      source: { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId }, context: { taskGenerationId: s.taskGenerationId } });
    expect(view.items.map((item) => ({ usedQuantity: item.usedQuantity, basis: item.basis, quantityDelta: item.quantityDelta, mode: item.mode })))
      .toEqual([{ usedQuantity: "2200", basis: "PLANNED", quantityDelta: "-2200", mode: "DIRECT" }, { usedQuantity: "14", basis: "PLANNED", quantityDelta: "-14", mode: "DIRECT" }]);
    expect(view.stock.map((row) => row.balance)).toEqual(["2200", "14"]);
    expect(view.expectedLedger).toEqual(view.stock.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })));
  });

  it("keeps every cancelled pending actual empty in both cycle and settlement defaults", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
    const cycle = await service.getCycleConsumption(OWNER_ID, s.cycleId);
    expect(cycle).toMatchObject({ kind: "PENDING_USE", canConfirm: true, canCorrect: false });
    expect(cycle.items.map((item) => [item.usedQuantity, item.basis, item.quantityDelta])).toEqual([[null, "OWNER_REPORTED", null], [null, "OWNER_REPORTED", null]]);
    const settlement = await service.getSettlementPreview(OWNER_ID, [s.itemIds[0]!]);
    expect(settlement.contexts[0]!.items.map((item) => [item.usedQuantity, item.basis, item.mode, item.quantityDelta]))
      .toEqual([[null, "OWNER_REPORTED", "COUNT_SETTLED", "0"], [null, "OWNER_REPORTED", "DIRECT", null]]);
  });

  it("preserves old and current revision effects and copied identities in a terminal RECORDED context", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const first = await record(s.cycleId, "100");
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    const second = await createConsumptionCommandService(fixture.db).correctUse(OWNER_ID, {
      cycleId: first.request.cycleId, planningSnapshotId: first.request.planningSnapshotId, contextId: first.request.contextId,
      requestId: randomUUID(), expectedRevisionId: first.result.revisionIds[0]!, reason: "Remeasured 90",
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
      items: first.request.items.map((item, index) => ({ ...item, usedQuantity: index === 0 ? "90" : "0", reason: "Remeasured" })) });
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.itemIds[0]!, type: "COUNT", quantityDeltaInBaseUnit: "-2105", countedQuantityInBaseUnit: "5", occurredAt: new Date() });
    await fixture.db.update(inventoryItems).set({ active: false, name: "Renamed", baseUnit: "kg" }).where(eq(inventoryItems.id, s.itemIds[0]!));
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED", name: "Renamed cycle" }).where(eq(bakeCycles.id, s.cycleId));
    queries.length = 0;
    const view = await service.getCycleConsumption(OWNER_ID, s.cycleId);
    expect(view).toMatchObject({ kind: "RECORDED", canConfirm: false, canCorrect: true });
    expect(view.cycle.cycleName).not.toBe("Renamed cycle");
    expect(view.currentRevision?.id).toBe(second.revisionIds[0]);
    expect(view.history).toHaveLength(2);
    expect(view.history[0]).toMatchObject({ id: first.result.revisionIds[0], reason: "Measured after production", confirmedAt: expect.any(Date) });
    expect(view.history[0]!.items[0]).toMatchObject({ inventoryItemName: "แป้งขนมปัง", baseUnit: "g", usedQuantity: "100", basis: "OWNER_REPORTED", reason: "Measured quantity", mode: "DIRECT", quantityDelta: "-100" });
    expect(view.history[1]!.items[0]).toMatchObject({ usedQuantity: "90", mode: "DIRECT", quantityDelta: "10", reason: "Remeasured" });
    expect(view.items[0]).toMatchObject({ usedQuantity: "90", mode: "HISTORY_ONLY", quantityDelta: "0" });
    expect(view.stock[0]!.balance).toBe("5");
    expect(queries.filter((query) => query.includes('from "consumption_revisions"'))).toHaveLength(1);
    expect(queries.filter((query) => query.includes('from "consumption_revision_items"'))).toHaveLength(1);
    expect(queries.filter((query) => query.includes('from "inventory_ledger_states"'))).toHaveLength(1);
    expect(queries[0]).toBe("set transaction isolation level repeatable read read only");
    expect(queries.every((query) => !/\b(insert|update|delete|for update|for share)\b/.test(query))).toBe(true);
  });

  it("keeps a superseded zero-only generation read-only with original values after a new generation locks", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const first = await record(s.cycleId);
    await createPlanningCommandService(fixture.db).unlock(OWNER_ID, { cycleId: s.cycleId, reason: "Replan", confirmation: "ปลดล็อก" });
    const preview = await createPlanningQueryService(fixture.db).preview(OWNER_ID, s.cycleId);
    await createPlanningCommandService(fixture.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
    await fixture.db.update(inventoryItems).set({ name: "Latest master" }).where(eq(inventoryItems.id, s.itemIds[0]!));
    const view = await service.getCycleConsumption(OWNER_ID, s.cycleId, 1);
    expect(view).toMatchObject({ kind: "HISTORY", canConfirm: false, canCorrect: false, source: { planningSnapshotId: s.planningSnapshotId } });
    expect(view.generations.map((generation) => generation.generation)).toEqual([2, 1]);
    expect(view.history[0]!.id).toBe(first.result.revisionIds[0]);
    expect(view.history[0]!.items[0]).toMatchObject({ inventoryItemName: "แป้งขนมปัง", usedQuantity: "0", quantityDelta: "0" });
    expect((await service.getCycleConsumption(OWNER_ID, s.cycleId)).kind).toBe("NOT_STARTED");
  });

  it("returns the exact safe not-found for malformed, absent, foreign and invalid selected generations", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    for (const [ownerId, cycleId, generation] of [[OTHER_OWNER_ID, s.cycleId, 1], [OWNER_ID, randomUUID(), 1], [OWNER_ID, "bad", 1],
      ["bad", s.cycleId, 1], ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2].map((g) => [OWNER_ID, s.cycleId, g])] as const) {
      await expect(service.getCycleConsumption(ownerId as string, cycleId as string, generation as number))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found", details: {} });
    }
  });

  it("shows empty pending and recorded contexts without fabricating ledger rows", async () => {
    const s = await seedPlanningScenario(fixture.db);
    await fixture.db.delete(recipeIngredients);
    await fixture.db.delete(productPackagingRules);
    const preview = await createPlanningQueryService(fixture.db).preview(OWNER_ID, s.cycleId);
    await createPlanningCommandService(fixture.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
    await createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    expect(await service.getCycleConsumption(OWNER_ID, s.cycleId)).toMatchObject({ kind: "PENDING_USE", context: { currentRevisionId: null }, items: [], canConfirm: true, stock: [] });
    await record(s.cycleId);
    expect(await service.getCycleConsumption(OWNER_ID, s.cycleId)).toMatchObject({ kind: "RECORDED", history: [{ items: [] }], canCorrect: true });
  });

  it("returns only counted-item closure with full contexts and one batched union ledger snapshot", async () => {
    const s = await seedSharedConsumptionScenario(fixture.db, "12", { secondCycleId: "00000000-0000-4000-8000-000000000009" });
    await seedConsumptionScenario(fixture.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    queries.length = 0;
    const view = await service.getSettlementPreview(OWNER_ID, [s.itemIds[0]!]);
    expect(view.countedItemIds).toEqual([s.itemIds[0]]);
    expect(view.contexts.map((context) => context.source.contextId).sort()).toEqual(s.contexts.slice(0, 2).map((context) => context.contextId).sort());
    expect(view.contexts.every((context) => context.items.length === 2)).toBe(true);
    // Query order is Cycle UUID order, not fixture insertion order. Deliberately
    // put the second source first and verify both associations by context ID.
    expect(view.contexts.map((context) => context.source.cycleId)).toEqual([
      "00000000-0000-4000-8000-000000000009", "10000000-0000-4000-8000-000000000009",
    ]);
    const original = view.contexts.find((context) => context.source.contextId === s.contexts[0]!.contextId);
    const second = view.contexts.find((context) => context.source.contextId === s.contexts[1]!.contextId);
    expect(original?.source).toEqual({ cycleId: "10000000-0000-4000-8000-000000000009", planningSnapshotId: s.contexts[0]!.planningSnapshotId, contextId: s.contexts[0]!.contextId });
    expect(second?.source).toEqual({ cycleId: "00000000-0000-4000-8000-000000000009", planningSnapshotId: s.contexts[1]!.planningSnapshotId, contextId: s.contexts[1]!.contextId });
    expect(original?.items.map((item) => [item.inventoryItemId, item.usedQuantity, item.mode, item.quantityDelta])).toEqual([
      [s.itemIds[0], "2200", "COUNT_SETTLED", "0"], [s.itemIds[1], "14", "DIRECT", "-14"],
    ]);
    expect(second?.items.map((item) => [item.inventoryItemId, item.usedQuantity, item.mode, item.quantityDelta])).toEqual([
      [s.itemIds[0], "1100", "COUNT_SETTLED", "0"], [s.itemIds[1], "7", "DIRECT", "-7"],
    ]);
    expect(view.counts).toEqual([{ inventoryItemId: s.itemIds[0], inventoryItemName: "แป้งขนมปัง", baseUnit: "g", remainingQuantity: null, mode: "COUNT", quantityDelta: null }]);
    expect(view.expectedLedger.map((item) => item.inventoryItemId)).toEqual(s.itemIds);
    expect(view.stock.map((item) => item.balance)).toEqual(["50", "12"]);
    expect(queries.filter((query) => query.includes('from "inventory_ledger_states"'))).toHaveLength(1);
    // Membership is read once by closure discovery and once for full copied lines, never once per context.
    expect(queries.filter((query) => query.includes('from "cycle_consumption_items"'))).toHaveLength(1);
    expect(queries.some((query) => query.includes('from "cycle_material_requirements"'))).toBe(false);
    expect(queries.some((query) => query.includes('from "cycle_packaging_requirements"'))).toBe(false);
    // PGlite logs SET TRANSACTION but not its driver's BEGIN/COMMIT calls.
    expect(queries[0]).toBe("set transaction isolation level repeatable read read only");
    expect(queries.every((query) => !/\b(insert|update|delete|for update|for share)\b/.test(query))).toBe(true);
  });

  it("returns tokens for selected owned stock without pending contexts and rejects foreign IDs safely", async () => {
    const s = await seedLockedPlanningScenario(fixture.db);
    const view = await service.getSettlementPreview(OWNER_ID, [s.ingredientItemId, s.packagingItemId].reverse());
    expect(view.contexts).toEqual([]);
    expect(view.expectedLedger.map((token) => token.inventoryItemId)).toEqual([s.ingredientItemId, s.packagingItemId]);
    for (const ids of [[randomUUID()], ["bad"], [s.ingredientItemId, s.ingredientItemId]]) {
      await expect(service.getSettlementPreview(OTHER_OWNER_ID, ids)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    }
    await expect(service.getSettlementPreview(OWNER_ID, [])).rejects.toMatchObject({ kind: "INVALID_INPUT" });
  });

  it("includes counted-only owned stock alongside the full pending context union", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const countedOnlyId = "40000000-0000-4000-8000-000000000001";
    await fixture.db.insert(inventoryItems).values({ id: countedOnlyId, ownerId: OWNER_ID, name: "Counted only", active: false, category: "INGREDIENT", baseUnit: "kg", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1" });
    await fixture.db.update(inventoryItems).set({ name: "Renamed master", baseUnit: "kg" }).where(eq(inventoryItems.id, s.itemIds[0]!));
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: countedOnlyId, type: "PURCHASE", quantityDeltaInBaseUnit: "9.25", occurredAt: new Date() });
    const view = await service.getSettlementPreview(OWNER_ID, [countedOnlyId, s.itemIds[0]!]);
    expect(view.countedItemIds).toEqual([s.itemIds[0], countedOnlyId]);
    expect(view.contexts).toHaveLength(1);
    expect(view.contexts[0]!.source).toMatchObject({ cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId });
    expect(view.contexts[0]!.items.map(item => [item.inventoryItemId, item.usedQuantity, item.mode])).toEqual([[s.itemIds[0], "2200", "COUNT_SETTLED"], [s.itemIds[1], "14", "DIRECT"]]);
    expect(view.counts).toEqual([{ inventoryItemId: s.itemIds[0], inventoryItemName: "Renamed master", baseUnit: "kg", remainingQuantity: null, mode: "COUNT", quantityDelta: null }, { inventoryItemId: countedOnlyId, inventoryItemName: "Counted only", baseUnit: "kg", remainingQuantity: null, mode: "COUNT", quantityDelta: null }]);
    expect(view.contexts[0]!.items[0]).toMatchObject({ inventoryItemName: "แป้งขนมปัง", baseUnit: "g" });
    expect(view.stock.map(row => row.inventoryItemId)).toEqual([...s.itemIds, countedOnlyId]);
    expect(view.expectedLedger.map(row => row.inventoryItemId)).toEqual([...s.itemIds, countedOnlyId]);
    expect(view.stock[2]).toEqual({ inventoryItemId: countedOnlyId, balance: "9.25", ledgerRevision: "1", countMovementId: null });
    expect(view.expectedLedger[2]).toEqual({ inventoryItemId: countedOnlyId, ledgerRevision: "1", countMovementId: null });
  });

  it("projects mixed settlement history without changing recorded modes after later counts", async () => {
    const s = await seedSharedConsumptionScenario(fixture.db);
    const stock = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    const result = await createConsumptionCommandService(fixture.db).settleUse(OWNER_ID, {
      requestId: randomUUID(), reason: "Physical flour count after use",
      contexts: s.contexts.slice(0, 2).map((context) => ({ cycleId: context.cycleId, planningSnapshotId: context.planningSnapshotId,
        contextId: context.contextId, confirmTakenOutOfUse: true,
        items: context.items.map((item) => ({ ...item, usedQuantity: "1", basis: "OWNER_REPORTED", reason: "Measured" })) })),
      counts: [{ inventoryItemId: s.itemIds[0]!, remainingQuantity: "8" }],
      expectedLedger: stock.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
    });
    const view = await service.getCycleConsumption(OWNER_ID, s.contexts[0]!.cycleId);
    expect(view.currentRevision?.id).toBe(result.revisionIds.find((id) => view.history.some((revision) => revision.id === id)));
    expect(view.currentRevision!.items.map((item) => [item.mode, item.quantityDelta, item.usedQuantity]))
      .toEqual([["COUNT_SETTLED", "0", "1"], ["DIRECT", "-1", "1"]]);
    expect(view.items.map((item) => [item.mode, item.quantityDelta])).toEqual([["HISTORY_ONLY", "0"], ["DIRECT", "0"]]);
    expect(view.currentRevision!.items[0]!.settlementCountMovementId).toBe(result.countMovementIds[0]);
    expect(view.stock.map((item) => item.balance)).toEqual(["8", "10"]);
    expect((await service.getSettlementPreview(OWNER_ID, [s.itemIds[0]!])).contexts).toEqual([]);
  });

  it("preserves signed and large historical SUM strings without input quantity bounds", async () => {
    const s = await seedLockedPlanningScenario(fixture.db);
    for (const quantityDeltaInBaseUnit of ["999999999999.999999", "999999999999.999999"]) {
      await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.ingredientItemId, type: "PURCHASE", quantityDeltaInBaseUnit, occurredAt: new Date() });
    }
    await fixture.db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId: s.packagingItemId, type: "CORRECTION", quantityDeltaInBaseUnit: "-3.123456", occurredAt: new Date() });
    expect((await service.getCycleConsumption(OWNER_ID, s.cycleId)).stock.map((item) => item.balance)).toEqual(["1999999999999.999998", "-3.123456"]);
    expect((await service.getSettlementPreview(OWNER_ID, [s.packagingItemId])).stock[0]!.balance).toBe("-3.123456");
  });

  it("keeps LEGACY cycles nonactionable without fabricating history", async () => {
    await fixture.close();
    const cycleId = randomUUID();
    fixture = await createTestDatabase({ beforeConsumptionCutover: async (db) => {
      await db.execute(sql`INSERT INTO bake_cycles (id, owner_id, name, status, target_production_date, primary_delivery_date)
        VALUES (${cycleId}, ${OWNER_ID}, 'Legacy', 'DRAFT', '2026-10-24', '2026-10-25')`);
    } });
    service = createConsumptionQueryService(fixture.db);
    expect(await service.getCycleConsumption(OWNER_ID, cycleId)).toMatchObject({ kind: "LEGACY", canConfirm: false, canCorrect: false, context: null, history: [] });
    await expect(service.getCycleConsumption(OWNER_ID, cycleId, 1)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
  });
});
