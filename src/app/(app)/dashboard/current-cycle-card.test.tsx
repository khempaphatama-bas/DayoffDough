import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import type { CycleOrderSummary } from "@/modules/orders/application/orders";
import { CurrentCycleCard, selectNearestOpenCycle } from "./current-cycle-card";

const EARLIER: BakeCycle = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "00000000-0000-4000-8000-000000000001",
  cycleNumber: 12,
  name: "รอบส่ง 30 ส.ค.",
  status: "OPEN",
  orderCutoffAt: null,
  targetProductionDate: "2026-08-29",
  primaryDeliveryDate: "2026-08-30",
  notes: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-20T00:00:00.000Z"),
};

const LATER: BakeCycle = {
  ...EARLIER,
  id: "22222222-2222-4222-8222-222222222222",
  cycleNumber: 13,
  name: "รอบส่ง 6 ก.ย.",
  primaryDeliveryDate: "2026-09-06",
};

const SUMMARY: CycleOrderSummary = {
  activeOrderCount: 2,
  cancelledOrderCount: 1,
  grandTotalSatang: 62000,
  amountPaidSatang: 20000,
  balanceSatang: 42000,
  demand: [
    { productId: "p1", productName: "Focaccia", quantity: 3 },
    { productId: "p2", productName: "Scone", quantity: 1 },
  ],
};

describe("CurrentCycleCard", () => {
  it("selects the nearest OPEN delivery date and shows operating totals", () => {
    expect(selectNearestOpenCycle([LATER, EARLIER])).toEqual(EARLIER);

    render(<CurrentCycleCard cycle={EARLIER} summary={SUMMARY} />);

    expect(screen.getByRole("heading", { name: EARLIER.name })).toBeInTheDocument();
    expect(screen.getByText(/30 สิงหาคม 2569/)).toBeInTheDocument();
    expect(screen.getByText("2 ออเดอร์")).toBeInTheDocument();
    expect(screen.getByText("4 ชิ้น")).toBeInTheDocument();
    expect(screen.getByText("฿620.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เพิ่มออเดอร์" })).toHaveAttribute(
      "href",
      `/orders/new?cycleId=${EARLIER.id}`,
    );
    expect(screen.getByRole("link", { name: "ดูรอบผลิต" })).toHaveAttribute(
      "href",
      `/cycles/${EARLIER.id}`,
    );
  });

  it("links to cycle creation when there is no open cycle", () => {
    render(<CurrentCycleCard cycle={null} summary={null} />);

    expect(screen.getByText("ยังไม่มีรอบผลิตที่เปิดรับออเดอร์")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เปิดรอบผลิต" })).toHaveAttribute(
      "href",
      "/cycles/new",
    );
  });
});
