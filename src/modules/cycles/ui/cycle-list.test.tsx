import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
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

describe("CycleList", () => {
  it("renders cycle metadata and a detail destination", () => {
    render(<CycleList cycles={[CYCLE]} query="" status="all" />);

    expect(screen.getAllByText("#12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("เปิดรับออเดอร์").length).toBeGreaterThan(0);
    expect(screen.getAllByText("29 ส.ค. 2569").length).toBeGreaterThan(0);
    expect(screen.getAllByText("30 ส.ค. 2569").length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole("link", { name: CYCLE.name })) {
      expect(link).toHaveAttribute("href", `/cycles/${CYCLE.id}`);
    }
  });

  it("keeps search/filter controls and renders a deliberate empty state", () => {
    render(<CycleList cycles={[]} query="กันยายน" status="COMPLETED" />);

    expect(screen.getByLabelText("ค้นหารอบอบ")).toHaveValue("กันยายน");
    expect(screen.getByLabelText("สถานะ")).toHaveValue("COMPLETED");
    expect(screen.getByText("ยังไม่พบรอบอบที่ค้นหา")).toBeInTheDocument();
  });
});
