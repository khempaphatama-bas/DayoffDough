import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/production/actions", () => ({
  createManualCycleTaskAction: vi.fn(async (_previous: unknown, _data: FormData) => ({ error: null, fieldErrors: {}, values: {}, saved: true })),
  updateCycleTaskAction: vi.fn(async (_previous: unknown, _data: FormData) => ({ error: null, fieldErrors: {}, values: {}, saved: true })),
}));
import { CycleTaskForm } from "./cycle-task-form";

const cycleId = "72000000-0000-4000-8000-000000000001";
const generationId = "72000000-0000-4000-8000-000000000002";

describe("CycleTaskForm", () => {
  it("uses Bangkok local datetime inputs for an existing task", () => {
    render(<CycleTaskForm mode="edit" cycleId={cycleId} taskGenerationId={generationId} task={{
      id: "72000000-0000-4000-8000-000000000003", taskGenerationId: generationId, origin: "TEMPLATE", sourceTemplateName: "หลัก", sourceActivityName: "อบ", title: "อบ", productId: null, productName: null, batchCount: null, scheduledAt: new Date("2026-09-10T17:30:00.000Z"), estimatedDurationMinutes: 45, notes: null, sequence: 1, status: "PENDING", skipReason: null,
    }} products={[]} />);
    expect(screen.getByLabelText("เวลาที่กำหนด")).toHaveValue("2026-09-11T00:30");
  });

  it("shows skip reason only when status is SKIPPED", async () => {
    const user = userEvent.setup();
    render(<CycleTaskForm mode="edit" cycleId={cycleId} taskGenerationId={generationId} task={{
      id: "72000000-0000-4000-8000-000000000003", taskGenerationId: generationId, origin: "TEMPLATE", sourceTemplateName: "หลัก", sourceActivityName: "อบ", title: "อบ", productId: null, productName: null, batchCount: null, scheduledAt: new Date("2026-09-10T17:30:00.000Z"), estimatedDurationMinutes: 45, notes: null, sequence: 1, status: "PENDING", skipReason: null,
    }} products={[]} />);
    expect(screen.queryByLabelText("เหตุผลที่ข้าม")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("สถานะ"), "SKIPPED");
    expect(screen.getByLabelText("เหตุผลที่ข้าม")).toBeVisible();
  });

  it("keeps one manual creation request ID through validation failure and rotates it after success", async () => {
    const user = userEvent.setup();
    const action = vi.fn()
      .mockImplementationOnce(async (_previous: unknown, data: FormData) => ({ error: "กรุณาตรวจสอบข้อมูลงาน", fieldErrors: { title: "ไม่ถูกต้อง" }, values: Object.fromEntries(data.entries()) as Record<string, string>, saved: false }))
      .mockImplementationOnce(async (_previous: unknown, data: FormData) => ({ error: null, fieldErrors: {}, values: Object.fromEntries(data.entries()) as Record<string, string>, saved: true }));
    render(<CycleTaskForm mode="create" cycleId={cycleId} taskGenerationId={generationId} products={[]} action={action} />);
    const requestId = screen.getByTestId("creation-request-id").getAttribute("value");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    await user.type(screen.getByLabelText("ชื่องาน"), "นวดแป้ง");
    await user.type(screen.getByLabelText("ระยะเวลา (นาที)"), "30");
    fireEvent.change(screen.getByLabelText("เวลาที่กำหนด"), { target: { value: "2026-09-11T10:00" } });
    await user.click(screen.getByRole("button", { name: "สร้างงาน" }));
    expect(screen.getByTestId("creation-request-id")).toHaveValue(requestId);
    await user.click(screen.getByRole("button", { name: "สร้างงาน" }));
    await waitFor(() => expect(screen.getByTestId("creation-request-id")).not.toHaveValue(requestId));
  });
});
