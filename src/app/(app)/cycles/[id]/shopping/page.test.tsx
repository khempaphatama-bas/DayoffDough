import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CountRequiredView,
  HistoryView,
  NoPlanView,
  ShoppingView,
} from "@/modules/shopping/domain/types";

const mocks = vi.hoisted(() => ({
  confirmCycleStockAction: vi.fn(),
  getCycleStockCheck: vi.fn(),
  notFound: vi.fn(),
  recordCyclePurchaseAction: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/shopping/application/shopping-queries", () => ({
  createShoppingQueryService: () => ({
    getCycleStockCheck: mocks.getCycleStockCheck,
  }),
}));
vi.mock("@/app/(app)/cycles/[id]/shopping/actions", () => ({
  confirmCycleStockAction: mocks.confirmCycleStockAction,
  recordCyclePurchaseAction: mocks.recordCyclePurchaseAction,
}));

import ShoppingPage from "./page";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const COUNT_ID = "44444444-4444-4444-8444-444444444444";

const ACTIVE_GENERATION = {
  id: SNAPSHOT_ID,
  cycleId: CYCLE_ID,
  generation: 3,
  status: "ACTIVE" as const,
  costComplete: true,
  lockedAt: new Date("2026-09-05T02:00:00.000Z"),
  unlockedAt: null,
  unlockReason: null,
  unlockedFromStatus: null,
};

const SUPERSEDED_GENERATION = {
  ...ACTIVE_GENERATION,
  id: "55555555-5555-4555-8555-555555555555",
  generation: 2,
  status: "SUPERSEDED" as const,
  unlockedAt: new Date("2026-09-06T02:00:00.000Z"),
  unlockReason: "เพิ่มออเดอร์",
  unlockedFromStatus: "LOCKED" as const,
};

const ACTIVE_CYCLE = {
  cycleId: CYCLE_ID,
  cycleNumber: 12,
  cycleName: "รอบส่ง 30 ส.ค.",
  cycleStatus: "LOCKED" as const,
  planningSnapshotId: SNAPSHOT_ID,
  generation: 3,
  planningStatus: "ACTIVE" as const,
};

const COUNT_REQUIRED: CountRequiredView = {
  kind: "COUNT_REQUIRED",
  cycle: ACTIVE_CYCLE,
  generations: [ACTIVE_GENERATION, SUPERSEDED_GENERATION],
  items: [
    {
      inventoryItemId: ITEM_ID,
      inventoryItemName: "แป้งขนมปัง",
      inventoryCategory: "INGREDIENT",
      baseUnit: "g",
      priceSnapshotId: "66666666-6666-4666-8666-666666666666",
      unitCostSatang: "0.05",
      requiredQuantity: "2200",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000",
      systemBalance: "800",
    },
  ],
  writable: true,
};

const EMPTY_HISTORY: HistoryView = {
  kind: "HISTORY",
  cycle: {
    ...ACTIVE_CYCLE,
    cycleNumber: 7,
    cycleName: "ชื่อรอบที่คัดลอกตอนล็อก",
    planningSnapshotId: SUPERSEDED_GENERATION.id,
    generation: 2,
    planningStatus: "SUPERSEDED",
  },
  generations: [ACTIVE_GENERATION, SUPERSEDED_GENERATION],
  confirmedAt: null,
  counts: [],
  items: [],
  writable: false,
};

const SHOPPING: ShoppingView = {
  kind: "SHOPPING",
  cycle: ACTIVE_CYCLE,
  generations: [ACTIVE_GENERATION, SUPERSEDED_GENERATION],
  confirmedAt: new Date("2026-09-05T03:00:00.000Z"),
  counts: [
    {
      id: COUNT_ID,
      cycleId: CYCLE_ID,
      planningSnapshotId: SNAPSHOT_ID,
      inventoryItemId: ITEM_ID,
      priceSnapshotId: "66666666-6666-4666-8666-666666666666",
      inventoryItemName: "แป้งขนมปัง",
      inventoryCategory: "INGREDIENT",
      baseUnit: "g",
      requiredQuantity: "2200",
      systemBalanceBeforeCount: "800",
      countedQuantity: "2200",
      countDeltaQuantity: "1400",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000",
      countMovementId: "77777777-7777-4777-8777-777777777777",
      countedAt: new Date("2026-09-05T03:00:00.000Z"),
      confirmationRequestId: "88888888-8888-4888-8888-888888888888",
      createdAt: new Date("2026-09-05T03:00:00.000Z"),
    },
  ],
  items: [],
  writable: true,
};

const NO_PLAN: NoPlanView = {
  kind: "NO_PLAN",
  cycle: {
    ...ACTIVE_CYCLE,
    cycleStatus: "OPEN",
    planningSnapshotId: null,
    generation: null,
    planningStatus: null,
  },
  generations: [SUPERSEDED_GENERATION],
  writable: false,
};

describe("ShoppingPage", () => {
  it("shows_no_count_needed_for_empty_generation", async () => {
    mocks.getCycleStockCheck.mockResolvedValue({ kind: "NO_STOCK_REQUIRED", cycle: ACTIVE_CYCLE,
      generations: [ACTIVE_GENERATION, SUPERSEDED_GENERATION], writable: false });
    render(await ShoppingPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    expect(screen.getByText("รอบนี้ไม่มีรายการที่ต้องนับสต๊อก")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยืนยันสต๊อกและสร้างรายการซื้อ" })).toBeNull();
    expect(screen.getByRole("link", { name: "เปิดรายการซื้อรุ่น 2 · แทนที่แล้ว" })).toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@example.com",
    });
    mocks.getCycleStockCheck.mockResolvedValue(COUNT_REQUIRED);
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("loads the active generation once for the verified owner and renders its stock count", async () => {
    render(
      await ShoppingPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    );

    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.getCycleStockCheck).toHaveBeenCalledOnce();
    expect(mocks.getCycleStockCheck).toHaveBeenCalledWith(
      OWNER_ID,
      CYCLE_ID,
      undefined,
    );
    expect(
      screen.getByRole("heading", { name: "เช็กสต๊อกและรายการซื้อ" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: `← ${ACTIVE_CYCLE.cycleName}` })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}`,
    );
    expect(screen.getByText(`รอบ #${ACTIVE_CYCLE.cycleNumber}`)).toBeInTheDocument();
    expect(screen.getByText("แผนรุ่น 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันสต๊อกและสร้างรายการซื้อ" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", {
        name: "ประวัติรุ่นเช็กสต๊อกและรายการซื้อ",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "เปิดรายการซื้อรุ่น 3 · ใช้งานอยู่" }),
    ).toHaveAttribute("href", `/cycles/${CYCLE_ID}/shopping`);
    expect(
      screen.getByRole("link", { name: "เปิดรายการซื้อรุ่น 2 · แทนที่แล้ว" }),
    ).toHaveAttribute("href", `/cycles/${CYCLE_ID}/shopping?generation=2`);
  });

  it("loads a valid positive historical generation and uses its copied cycle identity", async () => {
    mocks.getCycleStockCheck.mockResolvedValueOnce(EMPTY_HISTORY);

    render(
      await ShoppingPage({
        params: Promise.resolve({ id: CYCLE_ID }),
        searchParams: Promise.resolve({ generation: "2" }),
      }),
    );

    expect(mocks.getCycleStockCheck).toHaveBeenCalledOnce();
    expect(mocks.getCycleStockCheck).toHaveBeenCalledWith(
      OWNER_ID,
      CYCLE_ID,
      2,
    );
    expect(screen.getByRole("link", { name: "← ชื่อรอบที่คัดลอกตอนล็อก" })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}`,
    );
    expect(screen.getByText("รอบ #7")).toBeInTheDocument();
    expect(screen.getByText("แผนรุ่น 2")).toBeInTheDocument();
    expect(screen.getByText("ประวัติ · อ่านอย่างเดียว")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ไม่มีการยืนยันสต๊อกสำหรับรุ่นนี้" })).toBeInTheDocument();
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["array", ["1", "2"]],
    ["unsafe integer", "9007199254740992"],
  ])("rejects an invalid %s generation before the shopping query", async (_label, generation) => {
    await expect(
      ShoppingPage({
        params: Promise.resolve({ id: CYCLE_ID }),
        searchParams: Promise.resolve({ generation }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getCycleStockCheck).not.toHaveBeenCalled();
  });

  it("turns an owner-scoped missing cycle or generation into not found", async () => {
    mocks.getCycleStockCheck.mockRejectedValueOnce(
      new Error("Shopping generation not found"),
    );

    await expect(
      ShoppingPage({
        params: Promise.resolve({ id: CYCLE_ID }),
        searchParams: Promise.resolve({ generation: "2" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getCycleStockCheck).toHaveBeenCalledOnce();
  });

  it("rethrows an unexpected query failure instead of disguising it as not found", async () => {
    mocks.getCycleStockCheck.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      ShoppingPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    ).rejects.toThrow("database unavailable");

    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("renders the shopping state without stock-count controls", async () => {
    mocks.getCycleStockCheck.mockResolvedValueOnce(SHOPPING);

    render(
      await ShoppingPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    );

    expect(screen.getByRole("heading", { name: "สต๊อกเพียงพอสำหรับรอบนี้" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยืนยันสต๊อกและสร้างรายการซื้อ" })).toBeNull();
  });

  it("renders the no-plan state and preserves links to immutable history", async () => {
    mocks.getCycleStockCheck.mockResolvedValueOnce(NO_PLAN);

    render(
      await ShoppingPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    );

    expect(screen.getByText("รอบนี้ไม่มีแผนที่ล็อกไว้")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "เปิดรายการซื้อรุ่น 2 · แทนที่แล้ว" }),
    ).toHaveAttribute("href", `/cycles/${CYCLE_ID}/shopping?generation=2`);
    expect(screen.queryByRole("button", { name: "ยืนยันสต๊อกและสร้างรายการซื้อ" })).toBeNull();
  });

  it("authenticates before any owner-scoped shopping query", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      ShoppingPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    ).rejects.toThrow("Unauthorized");

    expect(mocks.getCycleStockCheck).not.toHaveBeenCalled();
  });
});
