import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/production/actions", () => ({
  createManualCycleTaskAction: vi.fn(async (_previous: unknown, _data: FormData) => ({ error: null, fieldErrors: {}, values: {}, saved: true })),
  updateCycleTaskAction: vi.fn(async (_previous: unknown, _data: FormData) => ({ error: null, fieldErrors: {}, values: {}, saved: true })),
}));
import { bangkokLocalToIso, CycleTaskForm, formatBangkokDateTime } from "./cycle-task-form";

const cycleId = "72000000-0000-4000-8000-000000000001";
const generationId = "72000000-0000-4000-8000-000000000002";

describe("CycleTaskForm", () => {
  it.each(["2026-02-30T10:00", "2026-01-01T24:00", "2026-01-01T10:60", "2026-13-01T10:00"])("rejects impossible Bangkok wall-clock value %s instead of normalizing it", (value) => {
    expect(bangkokLocalToIso(value)).toBeNull();
  });

  it("converts accepted years 0001 through 0099 without JavaScript year remapping", () => {
    expect(bangkokLocalToIso("0001-01-01T10:00")).toBe("0001-01-01T03:00:00.000Z");
    expect(bangkokLocalToIso("0099-12-31T23:59")).toBe("0099-12-31T16:59:00.000Z");
  });

  it("formats accepted historical years with a deterministic Bangkok wall-clock round trip", () => {
    expect(formatBangkokDateTime(new Date("0001-01-01T03:00:00.000Z"))).toBe("0001-01-01T10:00");
    expect(formatBangkokDateTime(new Date("0099-12-31T16:59:00.000Z"))).toBe("0099-12-31T23:59");
  });

  it("retains a historical datetime-local value in the edit form", () => {
    render(<CycleTaskForm mode="edit" cycleId={cycleId} taskGenerationId={generationId} products={[]} task={{ id: "72000000-0000-4000-8000-000000000003", taskGenerationId: generationId, origin: "TEMPLATE", sourceTemplateName: "หลัก", sourceActivityName: "อบ", title: "อบ", productId: null, productName: null, batchCount: null, scheduledAt: new Date("0001-01-01T03:00:00.000Z"), estimatedDurationMinutes: 45, notes: null, sequence: 1, status: "PENDING", skipReason: null }} />);
    expect(screen.getByLabelText("เวลาที่กำหนด")).toHaveValue("0001-01-01T10:00");
  });

  it("retains an invalid submitted schedule after dispatch as an error instead of throwing while rendering", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({ error: "invalid", fieldErrors: { scheduledAt: "invalid" }, values: { scheduledAt: "not-a-date" }, saved: false }));
    render(<CycleTaskForm mode="edit" cycleId={cycleId} taskGenerationId={generationId} products={[]} action={action} task={{ id: "72000000-0000-4000-8000-000000000003", taskGenerationId: generationId, origin: "TEMPLATE", sourceTemplateName: "หลัก", sourceActivityName: "อบ", title: "อบ", productId: null, productName: null, batchCount: null, scheduledAt: new Date("2026-09-10T17:30:00.000Z"), estimatedDurationMinutes: 45, notes: null, sequence: 1, status: "PENDING", skipReason: null }} />);
    await user.click(screen.getByRole("button", { name: "บันทึกงาน" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid");
  });

  it("renders product, batch, duration, and sequence errors next to their fields", async () => {
    const action = vi.fn(async () => ({ error: "invalid", fieldErrors: { productId: "product error", batchCount: "batch error", estimatedDurationMinutes: "duration error", sequence: "sequence error" }, values: {}, saved: false }));
    const user = userEvent.setup();
    render(<CycleTaskForm mode="edit" cycleId={cycleId} taskGenerationId={generationId} products={[]} task={{ id: "72000000-0000-4000-8000-000000000003", taskGenerationId: generationId, origin: "TEMPLATE", sourceTemplateName: "หลัก", sourceActivityName: "อบ", title: "อบ", productId: null, productName: null, batchCount: null, scheduledAt: new Date("2026-09-10T17:30:00.000Z"), estimatedDurationMinutes: 45, notes: null, sequence: 1, status: "PENDING", skipReason: null }} action={action} />);
    await user.click(screen.getByRole("button", { name: "บันทึกงาน" }));
    expect(await screen.findByText("product error")).toBeVisible();
    expect(screen.getByText("batch error")).toBeVisible();
    expect(screen.getByText("duration error")).toBeVisible();
    expect(screen.getByText("sequence error")).toBeVisible();
  });

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

  it.each([
    { mode: "create" as const, saveLabel: "สร้างงาน" },
    { mode: "edit" as const, saveLabel: "บันทึกงาน" },
  ])("keeps $mode save and cancel actions above the mobile navigation", ({ mode, saveLabel }) => {
    const task = mode === "edit" ? {
      id: "72000000-0000-4000-8000-000000000003",
      taskGenerationId: generationId,
      origin: "TEMPLATE" as const,
      sourceTemplateName: "หลัก",
      sourceActivityName: "อบ",
      title: "อบ",
      productId: null,
      productName: null,
      batchCount: null,
      scheduledAt: new Date("2026-09-10T17:30:00.000Z"),
      estimatedDurationMinutes: 45,
      notes: null,
      sequence: 1,
      status: "PENDING" as const,
      skipReason: null,
    } : undefined;

    render(<CycleTaskForm mode={mode} cycleId={cycleId} taskGenerationId={generationId} products={[]} {...(task ? { task } : {})} onCancel={vi.fn()} />);

    const action = screen.getByTestId("cycle-task-action");
    expect(action.closest("form")).toHaveClass("pb-24", "md:pb-5");
    expect(action).toHaveClass(
      "sticky",
      "bottom-20",
      "z-20",
      "border-t",
      "bg-stone-50/95",
      "backdrop-blur",
      "md:static",
      "md:border-0",
      "md:bg-transparent",
      "md:p-0",
    );
    expect(within(action).getByRole("button", { name: saveLabel })).toBeEnabled();
    expect(within(action).getByRole("button", { name: "ยกเลิก" })).toBeEnabled();
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
    expect(await screen.findByText("กรุณาตรวจสอบข้อมูลงาน")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "สร้างงาน" })).toBeEnabled());
    expect(screen.getByTestId("creation-request-id")).toHaveValue(requestId);
    await user.click(screen.getByRole("button", { name: "สร้างงาน" }));
    await waitFor(() => expect(screen.getByTestId("creation-request-id")).not.toHaveValue(requestId));
  });

  it("uses a fresh request ID for every successful manual intent after a validation failure", async () => {
    const user = userEvent.setup();
    const requestIds: string[] = [];
    const action = vi.fn().mockImplementation(async (_previous: unknown, data: FormData) => {
      requestIds.push(String(data.get("creationRequestId")));
      const saved = requestIds.length > 1;
      return { error: saved ? null : "กรุณาตรวจสอบข้อมูลงาน", fieldErrors: saved ? {} : { title: "ไม่ถูกต้อง" }, values: Object.fromEntries(data.entries()) as Record<string, string>, saved };
    });
    render(<CycleTaskForm mode="create" cycleId={cycleId} taskGenerationId={generationId} products={[]} action={action} />);
    await user.type(screen.getByLabelText("ชื่องาน"), "งานแรก");
    await user.type(screen.getByLabelText("ระยะเวลา (นาที)"), "30");
    fireEvent.change(screen.getByLabelText("เวลาที่กำหนด"), { target: { value: "2026-09-11T10:00" } });
    await user.click(screen.getByRole("button", { name: "สร้างงาน" }));
    expect(await screen.findByText("กรุณาตรวจสอบข้อมูลงาน")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "สร้างงาน" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "สร้างงาน" }));
    await waitFor(() => expect(requestIds).toHaveLength(2));
    const secondRequestId = requestIds[1];
    expect(secondRequestId).toBe(requestIds[0]);
    await user.clear(screen.getByLabelText("ชื่องาน"));
    await user.type(screen.getByLabelText("ชื่องาน"), "งานสอง");
    await user.click(screen.getByRole("button", { name: "สร้างงาน" }));
    await waitFor(() => expect(requestIds).toHaveLength(3));
    expect(requestIds[2]).not.toBe(secondRequestId);
    expect(new Set(requestIds).size).toBe(2);
  });
});
