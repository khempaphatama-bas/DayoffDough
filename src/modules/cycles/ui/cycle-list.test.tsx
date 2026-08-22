import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import type { CycleOrderSummary } from "@/modules/orders/application/orders";
import { CycleList } from "./cycle-list";

const CYCLE: BakeCycle = {
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
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

const SUMMARY: CycleOrderSummary = {
  activeOrderCount: 2,
  cancelledOrderCount: 1,
  grandTotalSatang: 62000,
  amountPaidSatang: 20000,
  balanceSatang: 42000,
  demand: [],
};

describe("CycleList", () => {
  it("renders cycle metadata and a detail destination", () => {
    render(
      <CycleList
        cycles={[CYCLE]}
        query=""
        status="all"
        summaries={new Map([[CYCLE.id, SUMMARY]])}
      />,
    );

    expect(screen.getAllByText("#12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("เปิดรับออเดอร์").length).toBeGreaterThan(0);
    expect(screen.getAllByText("29 ส.ค. 2569").length).toBeGreaterThan(0);
    expect(screen.getAllByText("30 ส.ค. 2569").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 ใช้งาน · 1 ยกเลิก")).toHaveLength(2);
    expect(screen.getAllByText("฿620.00")).toHaveLength(2);
    const detailLinks = screen.getAllByRole("link", { name: CYCLE.name });
    expect(detailLinks).toHaveLength(2);
    for (const link of detailLinks) {
      expect(link).toHaveAttribute("href", `/cycles/${CYCLE.id}`);
      expect(link).toHaveClass("min-h-11", "items-center");
      expect(link.className).toMatch(/(?:^|\s)(?:inline-)?flex(?:\s|$)/);
    }
  });

  it("keeps search/filter controls and renders a deliberate empty state", () => {
    render(
      <CycleList
        cycles={[]}
        query="กันยายน"
        status="COMPLETED"
        summaries={new Map()}
      />,
    );

    expect(screen.getByLabelText("ค้นหารอบอบ")).toHaveValue("กันยายน");
    expect(screen.getByLabelText("สถานะ")).toHaveValue("COMPLETED");
    expect(screen.getByText("ยังไม่พบรอบอบที่ค้นหา")).toBeInTheDocument();
  });
});
