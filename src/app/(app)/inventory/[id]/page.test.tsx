import { render, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { InventoryItemDetail } from "@/modules/inventory/application/inventory";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), detail: vi.fn(), pending: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.owner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/modules/inventory/application/inventory", () => ({ createInventoryService: () => ({ getItemDetail: mocks.detail }) }));
vi.mock("@/modules/consumption/application/count-barrier", () => ({ findPendingConsumption: mocks.pending }));
vi.mock("@/app/(app)/inventory/actions", () => ({ addInventoryPriceAction: vi.fn(), recordInventoryCountAction: vi.fn() }));
import Page from "./page";
const item: InventoryItemDetail = { id: "10000000-0000-4000-8000-000000000005", ownerId: "10000000-0000-4000-8000-000000000099", name: "แป้ง", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "ถุง", baseQuantityPerPurchasePack: "1000", minimumStockQuantity: "0", active: true, notes: null, stockBalance: "3", latestPrice: null, latestUnitCostSatang: null, priceHistory: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockResolvedValue({ id: item.ownerId }); mocks.detail.mockResolvedValue(item); mocks.pending.mockResolvedValue([]); mocks.notFound.mockImplementation(() => { throw new Error("NOT_FOUND"); }); });
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
  mocks.detail.mockRejectedValue(new Error("Inventory item not found"));
  await expect(Page({ params: Promise.resolve({ id: item.id }) })).rejects.toThrow("NOT_FOUND");
  expect(mocks.pending).not.toHaveBeenCalled();
});
