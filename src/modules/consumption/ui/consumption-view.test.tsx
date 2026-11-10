import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HISTORY_USAGE, LEGACY_USAGE, PENDING_USAGE, RECORDED_USAGE } from "@tests/fixtures/consumption-views";
import { ConsumptionView } from "./consumption-view";

vi.mock("@/app/(app)/cycles/[id]/consumption/actions", () => ({ confirmUseAction: vi.fn(), correctUseAction: vi.fn() }));

describe("ConsumptionView", () => {
  it.each([HISTORY_USAGE, LEGACY_USAGE])("renders $kind read-only without mutation controls", (view) => {
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(<ConsumptionView view={view} />, { container, baseElement: container });
    expect(ui.getByText(/อ่านอย่างเดียว/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
    expect(ui.queryByRole("textbox")).toBeNull();
  });
  it("allows terminal current corrections independently of Operations and keeps generation history accessible", () => {
    const ui = render(<ConsumptionView view={RECORDED_USAGE} />);
    expect(ui.getByRole("button", { name: "บันทึกการแก้ไข" })).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: /ส่งครบ|จบรอบ|เริ่มผลิต|ยกเลิกรอบ/ })).toBeNull();
    expect(ui.getByRole("link", { name: "เปิดยอดใช้รุ่น 1 · ใช้งานอยู่" })).toHaveAttribute("href", `/cycles/${RECORDED_USAGE.cycle.cycleId}/consumption`);
  });
  it("does not render a confirm form without a matching source/context", () => {
    const ui = render(<ConsumptionView view={{ ...PENDING_USAGE, source: null }} />);
    expect(ui.getByText(/ยังไม่พร้อมบันทึก/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
  it("does not render a correction without the pointer-matched current predecessor", () => {
    const ui = render(<ConsumptionView view={{ ...RECORDED_USAGE, context: { ...RECORDED_USAGE.context!, currentRevisionId: null } }} />);
    expect(ui.getByText(/ยังไม่พร้อมบันทึก/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
});
