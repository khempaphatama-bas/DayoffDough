import { render, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderStatusActions } from "./order-status-actions";

vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ reopenOrderPackingAction: vi.fn() }));
const ORDER_ID = "00000000-0000-4000-8000-000000000060";
const CYCLE_ID = "00000000-0000-4000-8000-000000000020";
function props() {
  return { orderId: ORDER_ID, cycleId: CYCLE_ID, cycleStatus: "IN_PRODUCTION" as const, paymentStatus: "PARTIAL" as const, fulfillmentStatus: "NEW" as const, updateFulfillmentStatus: vi.fn().mockResolvedValue({ error: null, saved: true }), reopenOrderPacking: vi.fn().mockResolvedValue({ error: null, kind: null, fieldErrors: {}, saved: true }), cancelOrder: vi.fn().mockResolvedValue({ error: null, saved: true }), markOrderRefunded: vi.fn().mockResolvedValue({ error: null, saved: true }), restoreOrderPaymentTracking: vi.fn().mockResolvedValue({ error: null, saved: true }) };
}

describe("OrderStatusActions", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ["NEW", "ยืนยันออเดอร์", "CONFIRMED"],
    ["CONFIRMED", "เริ่มทำออเดอร์", "IN_PRODUCTION"],
    ["IN_PRODUCTION", "ยืนยันแพ็กครบ", "PACKED"],
    ["PACKED", "จัดส่งแล้ว", "DELIVERED"],
  ] as const)("offers only the next guarded forward action for %s and includes its Cycle", async (fulfillmentStatus, label, status) => {
    const actions = props();
    const { container } = render(<OrderStatusActions {...actions} fulfillmentStatus={fulfillmentStatus} />);
    const ui = within(container);
    for (const candidate of ["ยืนยันออเดอร์", "เริ่มทำออเดอร์", "ยืนยันแพ็กครบ", "จัดส่งแล้ว"]) {
      if (candidate === label) expect(ui.getByRole("button", { name: candidate })).toBeEnabled();
      else expect(ui.queryByRole("button", { name: candidate })).toBeNull();
    }
    expect(ui.getByRole("link", { name: "เปิด Operations" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/operations`);
    expect(ui.getByRole("button", { name: "บันทึกคืนเงิน" })).toBeEnabled();
    expect(ui.queryByRole("button", { name: "ยกเลิกออเดอร์" })).toBeNull();
    await userEvent.setup().click(ui.getByRole("button", { name: label }));
    await waitFor(() => expect(actions.updateFulfillmentStatus).toHaveBeenCalledOnce());
    const submitted = actions.updateFulfillmentStatus.mock.calls[0]![1] as FormData;
    expect(submitted.get("orderId")).toBe(ORDER_ID);
    expect(submitted.get("cycleId")).toBe(CYCLE_ID);
    expect(submitted.get("status")).toBe(status);
  });
  it("reopens packing through the dedicated correction action only for PACKED", async () => {
    const actions = props();
    const { container, rerender } = render(<OrderStatusActions {...actions} fulfillmentStatus="PACKED" />);
    const ui = within(container);
    await userEvent.setup().click(ui.getByRole("button", { name: "เปิดแก้ไขการแพ็ก" }));
    await waitFor(() => expect(actions.reopenOrderPacking).toHaveBeenCalledOnce());
    expect(JSON.parse((actions.reopenOrderPacking.mock.calls[0]![1] as FormData).get("payload") as string)).toEqual({ cycleId: CYCLE_ID, orderId: ORDER_ID });
    expect(actions.updateFulfillmentStatus).not.toHaveBeenCalled();
    rerender(<OrderStatusActions {...actions} fulfillmentStatus="DELIVERED" />);
    expect(ui.queryByRole("button", { name: "เปิดแก้ไขการแพ็ก" })).toBeNull();
    expect(ui.queryByRole("button", { name: "จัดส่งแล้ว" })).toBeNull();
    expect(ui.queryByRole("button", { name: "ยกเลิกออเดอร์" })).toBeNull();
    expect(ui.getByRole("link", { name: "เปิด Operations" })).toBeVisible();
  });
  it("offers confirmation while locked but requires starting the Cycle before starting orders", () => {
    const actions = props();
    const { container, rerender } = render(<OrderStatusActions {...actions} cycleStatus="LOCKED" />);
    const ui = within(container);
    expect(ui.getByRole("button", { name: "ยืนยันออเดอร์" })).toBeEnabled();
    rerender(<OrderStatusActions {...actions} cycleStatus="LOCKED" fulfillmentStatus="CONFIRMED" />);
    expect(ui.queryByRole("button", { name: "เริ่มทำออเดอร์" })).toBeNull();
    expect(ui.queryByRole("button", { name: "ยกเลิกออเดอร์" })).toBeNull();
    expect(ui.getByRole("link", { name: "เปิด Operations" })).toBeVisible();
  });
  it.each(["COMPLETED", "CANCELLED"] as const)("exposes no fulfillment or cancellation mutation for terminal Cycle %s", (cycleStatus) => {
    const { container } = render(<OrderStatusActions {...props()} cycleStatus={cycleStatus} fulfillmentStatus="PACKED" paymentStatus="REFUNDED" />);
    for (const name of ["ยืนยันออเดอร์", "เริ่มทำออเดอร์", "ยืนยันแพ็กครบ", "จัดส่งแล้ว", "เปิดแก้ไขการแพ็ก", "ยกเลิกออเดอร์"]) expect(within(container).queryByRole("button", { name })).toBeNull();
    expect(within(container).getByRole("button", { name: "กลับมาติดตามการชำระเงิน" })).toBeEnabled();
  });
  it("keeps cancelled frozen orders out of Operations actions", () => {
    const { container } = render(<OrderStatusActions {...props()} fulfillmentStatus="CANCELLED" />);
    for (const name of ["ยืนยันออเดอร์", "เริ่มทำออเดอร์", "ยืนยันแพ็กครบ", "จัดส่งแล้ว", "เปิดแก้ไขการแพ็ก", "ยกเลิกออเดอร์"]) expect(within(container).queryByRole("button", { name })).toBeNull();
    expect(within(container).queryByRole("link", { name: "เปิด Operations" })).toBeNull();
  });
  it("preserves explicit confirmation, refund and confirmed cancellation before freeze", async () => {
    const actions = props();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { container } = render(<OrderStatusActions {...actions} cycleStatus="OPEN" />);
    const ui = within(container); const user = userEvent.setup();
    for (const name of ["ยืนยันออเดอร์", "บันทึกคืนเงิน", "ยกเลิกออเดอร์"]) expect(ui.getByRole("button", { name })).toBeEnabled();
    await user.click(ui.getByRole("button", { name: "ยกเลิกออเดอร์" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(actions.cancelOrder).not.toHaveBeenCalled();
    await user.click(ui.getByRole("button", { name: "ยกเลิกออเดอร์" }));
    await waitFor(() => expect(actions.cancelOrder).toHaveBeenCalledOnce());
    expect((actions.cancelOrder.mock.calls[0]![1] as FormData).get("status")).toBe("CANCELLED");
  });
  it("preserves restoration for explicitly refunded orders before freeze", async () => {
    const actions = props();
    const { container } = render(<OrderStatusActions {...actions} cycleStatus="OPEN" fulfillmentStatus="CANCELLED" paymentStatus="REFUNDED" />);
    const ui = within(container);
    expect(ui.queryByRole("button", { name: "บันทึกคืนเงิน" })).toBeNull();
    await userEvent.setup().click(ui.getByRole("button", { name: "กลับมาติดตามการชำระเงิน" }));
    await waitFor(() => expect(actions.restoreOrderPaymentTracking).toHaveBeenCalledOnce());
  });
  it.each(["LOCKED", "IN_PRODUCTION", "COMPLETED", "CANCELLED"] as const)("preserves existing refund and restore controls in %s Order detail without permitting cancellation", async (cycleStatus) => {
    const actions = props();
    const { container, rerender } = render(<OrderStatusActions {...actions} cycleStatus={cycleStatus} fulfillmentStatus="DELIVERED" />);
    const ui = within(container); const user = userEvent.setup();
    expect(ui.queryByRole("button", { name: "ยกเลิกออเดอร์" })).toBeNull();
    expect(ui.queryByRole("button", { name: "กลับมาติดตามการชำระเงิน" })).toBeNull();
    await user.click(ui.getByRole("button", { name: "บันทึกคืนเงิน" }));
    await waitFor(() => expect(actions.markOrderRefunded).toHaveBeenCalledOnce());
    expect((actions.markOrderRefunded.mock.calls[0]![1] as FormData).get("orderId")).toBe(ORDER_ID);
    expect((actions.markOrderRefunded.mock.calls[0]![1] as FormData).get("status")).toBe("REFUNDED");
    rerender(<OrderStatusActions {...actions} cycleStatus={cycleStatus} fulfillmentStatus="DELIVERED" paymentStatus="REFUNDED" />);
    expect(ui.queryByRole("button", { name: "บันทึกคืนเงิน" })).toBeNull();
    await user.click(ui.getByRole("button", { name: "กลับมาติดตามการชำระเงิน" }));
    await waitFor(() => expect(actions.restoreOrderPaymentTracking).toHaveBeenCalledOnce());
    expect((actions.restoreOrderPaymentTracking.mock.calls[0]![1] as FormData).get("status")).toBe("RESTORE");
    expect(actions.updateFulfillmentStatus).not.toHaveBeenCalled();
    expect(actions.cancelOrder).not.toHaveBeenCalled();
  });
  it("renders the authoritative packing-error Operations link returned by the action", async () => {
    const actions = props();
    actions.updateFulfillmentStatus.mockResolvedValue({ error: "ยังแพ็กสินค้าไม่ครบ", operationsHref: `/cycles/${CYCLE_ID}/operations`, saved: false });
    const { container } = render(<OrderStatusActions {...actions} fulfillmentStatus="IN_PRODUCTION" />);
    const ui = within(container);
    await userEvent.setup().click(ui.getByRole("button", { name: "ยืนยันแพ็กครบ" }));
    expect(await ui.findByRole("alert")).toHaveTextContent("ยังแพ็กสินค้าไม่ครบ");
    expect(ui.getByRole("link", { name: "บันทึกจำนวนที่แพ็กใน Operations" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/operations`);
    expect(ui.queryByText("อัปเดตการจัดเตรียมแล้ว")).toBeNull();
  });
});
