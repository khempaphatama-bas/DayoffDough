import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/production/actions", () => ({ createManualCycleTaskAction: vi.fn(), deleteManualCycleTaskAction: vi.fn(), updateCycleTaskAction: vi.fn() }));
import { NO_GENERATION_VIEW, READY_VIEW, TASK } from "@tests/fixtures/operations";
import { OperationsTaskTimeline } from "./operations-task-timeline";

describe("OperationsTaskTimeline", () => {
  it("shows overdue and today in provided order while future work starts collapsed", async () => {
    const overdue = { ...TASK, id: "overdue", title: "งานค้าง", scheduledAt: new Date("2026-09-10T02:00:00Z") };
    const future = { ...TASK, id: "future", title: "งานอนาคต", scheduledAt: new Date("2026-09-12T02:00:00Z") };
    render(<OperationsTaskTimeline view={{ ...READY_VIEW, tasks: [overdue, TASK, future], taskBuckets: { overdue: [overdue], today: [TASK], future: [future] } }} />);
    expect(screen.getByRole("heading", { name: "เลยกำหนด" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "วันนี้" })).toBeVisible();
    expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(["งานค้าง · ฟอคคาเซีย", "พักแป้ง · ฟอคคาเซีย", "งานอนาคต · ฟอคคาเซีย"]);
    expect(screen.getByRole("article", { name: "งานค้าง · ฟอคคาเซีย" })).toBeVisible();
    expect(screen.getByRole("article", { name: "พักแป้ง · ฟอคคาเซีย" })).toBeVisible();
    expect(screen.getByRole("article", { name: "งานอนาคต · ฟอคคาเซีย" })).not.toBeVisible();
    expect(screen.getByText("10 กันยายน 2569")).toBeVisible();
    const disclosure = screen.getByRole("group", { name: "งานวันถัดไป" });
    expect(disclosure).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("วันถัดไป (1 งาน)"));
    expect(within(disclosure).getByRole("article", { name: "งานอนาคต · ฟอคคาเซีย" })).toBeVisible();
    expect(within(disclosure).getByText("12 กันยายน 2569")).toBeVisible();
  });
  it("uses all active product options when editing a current task", async () => {
    render(<OperationsTaskTimeline view={READY_VIEW} />);
    await userEvent.click(screen.getByRole("button", { name: "แก้ไขงาน" }));
    expect(screen.getByRole("option", { name: "บริยอช" })).toBeInTheDocument();
  });
  it("allows current tasks while in production and distinguishes an absent plan", () => {
    const { rerender } = render(<OperationsTaskTimeline view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" } }} />);
    expect(screen.getByRole("button", { name: "ทำเสร็จแล้ว" })).toBeVisible();
    rerender(<OperationsTaskTimeline view={{ ...NO_GENERATION_VIEW, reason: "NO_ACTIVE_PLAN" }} />);
    expect(screen.getByText("รอบนี้ยังไม่มีแผน Production Timeline")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it.each(["COMPLETED", "CANCELLED", "OPEN"] as const)("does not mutate tasks in %s", (status) => {
    render(<OperationsTaskTimeline view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status } }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("อ่านอย่างเดียว")).toBeVisible();
  });
  it("never gives a mismatched generation task mutation controls", () => {
    const stale = { ...TASK, taskGenerationId: "old-generation" };
    render(<OperationsTaskTimeline view={{ ...READY_VIEW, tasks: [stale], taskBuckets: { overdue: [], today: [stale], future: [] } }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("distinguishes empty overdue/today, all finished, and missing generation", () => {
    const { rerender } = render(<OperationsTaskTimeline view={{ ...READY_VIEW, tasks: [], taskBuckets: { overdue: [], today: [], future: [] } }} />);
    expect(screen.getByText("ไม่มีงานเลยกำหนด")).toBeVisible();
    expect(screen.getByText("ไม่มีงานวันนี้")).toBeVisible();
    rerender(<OperationsTaskTimeline view={{ ...READY_VIEW, tasks: [{ ...TASK, status: "DONE" }], taskBuckets: { overdue: [], today: [{ ...TASK, status: "DONE" }], future: [] } }} />);
    expect(screen.getByText("งานทั้งหมดเสร็จแล้ว")).toBeVisible();
    rerender(<OperationsTaskTimeline view={NO_GENERATION_VIEW} />);
    expect(screen.getByText("รอบรุ่นนี้ยังไม่มี Production Timeline")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
