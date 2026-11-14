import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumptionStateError } from "@/modules/consumption/domain/types";
const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), revalidatePath: vi.fn(), createItem: vi.fn(), addPrice: vi.fn(), recordCount: vi.fn(), mapError: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/modules/inventory/application/inventory", () => ({ createInventoryService: () => mocks }));
vi.mock("@/modules/consumption/application/action-support", () => ({ createConsumptionActionSupport: () => mocks }));
import { createInventoryItemAction, addInventoryPriceAction, recordInventoryCountAction } from "./actions";
const OWNER = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";
const INITIAL = { error: null, saved: false };
function countForm() { const data = new FormData(); data.set("itemId", ITEM); data.set("countedQuantity", "2"); return data; }
describe("inventory action Consumption barriers", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.requireOwner.mockResolvedValue({ id: OWNER }); });
  it.each([createInventoryItemAction, addInventoryPriceAction, recordInventoryCountAction])("authenticates before reading payload or calling any service", async (action) => {
    const failure = new Error("NEXT_REDIRECT"); mocks.requireOwner.mockRejectedValue(failure);
    await expect(action(INITIAL, new FormData())).rejects.toBe(failure);
    for (const name of ["createItem", "addPrice", "recordCount", "mapError", "revalidatePath"] as const) expect(mocks[name]).not.toHaveBeenCalled();
  });
  it("returns actionable owned pending links without revalidation", async () => {
    const failure = new ConsumptionStateError("PENDING_USE", "SQL secret", { blockerCycleIds: [OWNER] });
    mocks.recordCount.mockRejectedValue(failure);
    mocks.mapError.mockResolvedValue({ error: "กรุณาบันทึกยอดใช้ก่อนนับสต๊อก", fieldErrors: {}, stale: false, blockers: [{ cycleId: OWNER, cycleName: "รอบเก่า" }] });
    expect(await recordInventoryCountAction(INITIAL, countForm())).toEqual({ error: "กรุณาบันทึกยอดใช้ก่อนนับสต๊อก", saved: false, blockers: [{ cycleId: OWNER, cycleName: "รอบเก่า" }] });
    expect(mocks.mapError).toHaveBeenCalledExactlyOnceWith(OWNER, failure); expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("maps lock-contention to safe refresh guidance without leaking SQL", async () => {
    mocks.recordCount.mockRejectedValue(new ConsumptionStateError("STALE_DATA", "SQL password"));
    mocks.mapError.mockResolvedValue({ error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", fieldErrors: {}, stale: true, blockers: [] });
    expect(await recordInventoryCountAction(INITIAL, countForm())).toMatchObject({ error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", saved: false });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("preserves ordinary COUNT success invalidations", async () => {
    expect(await recordInventoryCountAction(INITIAL, countForm())).toEqual({ error: null, saved: true });
    expect(mocks.recordCount).toHaveBeenCalledWith(OWNER, ITEM, "2", expect.any(Date));
    expect(mocks.revalidatePath.mock.calls).toEqual([[`/inventory/${ITEM}`], ["/inventory"]]);
  });
});
