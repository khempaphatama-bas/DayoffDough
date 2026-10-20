import { render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), cycles: vi.fn(), summaries: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/cycles/application/cycles", () => ({ createCycleService: () => ({ list: mocks.cycles }) }));
vi.mock("@/modules/orders/application/orders", () => ({ createOrderService: () => ({ listCycleSummaries: mocks.summaries }) }));
vi.mock("@/modules/settings/application/settings", () => ({ createSettingsService: () => ({ get: async () => null }) }));
vi.mock("@/modules/inventory/application/inventory", () => ({ createInventoryService: () => ({ listItems: async () => [] }) }));
vi.mock("@/modules/products/application/products", () => ({ createProductService: () => ({ listProducts: async () => [] }) }));
vi.mock("@/modules/delivery/application/delivery", () => ({ createDeliveryService: () => ({ listDeliveryConfiguration: async () => ({ methods: [] }) }) }));
import DashboardPage from "./page";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OPEN: BakeCycle = { id: "00000000-0000-4000-8000-000000000002", ownerId: OWNER_ID, cycleNumber: 1, name: "เปิดรับ", status: "OPEN", orderCutoffAt: null, targetProductionDate: "2026-09-10", primaryDeliveryDate: "2026-09-11", notes: null, lockedAt: null, activePlanningSnapshotId: null, createdAt: new Date(), updatedAt: new Date() };
const LOCKED: BakeCycle = { ...OPEN, id: "00000000-0000-4000-8000-000000000003", status: "LOCKED", name: "ล็อกแล้ว" };
const PRODUCTION: BakeCycle = { ...OPEN, id: "00000000-0000-4000-8000-000000000004", status: "IN_PRODUCTION", name: "กำลังอบ", primaryDeliveryDate: "2026-09-20" };
const SUMMARY = { activeOrderCount: 1, cancelledOrderCount: 0, grandTotalSatang: 50000, amountPaidSatang: 0, balanceSatang: 50000, demand: [] };

describe("DashboardPage operating Cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.requireOwner.mockResolvedValue({ id: OWNER_ID });
    mocks.cycles.mockResolvedValue([OPEN, LOCKED, PRODUCTION]);
    mocks.summaries.mockResolvedValue(new Map([[PRODUCTION.id, SUMMARY], [LOCKED.id, SUMMARY], [OPEN.id, SUMMARY]]));
  });
  it("fetches only the selected owner-scoped Cycle summary and links to its Operations", async () => {
    const { container } = render(await DashboardPage()); const page = within(container);
    expect(mocks.cycles).toHaveBeenCalledWith(OWNER_ID);
    expect(mocks.summaries).toHaveBeenCalledWith(OWNER_ID, [PRODUCTION.id]);
    expect(page.getByRole("heading", { name: "กำลังอบ" })).toBeVisible();
    expect(page.getByRole("link", { name: "เปิด Operations" })).toHaveAttribute("href", `/cycles/${PRODUCTION.id}/operations`);
    expect(page.queryByRole("link", { name: "เพิ่มออเดอร์" })).toBeNull();
  });
  it("does not fetch summary data when no operating Cycle exists", async () => {
    mocks.cycles.mockResolvedValue([{ ...OPEN, status: "COMPLETED" }]);
    const { container } = render(await DashboardPage());
    expect(mocks.summaries).not.toHaveBeenCalled();
    expect(within(container).getByRole("link", { name: "เปิดรอบผลิต" })).toHaveAttribute("href", "/cycles/new");
  });
});
