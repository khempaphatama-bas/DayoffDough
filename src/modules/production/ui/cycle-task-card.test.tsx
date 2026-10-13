import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/production/actions", () => ({
  createManualCycleTaskAction: vi.fn(), deleteManualCycleTaskAction: vi.fn(), updateCycleTaskAction: vi.fn(),
}));
import { CYCLE_ID, GENERATION_ID, READY_VIEW, TASK } from "@tests/fixtures/operations";
import { CycleTaskCard } from "./cycle-task-card";

const props = { task: TASK, cycleId: CYCLE_ID, generationId: GENERATION_ID, products: READY_VIEW.products, writable: true };
describe("CycleTaskCard", () => {
  it("keeps quick actions, batch count and generated-task deletion restriction", () => {
    render(<CycleTaskCard {...props} />);
    for (const name of ["ทำเสร็จแล้ว", "ข้ามงาน", "แก้ไขงาน"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByText("ฟอคคาเซีย · 2 แบตช์")).toBeVisible();
    expect(screen.queryByRole("button", { name: "ลบงาน" })).toBeNull();
  });
  it.each(["PENDING", "IN_PROGRESS", "DONE", "SKIPPED"] as const)("only deletes pending manual tasks (%s)", (status) => {
    render(<CycleTaskCard {...props} task={{ ...TASK, origin: "MANUAL", status }} />);
    expect(Boolean(screen.queryByRole("button", { name: "ลบงาน" }))).toBe(status === "PENDING");
  });
  it("opens skip editing with a required reason and retains all available products", async () => {
    render(<CycleTaskCard {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "ข้ามงาน" }));
    expect(screen.getByLabelText("เหตุผลที่ข้าม")).toBeRequired();
    expect(screen.getByLabelText("สถานะ")).toHaveValue("SKIPPED");
    expect(screen.getByRole("option", { name: "บริยอช" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    await userEvent.click(screen.getByRole("button", { name: "แก้ไขงาน" }));
    expect(screen.getByLabelText("ชื่องาน")).toHaveValue("พักแป้ง");
    expect(screen.getByLabelText("จำนวนแบตช์")).toHaveValue(2);
  });
  it("renders skipped history with its reason but no controls", () => {
    render(<CycleTaskCard {...props} writable={false} task={{ ...TASK, status: "SKIPPED", skipReason: "ไม่มีวัตถุดิบ" }} />);
    expect(screen.getByText("เหตุผลที่ข้าม: ไม่มีวัตถุดิบ")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("keeps every quick control phone-sized and visibly focusable", () => {
    render(<CycleTaskCard {...props} task={{ ...TASK, origin: "MANUAL" }} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveClass("min-h-11", "focus-visible:outline-2");
    }
  });
});
