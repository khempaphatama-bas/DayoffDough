import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { prepareConsumptionFixture, seedConsumptionScenario, seedSharedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { recipeIngredients } from "@/modules/products/db/schema";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { ConsumptionStateError } from "../domain/types";
import { createConsumptionCommandService } from "./consumption-commands";
import { createConsumptionActionSupport } from "./action-support";

describe("owned Consumption action support", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { fixture = await createTestDatabase(); });
  afterEach(async () => { await fixture?.close(); });

  it("keeps the owned Cycle target for an explicitly empty-use receipt with no item rows", async () => {
    const s = await seedPlanningScenario(fixture.db);
    await fixture.db.delete(recipeIngredients); await fixture.db.delete(productPackagingRules);
    const preview = await createPlanningQueryService(fixture.db).preview(OWNER_ID, s.cycleId);
    await createPlanningCommandService(fixture.db).lock(OWNER_ID, { cycleId: s.cycleId, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
    await createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId });
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const result = await createConsumptionCommandService(fixture.db).confirmUse(OWNER_ID, input);
    expect(await createConsumptionActionSupport(fixture.db).getCommittedTargets(OWNER_ID, result.operationId)).toEqual({ cycleIds: [s.cycleId], inventoryItemIds: [] });
  });

  it("resolves old immutable receipt targets after correction and terminal transition, hiding other owners", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
    const commands = createConsumptionCommandService(fixture.db);
    const first = await commands.confirmUse(OWNER_ID, input);
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    await commands.correctUse(OWNER_ID, { cycleId: input.cycleId, planningSnapshotId: input.planningSnapshotId, contextId: input.contextId, items: input.items, requestId: randomUUID(), expectedRevisionId: first.revisionIds[0]!, reason: "measured",
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })) });
    await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
    const support = createConsumptionActionSupport(fixture.db);
    expect(await support.getCommittedTargets(OWNER_ID, first.operationId)).toEqual({ cycleIds: [s.cycleId], inventoryItemIds: [...s.itemIds].sort() });
    for (const [owner, id] of [[OTHER_OWNER_ID, first.operationId], [OWNER_ID, randomUUID()]] as const) await expect(support.getCommittedTargets(owner, id)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
  });

  it("resolves every settlement revision/item and linked COUNT from the immutable operation, excluding unrelated pending context", async () => {
    const s = await seedSharedConsumptionScenario(fixture.db);
    const contexts = s.contexts.slice(0, 2).map((context) => ({ cycleId: context.cycleId, planningSnapshotId: context.planningSnapshotId, contextId: context.contextId,
      items: context.items.map((item, index) => ({ ...item, usedQuantity: index === 0 ? "5" : "1", basis: "OWNER_REPORTED" as const, reason: "measured" })), confirmTakenOutOfUse: true as const }));
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    const result = await createConsumptionCommandService(fixture.db).settleUse(OWNER_ID, {
      requestId: randomUUID(), contexts, counts: [{ inventoryItemId: s.itemIds[0]!, remainingQuantity: "7" }], reason: "counted",
      expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })) });
    expect(result.countMovementIds).toHaveLength(1);
    expect(await createConsumptionActionSupport(fixture.db).getCommittedTargets(OWNER_ID, result.operationId)).toEqual({ cycleIds: contexts.map((context) => context.cycleId).sort(), inventoryItemIds: [...s.itemIds].sort() });
  });

  it("maps unknown and cross-owner NOT_FOUND identically without raw domain messages", async () => {
    const support = createConsumptionActionSupport(fixture.db);
    const safe = { error: "ไม่พบข้อมูลการใช้สต๊อก", fieldErrors: {}, stale: false, blockers: [] };
    for (const message of ["Consumption record not found", "SQL password"]) expect(await support.mapError(OWNER_ID, new ConsumptionStateError("NOT_FOUND", message))).toEqual(safe);
    expect(await support.mapError(OWNER_ID, new Error("SQL secret"))).toBeNull();
    expect(await support.mapError(OWNER_ID, new ConsumptionStateError("STALE_DATA", "SQL secret"))).toMatchObject({ stale: true, error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด" });
  });

  it("returns only owned blocker links and shortage item names/quantities", async () => {
    const owned = await seedConsumptionScenario(fixture.db);
    const foreign = await seedConsumptionScenario(fixture.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const support = createConsumptionActionSupport(fixture.db);
    expect(await support.mapError(OWNER_ID, new ConsumptionStateError("PENDING_USE", "SQL secret", {
      blockerCycleIds: [foreign.cycleId, owned.cycleId, randomUUID(), owned.cycleId],
    }))).toMatchObject({ stale: false, blockers: [{ cycleId: owned.cycleId, cycleName: expect.any(String) }] });
    const state = await support.mapError(OWNER_ID, new ConsumptionStateError("INSUFFICIENT_STOCK", "SQL password", {
      shortages: [{ inventoryItemId: owned.itemIds[0]!, availableQuantity: "1", requiredQuantity: "2" }, { inventoryItemId: foreign.itemIds[0]!, availableQuantity: "99", requiredQuantity: "100" }],
    }));
    expect(state).toMatchObject({ fieldErrors: { [`items.${owned.itemIds[0]}.usedQuantity`]: expect.stringMatching(/1.*2/) } });
    expect(JSON.stringify(state)).toContain("แป้งขนมปัง");
    expect(JSON.stringify(state)).not.toMatch(/SQL|password/);
    expect(Object.values((state as { fieldErrors: Record<string, string> }).fieldErrors).join(" ")).not.toMatch(/99|100/);
    expect(await support.mapError(OWNER_ID, new ConsumptionStateError("STOCK_CHECK_REQUIRED", "private"), owned.cycleId)).toMatchObject({ blockers: [{ cycleId: owned.cycleId, cycleName: expect.any(String) }] });
    expect(await support.mapError(OWNER_ID, new ConsumptionStateError("PENDING_USE", "private"), foreign.cycleId)).toMatchObject({ blockers: [] });
  });
});
