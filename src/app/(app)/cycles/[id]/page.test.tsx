import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/app/(app)/cycles/actions", () => ({
  changeCycleStatusAction: vi.fn(),
  createCycleAction: vi.fn(),
  updateCycleAction: vi.fn(),
}));

import { CycleDetail } from "./page";

const CYCLE: BakeCycle = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "00000000-0000-4000-8000-000000000001",
  cycleNumber: 12,
  name: "รอบส่ง 30 ส.ค.",
  status: "OPEN",
  orderCutoffAt: new Date("2026-08-27T05:00:00.000Z"),
  targetProductionDate: "2026-08-29",
  primaryDeliveryDate: "2026-08-30",
  notes: "อบช่วงเช้า",
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("CycleDetail", () => {
  it("keeps Phase 2 controls separate and reserves both Task 8 summaries", () => {
    render(<CycleDetail cycle={CYCLE} />);

    expect(screen.getByRole("heading", { name: CYCLE.name })).toBeInTheDocument();
    expect(screen.getByText("รอบ #12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← รอบอบ" })).toHaveClass(
      "inline-flex",
      "min-h-11",
      "items-center",
    );
    expect(screen.getByRole("link", { name: "เพิ่มออเดอร์" })).toHaveAttribute(
      "href",
      `/orders/new?cycleId=${CYCLE.id}`,
    );
    const status = screen.getByLabelText("เปลี่ยนสถานะ");
    expect(status).toHaveValue("OPEN");
    expect(status.querySelector('option[value="LOCKED"]')).toBeNull();
    expect(status.querySelectorAll("option")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "ยอดออเดอร์" })).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีสรุปยอดออเดอร์ในขั้นตอนนี้")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ความต้องการผลิต" })).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีสรุปความต้องการผลิตในขั้นตอนนี้")).toBeInTheDocument();
    expect(screen.getByLabelText("ชื่อรอบอบ")).toHaveValue(CYCLE.name);
  });
});
