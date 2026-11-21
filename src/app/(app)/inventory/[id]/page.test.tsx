import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { InventoryMaintenanceError, type InventoryItemDetail } from "@/modules/inventory/application/inventory";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), detail: vi.fn(), policy: vi.fn(), list: vi.fn(), pending: vi.fn(), notFound: vi.fn(), update: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.owner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/modules/inventory/application/inventory", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/inventory/application/inventory")>(),
  createInventoryService: () => ({ getItemDetail: mocks.detail, getItemEditPolicy: mocks.policy, listItems: mocks.list }),
}));
vi.mock("@/modules/consumption/application/count-barrier", () => ({ findPendingConsumption: mocks.pending }));
vi.mock("@/app/(app)/inventory/actions", () => ({ addInventoryPriceAction: vi.fn(), recordInventoryCountAction: vi.fn(), createInventoryItemAction: vi.fn(), updateInventoryItemAction: mocks.update, archiveInventoryItemAction: mocks.archive }));
import Page from "./page";
import InventoryPage from "../page";
const item: InventoryItemDetail = { id: "10000000-0000-4000-8000-000000000005", ownerId: "10000000-0000-4000-8000-000000000099", name: "แป้ง", category: "INGREDIENT", ingredientKind: "STANDARD", baseUnit: "g", purchaseUnitLabel: "ถุง", baseQuantityPerPurchasePack: "1000", minimumStockQuantity: "0", active: true, notes: null, stockBalance: "3", latestPrice: null, latestUnitCostSatang: null, priceHistory: [] };
beforeEach(() => { vi.resetAllMocks(); mocks.owner.mockResolvedValue({ id: item.ownerId }); mocks.detail.mockResolvedValue(item); mocks.policy.mockResolvedValue({ canChangeIdentity: true, canChangePack: true }); mocks.pending.mockResolvedValue([]); mocks.notFound.mockImplementation(() => { throw new Error("NOT_FOUND"); }); });
it("loads owned pending guidance only after authenticating and resolving the item", async () => {
  const cycleId = "10000000-0000-4000-8000-000000000001";
  mocks.pending.mockResolvedValue([{ cycleId, cycleName: "รอบยกเลิกค้างยอดใช้", contextId: "context", planningSnapshotId: "snapshot" }]);
  const { container } = render(await Page({ params: Promise.resolve({ id: item.id }) }));
  expect(mocks.pending).toHaveBeenCalledWith({}, item.ownerId, [item.id]);
  expect(mocks.detail.mock.invocationCallOrder[0]).toBeLessThan(mocks.pending.mock.invocationCallOrder[0]!);
  expect(within(container).getByRole("link", { name: "รอบยกเลิกค้างยอดใช้" })).toHaveAttribute("href", `/cycles/${cycleId}/consumption`);
  expect(within(container).getByRole("button", { name: "บันทึกยอดนับ" })).toBeDisabled();
  expect(within(container).getByRole("button", { name: "บันทึกราคา" })).toBeEnabled();
});
it("does not query blockers for a missing or unowned item", async () => {
  mocks.detail.mockRejectedValue(new InventoryMaintenanceError("NOT_FOUND"));
  await expect(Page({ params: Promise.resolve({ id: item.id }) })).rejects.toThrow("NOT_FOUND");
  expect(mocks.pending).not.toHaveBeenCalled();
});

it("prefills edit fields and submits the canonical values even when identity and pack are locked", async () => {
  mocks.detail.mockResolvedValue({ ...item, notes: "เก็บให้แห้ง" });
  mocks.policy.mockResolvedValue({ canChangeIdentity: false, canChangePack: false });
  mocks.update.mockResolvedValue({ error: null, saved: true });
  const user = userEvent.setup();
  render(await Page({ params: Promise.resolve({ id: item.id }) }));
  expect(mocks.policy).toHaveBeenCalledWith(item.ownerId, item.id);
  expect(screen.getByLabelText("ชื่อรายการ")).toHaveValue("แป้ง");
  expect(screen.getByLabelText("หมายเหตุ")).toHaveValue("เก็บให้แห้ง");
  expect(screen.getByLabelText("หน่วยฐาน")).toBeDisabled();
  expect(screen.getByLabelText("ประเภท")).toBeDisabled();
  expect(screen.getByLabelText("ชนิดวัตถุดิบ")).toBeDisabled();
  expect(screen.getByLabelText("ชื่อหน่วยซื้อ")).toBeDisabled();
  expect(screen.getByLabelText("ชื่อหน่วยซื้อ")).toHaveValue("ถุง");
  expect(screen.getByLabelText("ปริมาณต่อถุง (g)")).toBeDisabled();
  expect(screen.getByLabelText("ปริมาณต่อถุง (g)")).toHaveValue(1000);
  expect(screen.getByLabelText("สต๊อกขั้นต่ำ")).toBeEnabled();
  expect(screen.getByText(/หากต้องการเปลี่ยนหน่วย.*เพิ่มรายการใหม่/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "บันทึกรายการ" }));
  expect(await screen.findByText("บันทึกรายการแล้ว")).toBeVisible();
  expect(Object.fromEntries(mocks.update.mock.calls[0]![1])).toEqual({
    itemId: item.id, name: "แป้ง", notes: "เก็บให้แห้ง", category: "INGREDIENT", ingredientKind: "STANDARD", baseUnit: "g",
    purchaseUnitLabel: "ถุง", baseQuantityPerPurchasePack: "1000", minimumStockQuantity: "0",
  });
});

it("keeps inactive items and their prices readable but hides mutation controls", async () => {
  const archived = { ...item, active: false, priceHistory: [{ id: "old-price", packPriceSatang: 3050, packBaseQuantity: "1000", effectiveAt: new Date("2026-11-10"), purchasedFrom: "ร้านเดิม", notes: null }] };
  mocks.detail.mockResolvedValue(archived);
  const detail = render(await Page({ params: Promise.resolve({ id: item.id }) }));
  expect(screen.getByRole("heading", { name: "แป้ง" })).toBeVisible();
  expect(screen.getByText("ปิดใช้งาน")).toBeVisible();
  expect(screen.getByText("ร้านเดิม")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "เพิ่มราคาซื้อ" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "นับสต๊อกจริง" })).toBeNull();
  expect(screen.queryByRole("button", { name: "ปิดใช้งาน" })).toBeNull();
  expect(mocks.pending).not.toHaveBeenCalled();
  detail.unmount();
  mocks.list.mockResolvedValue([archived]);
  render(await InventoryPage());
  // Desktop and phone each keep a detail link and the inactive status.
  for (const link of screen.getAllByRole("link", { name: "แป้ง" })) {
    expect(link).toHaveAttribute("href", `/inventory/${item.id}`);
    expect(within(link.closest("article, tr")!).getByText("ปิดใช้งาน")).toBeInTheDocument();
  }
});

it("explains prep-only items without rendering purchase, price, or count controls", async () => {
  mocks.detail.mockResolvedValue({ ...item, name: "น้ำ", ingredientKind: "WATER", baseUnit: "l", purchaseUnitLabel: "ไม่ต้องซื้อ", baseQuantityPerPurchasePack: "1" });
  render(await Page({ params: Promise.resolve({ id: item.id }) }));
  expect(screen.getByRole("heading", { name: "น้ำ" })).toBeVisible();
  expect(screen.getAllByText("ไม่คิดต้นทุนและไม่ต้องนับสต๊อก").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("หน่วยฐาน")).toHaveValue("l");
  expect(screen.queryByLabelText("ชื่อหน่วยซื้อ")).toBeNull();
  expect(screen.queryByRole("heading", { name: "เพิ่มราคาซื้อ" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "นับสต๊อกจริง" })).toBeNull();
  expect(mocks.pending).not.toHaveBeenCalled();
});

it("requires explicit confirmation before archiving and displays the server's next step", async () => {
  const user = userEvent.setup();
  mocks.archive.mockResolvedValue({ error: "ให้เปลี่ยนวัตถุดิบในสูตรก่อนปิดใช้งาน", saved: false });
  render(await Page({ params: Promise.resolve({ id: item.id }) }));
  await user.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
  expect(mocks.archive).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
  expect(screen.queryByRole("button", { name: "ยืนยันปิดใช้งาน" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
  await user.click(screen.getByRole("button", { name: "ยืนยันปิดใช้งาน" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/เปลี่ยนวัตถุดิบในสูตร/);
  expect(mocks.archive.mock.calls[0]![1].get("itemId")).toBe(item.id);
});
