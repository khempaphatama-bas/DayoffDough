import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumptionStateError } from "@/modules/consumption/domain/types";
const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), revalidatePath: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(), archiveItem: vi.fn(), addPrice: vi.fn(), recordCount: vi.fn(), mapError: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/modules/inventory/application/inventory", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/inventory/application/inventory")>(),
  createInventoryService: () => mocks,
}));
vi.mock("@/modules/consumption/application/action-support", () => ({ createConsumptionActionSupport: () => mocks }));
import { InventoryMaintenanceError } from "@/modules/inventory/application/inventory";
import * as actions from "./actions";
const { createInventoryItemAction, addInventoryPriceAction, recordInventoryCountAction } = actions;
const OWNER = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";
const INITIAL = { error: null, saved: false };
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function countForm() { return form({ itemId: ITEM, countedQuantity: "2", expectedBaseUnit: "kg" }); }
function priceForm() { return form({ itemId: ITEM, packPriceBaht: "20.50", packBaseQuantity: "2", effectiveDate: "2026-11-19", expectedBaseUnit: "kg" }); }
function itemForm() { return form({ itemId: ITEM, name: "น้ำ", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "l", notes: "เตรียมก่อนผสม" }); }
beforeEach(() => { vi.resetAllMocks(); mocks.requireOwner.mockResolvedValue({ id: OWNER }); });
describe("inventory action Consumption barriers", () => {
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
    expect(mocks.recordCount).toHaveBeenCalledWith(OWNER, ITEM, "2", expect.any(Date), "kg");
    expect(mocks.revalidatePath.mock.calls).toEqual([[`/inventory/${ITEM}`], ["/inventory"]]);
  });
});

it("accepts a water item without stock or purchase pack data", async () => {
  expect(await createInventoryItemAction(INITIAL, itemForm())).toEqual({ error: null, saved: true });
  expect(mocks.createItem).toHaveBeenCalledExactlyOnceWith(OWNER, { name: "น้ำ", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "l", notes: "เตรียมก่อนผสม" });
});

it("requires purchase pack data for a standard item", async () => {
  const input = itemForm();
  input.set("ingredientKind", "STANDARD");
  expect(await createInventoryItemAction(INITIAL, input)).toMatchObject({ saved: false });
  expect(mocks.createItem).not.toHaveBeenCalled();
});

it.each(["updateInventoryItemAction", "archiveInventoryItemAction"] as const)("authenticates %s before calling the service", async (key) => {
  const failure = new Error("NEXT_REDIRECT");
  mocks.requireOwner.mockRejectedValue(failure);
  const action = actions[key];
  expect(action).toBeTypeOf("function");
  await expect(action(INITIAL, itemForm())).rejects.toBe(failure);
  expect(mocks.updateItem).not.toHaveBeenCalled();
  expect(mocks.archiveItem).not.toHaveBeenCalled();
});

it("updates the authenticated owner's item using the selected unit", async () => {
  expect(actions.updateInventoryItemAction).toBeTypeOf("function");
  expect(await actions.updateInventoryItemAction(INITIAL, itemForm())).toEqual({ error: null, saved: true });
  expect(mocks.updateItem).toHaveBeenCalledExactlyOnceWith(OWNER, ITEM, { name: "น้ำ", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "l", notes: "เตรียมก่อนผสม" });
  expect(mocks.revalidatePath.mock.calls).toEqual(expect.arrayContaining([[`/inventory/${ITEM}`], ["/inventory"], ["/dashboard"], ["/products"], ["/delivery"]]));
});

it.each([
  ["ACTIVE_RECIPE", /เปลี่ยน.*สูตร/],
  ["ACTIVE_PLAN", /จบ.*รอบ/],
] as const)("guides the owner past the %s archive blocker", async (code, hint) => {
  mocks.archiveItem.mockRejectedValue(new InventoryMaintenanceError(code));
  expect(actions.archiveInventoryItemAction).toBeTypeOf("function");
  expect(await actions.archiveInventoryItemAction(INITIAL, itemForm())).toEqual({ error: expect.stringMatching(hint), saved: false });
  expect(mocks.archiveItem).toHaveBeenCalledExactlyOnceWith(OWNER, ITEM);
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

it("points a packaging-rule archive blocker to inspection and an available new-item alternative", async () => {
  mocks.archiveItem.mockRejectedValue(new InventoryMaintenanceError("PACKAGING_RULE"));
  const result = await actions.archiveInventoryItemAction(INITIAL, itemForm());
  expect(result).toMatchObject({ error: expect.stringMatching(/ดู.*กฎ.*หน้าการจัดส่ง.*เพิ่ม.*รายการใหม่/), saved: false });
  expect(result.error).not.toMatch(/แก้ไข/);
  expect(mocks.archiveItem).toHaveBeenCalledExactlyOnceWith(OWNER, ITEM);
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

it("returns the same safe message for missing and cross-owner archive requests", async () => {
  const anotherOwner = "00000000-0000-4000-8000-000000000003";
  mocks.archiveItem.mockRejectedValue(new InventoryMaintenanceError("NOT_FOUND"));
  expect(actions.archiveInventoryItemAction).toBeTypeOf("function");
  const missing = await actions.archiveInventoryItemAction(INITIAL, itemForm());
  mocks.requireOwner.mockResolvedValue({ id: anotherOwner });
  const unowned = await actions.archiveInventoryItemAction(INITIAL, itemForm());
  expect(missing).toEqual({ error: expect.stringMatching(/ไม่พบรายการ/), saved: false });
  expect(unowned).toEqual(missing);
  expect(mocks.archiveItem.mock.calls).toEqual([[OWNER, ITEM], [anotherOwner, ITEM]]);
});

it("passes the displayed unit along with the price", async () => {
  expect(await addInventoryPriceAction(INITIAL, priceForm())).toEqual({ error: null, saved: true });
  expect(mocks.addPrice).toHaveBeenCalledExactlyOnceWith(OWNER, ITEM, {
    packPriceSatang: 2050, packBaseQuantity: "2", effectiveAt: new Date("2026-11-18T17:00:00.000Z"),
    purchasedFrom: "", notes: "", expectedBaseUnit: "kg",
  });
});

it.each([
  [addInventoryPriceAction, priceForm, "addPrice"],
  [recordInventoryCountAction, countForm, "recordCount"],
] as const)("rejects a missing unit before the service and gives refresh guidance for a stale unit (%#)", async (action, makeForm, service) => {
  const incomplete = makeForm();
  incomplete.delete("expectedBaseUnit");
  expect(await action(INITIAL, incomplete)).toMatchObject({ saved: false });
  expect(mocks[service]).not.toHaveBeenCalled();
  mocks[service].mockRejectedValue(new InventoryMaintenanceError("ITEM_CHANGED"));
  expect(await action(INITIAL, makeForm())).toEqual({ error: expect.stringMatching(/หน่วย.*โหลด/), saved: false });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
