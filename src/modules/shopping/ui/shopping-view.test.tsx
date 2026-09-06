import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CycleInventoryCountView,
  CyclePurchaseEntryView,
  CycleShoppingItemView,
  HistoryView,
  ShoppingView as ShoppingViewData,
} from "@/modules/shopping/domain/types";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/app/(app)/cycles/[id]/shopping/actions", () => ({
  recordCyclePurchaseAction: vi.fn(),
}));

import { ShoppingView } from "./shopping-view";

const GENERATIONS = [
  {
    id: SECOND_SNAPSHOT_ID,
    cycleId: CYCLE_ID,
    generation: 2,
    status: "ACTIVE" as const,
    costComplete: true,
    lockedAt: new Date("2026-09-06T02:00:00.000Z"),
    unlockedAt: null,
    unlockReason: null,
    unlockedFromStatus: null,
  },
  {
    id: SNAPSHOT_ID,
    cycleId: CYCLE_ID,
    generation: 1,
    status: "SUPERSEDED" as const,
    costComplete: true,
    lockedAt: new Date("2026-09-05T02:00:00.000Z"),
    unlockedAt: new Date("2026-09-05T12:00:00.000Z"),
    unlockReason: "เพิ่มออเดอร์ด่วน",
    unlockedFromStatus: "LOCKED" as const,
  },
];

const PURCHASE: CyclePurchaseEntryView = {
  id: "44444444-4444-4444-8444-444444444444",
  cycleId: CYCLE_ID,
  planningSnapshotId: SNAPSHOT_ID,
  shoppingItemId: "55555555-5555-4555-8555-555555555555",
  inventoryItemId: "66666666-6666-4666-8666-666666666666",
  purchaseRequestId: "77777777-7777-4777-8777-777777777777",
  packCount: 1,
  packBaseQuantity: "12",
  purchasedQuantity: "12.000000",
  totalPriceSatang: 0,
  purchasedFrom: "ร้านแพ็กดี",
  occurredAt: new Date("2026-09-05T03:00:00.000Z"),
  notes: "ซื้อเผื่อรอบหน้า",
  inventoryMovementId: "88888888-8888-4888-8888-888888888888",
  inventoryPriceId: "99999999-9999-4999-8999-999999999999",
  createdAt: new Date("2026-09-05T03:00:01.000Z"),
};

function item(
  overrides: Partial<CycleShoppingItemView> &
    Pick<CycleShoppingItemView, "id" | "inventoryItemId" | "inventoryItemName">,
): CycleShoppingItemView {
  const { id, inventoryItemId, inventoryItemName, ...changes } = overrides;
  return {
    id,
    cycleId: CYCLE_ID,
    planningSnapshotId: SECOND_SNAPSHOT_ID,
    inventoryCountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    inventoryItemId,
    inventoryItemName,
    inventoryCategory: "INGREDIENT",
    baseUnit: "g",
    requiredQuantity: "1200.000000",
    countedQuantity: "100.000000",
    purchaseUnitLabel: "ถุง",
    baseQuantityPerPurchasePack: "1000.000000",
    shortfallQuantity: "1100.000000",
    suggestedPackCount: 2,
    suggestedPurchaseQuantity: "2000.000000",
    estimatedCostSatang: 5500,
    createdAt: new Date("2026-09-06T03:00:00.000Z"),
    progress: {
      status: "TO_BUY",
      purchasedQuantity: "0",
      remainingQuantity: "1100",
      overageQuantity: "0",
    },
    purchases: [],
    ...changes,
  };
}

const ITEMS: ReadonlyArray<CycleShoppingItemView> = [
  item({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    inventoryItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    inventoryItemName: "แป้งขนมปัง",
  }),
  item({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    inventoryItemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    inventoryItemName: "น้ำตาล",
    requiredQuantity: "500.000000",
    countedQuantity: "100.000000",
    baseQuantityPerPurchasePack: "500.000000",
    shortfallQuantity: "400.000000",
    suggestedPackCount: 1,
    suggestedPurchaseQuantity: "500.000000",
    estimatedCostSatang: null,
    progress: {
      status: "PARTIAL",
      purchasedQuantity: "100.000000",
      remainingQuantity: "300.000000",
      overageQuantity: "0",
    },
  }),
  item({
    id: PURCHASE.shoppingItemId,
    inventoryItemId: PURCHASE.inventoryItemId,
    inventoryItemName: "กล่องขนม",
    inventoryCategory: "PACKAGING",
    baseUnit: "piece",
    requiredQuantity: "10.000000",
    countedQuantity: "2.000000",
    purchaseUnitLabel: "แพ็ก",
    baseQuantityPerPurchasePack: "12.000000",
    shortfallQuantity: "8.000000",
    suggestedPackCount: 1,
    suggestedPurchaseQuantity: "12.000000",
    estimatedCostSatang: 2500,
    progress: {
      status: "COMPLETE",
      purchasedQuantity: "12.000000",
      remainingQuantity: "0",
      overageQuantity: "4.000000",
    },
    purchases: [PURCHASE],
  }),
];

const COUNT: CycleInventoryCountView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  cycleId: CYCLE_ID,
  planningSnapshotId: SECOND_SNAPSHOT_ID,
  inventoryItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  priceSnapshotId: "12121212-1212-4212-8212-121212121212",
  inventoryItemName: "แป้งขนมปัง",
  inventoryCategory: "INGREDIENT",
  baseUnit: "g",
  requiredQuantity: "1200.000000",
  systemBalanceBeforeCount: "100.000000",
  countedQuantity: "1200.000000",
  countDeltaQuantity: "1100.000000",
  purchaseUnitLabel: "ถุง",
  baseQuantityPerPurchasePack: "1000.000000",
  countMovementId: "13131313-1313-4313-8313-131313131313",
  countedAt: new Date("2026-09-06T02:30:00.000Z"),
  confirmationRequestId: "14141414-1414-4414-8414-141414141414",
  createdAt: new Date("2026-09-06T02:30:01.000Z"),
};

const ACTIVE_VIEW: ShoppingViewData = {
  kind: "SHOPPING",
  cycle: {
    cycleId: CYCLE_ID,
    cycleNumber: 12,
    cycleName: "รอบส่ง 30 ส.ค.",
    cycleStatus: "LOCKED",
    planningSnapshotId: SECOND_SNAPSHOT_ID,
    generation: 2,
    planningStatus: "ACTIVE",
  },
  generations: GENERATIONS,
  confirmedAt: new Date("2026-09-06T02:30:00.000Z"),
  counts: [COUNT],
  items: ITEMS,
  writable: true,
};

describe("ShoppingView", () => {
  it("renders summary, statuses, quantities, estimates, overage, forms, and every purchase entry", () => {
    render(<ShoppingView view={ACTIVE_VIEW} />);

    const summary = screen.getByRole("region", { name: "สรุปรายการซื้อ" });
    expect(summary).toHaveTextContent("รายการต้องซื้อ 3");
    expect(summary).toHaveTextContent("ซื้อครบ 1");
    expect(summary).toHaveTextContent("ยังไม่ครบ 2");
    expect(summary).toHaveTextContent("ยอดประมาณที่ทราบ ฿80.00");

    const flour = screen.getByRole("article", { name: "แป้งขนมปัง" });
    expect(flour).toHaveTextContent("ต้องซื้อ");
    expect(flour).toHaveTextContent("ต้องใช้ 1200 g");
    expect(flour).toHaveTextContent("นับได้ 100 g");
    expect(flour).toHaveTextContent("ขาด 1100 g");
    expect(flour).toHaveTextContent("1 ถุง = 1000 g");
    expect(flour).toHaveTextContent("แนะนำ 2 ถุง · 2000 g");
    expect(flour).toHaveTextContent("ซื้อแล้ว 0 g");
    expect(flour).toHaveTextContent("เหลือ 1100 g");
    expect(flour).toHaveTextContent("ราคาประมาณ ฿55.00");

    const sugar = screen.getByRole("article", { name: "น้ำตาล" });
    expect(sugar).toHaveTextContent("ซื้อบางส่วน");
    expect(sugar).toHaveTextContent("ยังไม่มีราคาประมาณ");
    expect(sugar).not.toHaveTextContent("ราคาประมาณ ฿0.00");

    const box = screen.getByRole("article", { name: "กล่องขนม" });
    expect(box).toHaveTextContent("ซื้อครบ");
    expect(box).toHaveTextContent("ซื้อเกินความต้องการ 4 ชิ้น");
    expect(box).toHaveTextContent("ซื้อ 12 ชิ้น · 1 แพ็ก · ฿0.00");
    expect(box).toHaveTextContent("ร้านแพ็กดี");
    expect(box).toHaveTextContent("ซื้อเผื่อรอบหน้า");
    expect(within(box).getByRole("button", { name: "เพิ่มการซื้ออีกครั้ง" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "บันทึกการซื้อ" })).toHaveLength(2);
  });

  it("shows a success state when every counted item has sufficient stock", () => {
    render(
      <ShoppingView
        view={{ ...ACTIVE_VIEW, items: [], counts: [COUNT] }}
      />,
    );

    expect(screen.getByText("สต๊อกเพียงพอสำหรับรอบนี้")).toBeInTheDocument();
    expect(screen.getByText("รายการต้องซื้อ 0")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ผลการนับสต๊อก" })).toHaveTextContent(
      "แป้งขนมปัง นับได้ 1200 g",
    );
    expect(screen.queryByRole("button", { name: "บันทึกการซื้อ" })).toBeNull();
  });

  it("shows the unconfirmed read-only history state and accessible generation links", () => {
    const history: HistoryView = {
      kind: "HISTORY",
      cycle: {
        cycleId: CYCLE_ID,
        cycleNumber: 12,
        cycleName: "รอบส่ง 30 ส.ค.",
        cycleStatus: "OPEN",
        planningSnapshotId: SNAPSHOT_ID,
        generation: 1,
        planningStatus: "SUPERSEDED",
      },
      generations: GENERATIONS,
      confirmedAt: null,
      counts: [],
      items: [],
      writable: false,
    };

    render(<ShoppingView view={history} />);

    expect(screen.getByText("ประวัติ · อ่านอย่างเดียว")).toBeInTheDocument();
    expect(
      screen.getByText("ไม่มีการยืนยันสต๊อกสำหรับรุ่นนี้"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "เปิดรายการซื้อรุ่น 2 · ใช้งานอยู่" }),
    ).toHaveAttribute("href", `/cycles/${CYCLE_ID}/shopping`);
    const current = screen.getByRole("link", {
      name: "เปิดรายการซื้อรุ่น 1 · แทนที่แล้ว",
    });
    expect(current).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}/shopping?generation=1`,
    );
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("never renders purchase controls for a read-only generation with shopping history", () => {
    const history: HistoryView = {
      ...ACTIVE_VIEW,
      kind: "HISTORY",
      cycle: {
        ...ACTIVE_VIEW.cycle,
        cycleStatus: "OPEN",
        planningSnapshotId: SNAPSHOT_ID,
        generation: 1,
        planningStatus: "SUPERSEDED",
      },
      writable: false,
    };

    render(<ShoppingView view={history} />);

    expect(screen.getAllByText("ประวัติ · อ่านอย่างเดียว").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "บันทึกการซื้อ" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "เพิ่มการซื้ออีกครั้ง" }),
    ).toBeNull();
    expect(screen.getByRole("article", { name: "กล่องขนม" })).toHaveTextContent(
      "ซื้อ 12 ชิ้น · 1 แพ็ก · ฿0.00",
    );
  });
});
