import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ setPackedQuantityAction: vi.fn(), confirmOrderPackedAction: vi.fn(), reopenOrderPackingAction: vi.fn(), confirmOrdersAction: vi.fn(), startOrdersAction: vi.fn(), deliverOrdersAction: vi.fn() }));
import { ORDER, READY_VIEW } from "@tests/fixtures/operations";
import { ERROR, operationAction, payloadOf } from "@tests/helpers/operations-ui";
import { OperationsOrderBoard } from "./operations-order-board";
const second = { ...ORDER, id: "72000000-0000-4000-8000-000000000041", customerName: "คุณบี", confirmedDeliveryTime: null };
it("confirms delivery summary and keeps selected orders after atomic error", async () => {
  const action = operationAction().mockResolvedValue(ERROR);
  const user = userEvent.setup();
  render(<OperationsOrderBoard view={{
    ...READY_VIEW,
    cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" },
    orders: [second, ORDER].map(o => ({ ...o, fulfillmentStatus: "PACKED" })),
  }} deliverAction={action} />);

  await user.click(screen.getByLabelText("เลือกจัดส่ง คุณเมย์"));
  await user.click(screen.getByLabelText("เลือกจัดส่ง คุณบี"));
  await user.click(screen.getByRole("button", { name: "ยืนยันส่งสำเร็จ 2 ออเดอร์" }));
  expect(action).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("คุณเมย์ · รับเอง");
  expect(dialog).toHaveTextContent("ยอดค้าง");

  await user.click(within(dialog).getByRole("button", { name: "ยืนยันจัดส่ง" }));
  await screen.findByRole("alert");

  expect(screen.getByLabelText("เลือกจัดส่ง คุณเมย์")).toBeChecked();
  expect(screen.getByLabelText("เลือกจัดส่ง คุณบี")).toBeChecked();
  expect(payloadOf(action).orderIds).toEqual([ORDER.id, second.id]);
});
it.each(["NEW", "CONFIRMED"] as const)("batches %s and clears selections on repeated distinct successes", async (status) => {
  const action = operationAction();
  const user = userEvent.setup();
  const label = status === "NEW" ? "ยืนยันออเดอร์" : "เริ่มทำออเดอร์";
  render(<OperationsOrderBoard view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, orders: [{ ...ORDER, fulfillmentStatus: status }] }} confirmAction={action} startAction={action}/>);
  const check = screen.getByLabelText(`เลือก${label} คุณเมย์`);
  for (let i = 0; i < 2; i++) {
    await user.click(check);
    await user.click(screen.getByRole("button", { name: `${label} 1 ออเดอร์` }));
    await waitFor(() => expect(check).not.toBeChecked());
  }
  expect(action).toHaveBeenCalledTimes(2);
  expect(payloadOf(action).orderIds).toEqual([ORDER.id]);
});
it("disables confirmed start until cycle production and discloses cancelled orders", async () => {
  render(<OperationsOrderBoard view={{
    ...READY_VIEW,
    orders: [{ ...ORDER, fulfillmentStatus: "CONFIRMED" }],
    cancelledOrders: [{ ...second, fulfillmentStatus: "CANCELLED" }],
  }} />);

  expect(screen.getByLabelText("เลือกเริ่มทำออเดอร์ คุณเมย์")).toBeDisabled();
  const details = screen.getByText("ออเดอร์ที่ยกเลิก (1)").closest("details")!;
  expect(details).not.toHaveAttribute("open");

  await userEvent.click(screen.getByText("ออเดอร์ที่ยกเลิก (1)"));

  expect(within(details).getByText("คุณบี")).toBeVisible();
  expect(within(details).queryByRole("button")).toBeNull();
});

it("keeps delivery keyboard focus inside its dialog including the stale refresh link", async () => {
  const action = operationAction().mockResolvedValue(ERROR);
  const user = userEvent.setup();
  render(<OperationsOrderBoard view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, orders: [{ ...ORDER, fulfillmentStatus: "PACKED" }] }} deliverAction={action}/>);
  await user.click(screen.getByLabelText("เลือกจัดส่ง คุณเมย์"));
  const trigger = screen.getByRole("button", { name: "ยืนยันส่งสำเร็จ 1 ออเดอร์" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog");
  const cancel = within(dialog).getByRole("button", { name: "ยกเลิก" });
  expect(cancel).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "ยืนยันจัดส่ง" }));
  await within(dialog).findByRole("alert");
  await user.tab();
  expect(within(dialog).getByRole("link", { name: "โหลดข้อมูลล่าสุด" })).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(screen.getByLabelText("เลือกจัดส่ง คุณเมย์")).toBeChecked();
});
it("disables selection and delivery confirmation while a batch is pending", async () => {
  let resolve!: (value: typeof ERROR) => void;
  const action = operationAction().mockImplementation(() => new Promise(done => { resolve = done; }));
  const user = userEvent.setup();
  render(<OperationsOrderBoard view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" }, orders: [{ ...ORDER, fulfillmentStatus: "PACKED" }] }} deliverAction={action}/>);
  const selection = screen.getByLabelText("เลือกจัดส่ง คุณเมย์");

  await user.click(selection);
  await user.click(screen.getByRole("button", { name: "ยืนยันส่งสำเร็จ 1 ออเดอร์" }));
  await user.click(screen.getByRole("button", { name: "ยืนยันจัดส่ง" }));

  expect(selection).toBeDisabled();
  expect(screen.getByRole("button", { name: "ยืนยันจัดส่ง" })).toBeDisabled();

  resolve(ERROR);
  await screen.findByRole("alert");
  expect(selection).toBeChecked();
});
it.each(["COMPLETED", "CANCELLED"] as const)("makes all %s order groups read-only", status => {
  render(<OperationsOrderBoard view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status }, orders: ["NEW", "CONFIRMED", "IN_PRODUCTION", "PACKED", "DELIVERED"].map((fulfillmentStatus, index) => ({ ...ORDER, id: `order-${index}`, fulfillmentStatus: fulfillmentStatus as typeof ORDER.fulfillmentStatus })) }}/>);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
