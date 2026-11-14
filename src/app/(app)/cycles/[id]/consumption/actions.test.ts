import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "@tests/helpers/test-db";
import { seedConsumptionScenario, seedSharedConsumptionScenario, prepareConsumptionFixture } from "@tests/fixtures/consumption";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { ConsumptionStateError } from "@/modules/consumption/domain/types";

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), revalidatePath: vi.fn(),
  confirmUse: vi.fn(), correctUse: vi.fn(), settleUse: vi.fn(),
  getCommittedTargets: vi.fn(), mapError: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/modules/consumption/application/consumption-commands", () => ({ createConsumptionCommandService: () => mocks }));
vi.mock("@/modules/consumption/application/action-support", () => ({ createConsumptionActionSupport: () => mocks }));
import { confirmUseAction, correctUseAction, settleUseAction } from "./actions";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CYCLE = "00000000-0000-4000-8000-000000000002";
const SNAPSHOT = "00000000-0000-4000-8000-000000000003";
const CONTEXT = "00000000-0000-4000-8000-000000000004";
const ITEM = "00000000-0000-4000-8000-000000000005";
const REQUEST = "00000000-0000-4000-8000-000000000006";
const REVISION = "00000000-0000-4000-8000-000000000007";
const OTHER_CYCLE = "00000000-0000-4000-8000-000000000008";
const OTHER_ITEM = "00000000-0000-4000-8000-000000000009";
const RESULT = { operationId: REQUEST, revisionIds: [REVISION], countMovementIds: [], replayed: false };
const INITIAL = { error: null, fieldErrors: {}, saved: false, stale: false, result: null, blockers: [] };
const source = { cycleId: CYCLE, planningSnapshotId: SNAPSHOT, contextId: CONTEXT };
const items = [{ inventoryItemId: ITEM, usedQuantity: "2", basis: "PLANNED", reason: null }];
const expectedLedger = [{ inventoryItemId: ITEM, ledgerRevision: "1", countMovementId: null }];
const confirm = { ...source, requestId: REQUEST, items, expectedLedger, confirmTakenOutOfUse: true, confirmEmpty: false, reason: null };
const correct = { ...source, requestId: REQUEST, items, expectedLedger, expectedRevisionId: REVISION, reason: "measured" };
const settle = { requestId: REQUEST, contexts: [{ ...source, items, confirmTakenOutOfUse: true }], counts: [{ inventoryItemId: ITEM, remainingQuantity: "3" }], expectedLedger, reason: "counted" };
const cases = [["confirmUse", confirmUseAction, confirm], ["correctUse", correctUseAction, correct], ["settleUse", settleUseAction, settle]] as const;
function form(payload: unknown) { const data = new FormData(); data.set("payload", JSON.stringify(payload)); return data; }

describe("owner-only Consumption actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER });
    for (const [name] of cases) mocks[name].mockResolvedValue(RESULT);
    mocks.getCommittedTargets.mockResolvedValue({ cycleIds: [OTHER_CYCLE], inventoryItemIds: [OTHER_ITEM] });
    mocks.mapError.mockResolvedValue({ error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", fieldErrors: {}, stale: true, blockers: [] });
  });

  it.each(cases)("%s authenticates before parsing and leaves rejected auth untouched", async (_name, action) => {
    const failure = new Error("NEXT_REDIRECT"); mocks.requireOwner.mockRejectedValue(failure);
    await expect(action(INITIAL, new FormData())).rejects.toBe(failure);
    for (const [name] of cases) expect(mocks[name]).not.toHaveBeenCalled();
    expect(mocks.getCommittedTargets).not.toHaveBeenCalled(); expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)("%s uses authenticated owner and only committed target IDs, not previous state/browser source", async (name, action, payload) => {
    const result = await action({ ...INITIAL, saved: true, result: { ...RESULT, operationId: CYCLE } }, form(payload));
    expect(result).toEqual({ ...INITIAL, saved: true, result: RESULT });
    expect(mocks[name]).toHaveBeenCalledExactlyOnceWith(OWNER, payload);
    expect(mocks.requireOwner.mock.invocationCallOrder[0]).toBeLessThan(mocks[name].mock.invocationCallOrder[0]!);
    expect(mocks.getCommittedTargets).toHaveBeenCalledExactlyOnceWith(OWNER, RESULT.operationId);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path).sort()).toEqual([
      `/cycles/${OTHER_CYCLE}`, `/cycles/${OTHER_CYCLE}/consumption`, `/cycles/${OTHER_CYCLE}/planning`,
      `/cycles/${OTHER_CYCLE}/shopping`, `/cycles/${OTHER_CYCLE}/operations`, `/inventory/${OTHER_ITEM}`, "/inventory", "/cycles", "/dashboard",
    ].sort());
  });

  it.each(cases)("%s rejects malformed/file/duplicate/unknown/owner fields without service calls", async (_name, action, payload) => {
    const malformed = new FormData(); malformed.set("payload", "{SQL secret");
    const file = new FormData(); file.set("payload", new Blob(["secret"]), "payload.json");
    const duplicate = form(payload); duplicate.append("payload", JSON.stringify(payload));
    for (const data of [new FormData(), malformed, file, duplicate, form(null), form([]), form({ ...payload, ownerId: OWNER }), form({ ...payload, paths: ["/secret"] })]) {
      const state = await action(INITIAL, data);
      expect(state).toMatchObject({ saved: false, stale: false, result: null, error: expect.any(String) });
      expect(Object.keys(state.fieldErrors).length).toBeGreaterThan(0);
      expect(JSON.stringify(state)).not.toMatch(/SQL|secret/);
    }
    for (const [name] of cases) expect(mocks[name]).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves safe nested field errors and rejects duplicated item IDs", async () => {
    for (const payload of [{ ...confirm, items: [items[0], items[0]] }, { ...confirm, items: [{ ...items[0], usedQuantity: "-1" }] }]) {
      const state = await confirmUseAction(INITIAL, form(payload));
      expect(state.saved).toBe(false); expect(Object.keys(state.fieldErrors).some((field) => field.startsWith("items."))).toBe(true);
    }
    expect(mocks.confirmUse).not.toHaveBeenCalled();
  });

  it("revalidates every committed settlement context and uncounted item on replay", async () => {
    mocks.settleUse.mockResolvedValue({ ...RESULT, replayed: true });
    mocks.getCommittedTargets.mockResolvedValue({ cycleIds: [CYCLE, OTHER_CYCLE], inventoryItemIds: [ITEM, OTHER_ITEM] });
    const state = await settleUseAction(INITIAL, form(settle));
    expect(state.result).toEqual({ ...RESULT, replayed: true });
    for (const cycle of [CYCLE, OTHER_CYCLE]) for (const suffix of ["", "/consumption", "/planning", "/shopping", "/operations"]) expect(mocks.revalidatePath).toHaveBeenCalledWith(`/cycles/${cycle}${suffix}`);
    for (const item of [ITEM, OTHER_ITEM]) expect(mocks.revalidatePath).toHaveBeenCalledWith(`/inventory/${item}`);
  });

  it.each(cases)("%s maps safe business failures and never invalidates rolled-back writes", async (name, action, payload) => {
    const failure = new ConsumptionStateError("STALE_DATA", "SQL password"); mocks[name].mockRejectedValue(failure);
    expect(await action(INITIAL, form(payload))).toEqual({ ...INITIAL, error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", stale: true });
    expect(mocks.mapError).toHaveBeenCalledExactlyOnceWith(OWNER, failure);
    expect(mocks.getCommittedTargets).not.toHaveBeenCalled(); expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("hides unexpected errors and logs only safe category/operation identifier", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.confirmUse.mockRejectedValue(new Error("SQL postgres://user:password")); mocks.mapError.mockResolvedValue(null);
      const state = await confirmUseAction(INITIAL, form(confirm));
      expect(state).toMatchObject({ saved: false, result: null, error: expect.any(String) });
      expect(JSON.stringify([state, log.mock.calls])).not.toMatch(/SQL|postgres|password/);
      expect(log).toHaveBeenCalledExactlyOnceWith("consumption_action_failed", { operation: "confirmUse", requestId: REQUEST, category: "unexpected" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  async function realBoundary(db: Awaited<ReturnType<typeof createTestDatabase>>["db"]) {
    const { createConsumptionCommandService } = await vi.importActual<typeof import("@/modules/consumption/application/consumption-commands")>("@/modules/consumption/application/consumption-commands");
    const { createConsumptionActionSupport } = await vi.importActual<typeof import("@/modules/consumption/application/action-support")>("@/modules/consumption/application/action-support");
    const commands = createConsumptionCommandService(db); const support = createConsumptionActionSupport(db);
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID });
    mocks.confirmUse.mockImplementation(commands.confirmUse); mocks.correctUse.mockImplementation(commands.correctUse); mocks.settleUse.mockImplementation(commands.settleUse);
    mocks.mapError.mockImplementation(support.mapError); mocks.getCommittedTargets.mockImplementation(support.getCommittedTargets);
  }

  it("returns exactly the same safe response for real unknown and cross-owner sources", async () => {
    const fixture = await createTestDatabase();
    try {
      const s = await seedConsumptionScenario(fixture.db); const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
      await realBoundary(fixture.db);
      const unknown = await confirmUseAction(INITIAL, form({ ...input, cycleId: randomUUID() }));
      mocks.requireOwner.mockResolvedValue({ id: OTHER_OWNER_ID });
      const foreign = await confirmUseAction(INITIAL, form(input));
      expect(unknown).toEqual({ ...INITIAL, error: "ไม่พบข้อมูลการใช้สต๊อก" }); expect(foreign).toEqual(unknown);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it("records and replays terminal Consumption without enabling old terminal Operations", async () => {
    const fixture = await createTestDatabase();
    try {
      const s = await seedConsumptionScenario(fixture.db); const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
      await fixture.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
      await realBoundary(fixture.db);
      const payload = { ...input, items: input.items.map((item) => ({ ...item, usedQuantity: "1", basis: "OWNER_REPORTED", reason: "measured after cancel" })) };
      const first = await confirmUseAction(INITIAL, form(payload));
      expect(first).toMatchObject({ saved: true, result: { replayed: false, operationId: expect.any(String) } });
      const replay = await confirmUseAction(first, form(payload));
      expect(replay.result).toEqual({ ...first.result, replayed: true });
      expect(mocks.revalidatePath).toHaveBeenCalledWith(`/cycles/${s.cycleId}/consumption`);
      await expect(createCycleOperationsCommandService(fixture.db).startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
    } finally { await fixture.close(); }
  });

  it("propagates real shortage details safely without refreshing rolled-back writes", async () => {
    const fixture = await createTestDatabase();
    try {
      const s = await seedConsumptionScenario(fixture.db); const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, s.cycleId);
      await realBoundary(fixture.db);
      const state = await confirmUseAction(INITIAL, form({ ...input, items: input.items.map((item, index) => ({ ...item, usedQuantity: index === 0 ? "9999" : "1", basis: "OWNER_REPORTED", reason: "measured" })) }));
      expect(state).toMatchObject({ saved: false, stale: false, result: null, error: "สต๊อกไม่เพียงพอ กรุณาตรวจสอบยอดใช้และยอดคงเหลือ" });
      expect(Object.keys(state.fieldErrors)).toEqual([`items.${s.itemIds[0]}.usedQuantity`]);
      expect(mocks.getCommittedTargets).not.toHaveBeenCalled(); expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it("refreshes all real settlement contexts and uncounted items again on exact replay", async () => {
    const fixture = await createTestDatabase();
    try {
      const s = await seedSharedConsumptionScenario(fixture.db); await realBoundary(fixture.db);
      const contexts = s.contexts.slice(0, 2).map(({ cycleId, planningSnapshotId, contextId, items }) => ({ cycleId, planningSnapshotId, contextId,
        items: items.map((item, index) => ({ ...item, usedQuantity: index === 0 ? "5" : "1", basis: "OWNER_REPORTED", reason: "measured" })), confirmTakenOutOfUse: true }));
      const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
      const payload = { requestId: randomUUID(), contexts, counts: [{ inventoryItemId: s.itemIds[0], remainingQuantity: "7" }], reason: "counted",
        expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })) };
      const first = await settleUseAction(INITIAL, form(payload)); expect(first.saved).toBe(true);
      mocks.revalidatePath.mockClear();
      const replay = await settleUseAction(first, form(payload)); expect(replay.result).toEqual({ ...first.result, replayed: true });
      for (const context of contexts) for (const suffix of ["", "/consumption", "/planning", "/shopping", "/operations"]) expect(mocks.revalidatePath).toHaveBeenCalledWith(`/cycles/${context.cycleId}${suffix}`);
      for (const item of s.itemIds) expect(mocks.revalidatePath).toHaveBeenCalledWith(`/inventory/${item}`);
      expect(mocks.revalidatePath).not.toHaveBeenCalledWith(`/cycles/${s.contexts[2]!.cycleId}/consumption`);
      for (const path of ["/inventory", "/cycles", "/dashboard"]) expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    } finally { await fixture.close(); }
  });
});
