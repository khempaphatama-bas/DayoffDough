import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ completeCycleAction: vi.fn() }));
import { ORDER, READY_VIEW, GENERATION_ID, CYCLE_ID } from "@tests/fixtures/operations";
import { operationAction, payloadOf } from "@tests/helpers/operations-ui";
import { ERROR } from "@tests/helpers/operations-ui";
import { CycleCompletionForm } from "./cycle-completion-form";
it("blocks pending V1 use even when delivery and tasks are complete", () => {
  const { container } = render(<CycleCompletionForm view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, completion: { ...READY_VIEW.completion, ready: true, remainingTaskCount: 0 } }} />);
  expect(within(container).getByRole("button", { name: "จบรอบผลิต" })).toBeDisabled();
  expect(within(container).getByRole("link", { name: "บันทึกยอดใช้" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/consumption`);
});
it("offers owned consumption guidance when a stale completion is rejected", async () => {
  const action = operationAction().mockResolvedValue({ error: "กรุณาบันทึกยอดใช้", kind: "PENDING_USE", saved: false, fieldErrors: {}, blockers: [{ cycleId: CYCLE_ID, cycleName: "รอบส่ง 12 ก.ย." }] });
  render(<CycleCompletionForm view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, consumption: { ...READY_VIEW.consumption, recorded: true }, completion: { ...READY_VIEW.completion, ready: true, remainingTaskCount: 0 } }} action={action} />);
  await userEvent.click(screen.getByRole("button", { name: "จบรอบผลิต" }));
  await userEvent.click(screen.getByRole("button", { name: "ยืนยันจบรอบผลิต" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาบันทึกยอดใช้");
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "รอบส่ง 12 ก.ย." })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/consumption`);
});
it("retains pre-cutover completion without inventing a recorded-use requirement", async () => {
  const action = operationAction();
  render(<CycleCompletionForm view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, consumption: { required: false, recorded: false, startBlockedByStockCheck: false }, completion: { ...READY_VIEW.completion, ready: true, remainingTaskCount: 0 } }} action={action} />);
  await userEvent.click(screen.getByRole("button", { name: "จบรอบผลิต" }));
  await userEvent.click(screen.getByRole("button", { name: "ยืนยันจบรอบผลิต" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(payloadOf(action)).toEqual({ cycleId: CYCLE_ID, expectedTaskGenerationId: GENERATION_ID, confirmation: true });
});
it("disables completion with task/order blocker reasons", () => {
  render(<CycleCompletionForm view={{
    ...READY_VIEW,
    cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" },
    completion: { ...READY_VIEW.completion, remainingOrderCount: 2 },
  }} />);

  expect(screen.getByRole("button", { name: "จบรอบผลิต" })).toBeDisabled();
  expect(screen.getByText(/งานค้าง 1 งาน/)).toHaveTextContent("ออเดอร์ยังไม่ส่ง 2 ใบ");
});

it("requires confirmation with unpaid warning without blocking completion", async () => {
  const action = operationAction();
  render(<CycleCompletionForm view={{
    ...READY_VIEW,
    cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" },
    consumption: { ...READY_VIEW.consumption, recorded: true },
    completion: { ready: true, remainingTaskCount: 0, remainingOrderCount: 0, unpaidOrderCount: 2, outstandingSatang: 30000 },
  }} action={action} />);

  await userEvent.click(screen.getByRole("button", { name: "จบรอบผลิต" }));
  expect(action).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("2 ออเดอร์");
  expect(dialog).toHaveTextContent("300.00");
  expect(dialog).toHaveTextContent("หลังจบรอบยังบันทึกยอดชำระได้");

  await userEvent.click(within(dialog).getByRole("button", { name: "ยืนยันจบรอบผลิต" }));
  await waitFor(() => expect(action).toHaveBeenCalled());
  expect(payloadOf(action)).toEqual({ cycleId: CYCLE_ID, expectedTaskGenerationId: GENERATION_ID, confirmation: true });
});
it("warns explicitly about completed legacy task/order inconsistency without mutation controls", () => {
  render(<CycleCompletionForm view={{
    ...READY_VIEW,
    cycle: { ...READY_VIEW.cycle, status: "COMPLETED" },
    orders: [ORDER],
    completion: { ...READY_VIEW.completion, remainingOrderCount: 1 },
  }} />);

  expect(screen.getByRole("alert")).toHaveTextContent("ข้อมูลรอบที่จบแล้วไม่สอดคล้อง");
  expect(screen.queryByRole("button")).toBeNull();
});

it("cancelled cycles are read-only", () => {
  render(<CycleCompletionForm view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "CANCELLED" } }} />);

  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps failed completion dialog and its refresh link keyboard-accessible", async () => {
  const action = operationAction().mockResolvedValue(ERROR);
  const user = userEvent.setup();
  render(<CycleCompletionForm view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, consumption: { ...READY_VIEW.consumption, recorded: true }, completion: { ...READY_VIEW.completion, ready: true, remainingTaskCount: 0 } }} action={action}/>);
  const trigger = screen.getByRole("button", { name: "จบรอบผลิต" });

  await user.click(trigger);
  const dialog = screen.getByRole("dialog");
  const cancel = within(dialog).getByRole("button", { name: "ยกเลิก" });
  expect(cancel).toHaveFocus();

  await user.click(within(dialog).getByRole("button", { name: "ยืนยันจบรอบผลิต" }));
  await within(dialog).findByRole("alert");
  await user.tab();
  expect(within(dialog).getByRole("link", { name: "โหลดข้อมูลล่าสุด" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});
it.each([{ remainingTaskCount: 1, remainingOrderCount: 0 }, { remainingTaskCount: 0, remainingOrderCount: 1 }])("warns for independent completed legacy blocker %j", counts => {
  render(<CycleCompletionForm view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "COMPLETED" }, completion: { ...READY_VIEW.completion, ...counts } }}/>);
  expect(screen.getByRole("alert")).toHaveTextContent("ข้อมูลรอบที่จบแล้วไม่สอดคล้อง");
  expect(screen.queryByRole("button")).toBeNull();
});
