import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ setPackedQuantityAction: vi.fn(), confirmOrderPackedAction: vi.fn(), reopenOrderPackingAction: vi.fn() }));
import { ORDER, CYCLE_ID } from "@tests/fixtures/operations";
import { operationAction, payloadOf } from "@tests/helpers/operations-ui";
import { OperationsOrderCard } from "./operations-order-card";
it("offers confirm packed only after every item complete, without optimistic cascade", async () => {
  const action = operationAction(); const { rerender } = render(<OperationsOrderCard cycleId={CYCLE_ID} cycleStatus="IN_PRODUCTION" order={{ ...ORDER, items: [{ ...ORDER.items[0]!, packedQuantity: 10 }, { ...ORDER.items[0]!, id: "second-item", productName: "Brioche" }] }} confirmPackedAction={action} />); expect(screen.queryByRole("button", { name: "ยืนยันแพ็กครบ" })).toBeNull();
  rerender(<OperationsOrderCard cycleId={CYCLE_ID} cycleStatus="IN_PRODUCTION" order={{ ...ORDER, items: ORDER.items.map(item => ({ ...item, packedQuantity: 10 })) }} confirmPackedAction={action} />); await userEvent.click(screen.getByRole("button", { name: "ยืนยันแพ็กครบ" })); await waitFor(() => expect(action).toHaveBeenCalled()); expect(payloadOf(action)).toEqual({ cycleId: CYCLE_ID, orderId: ORDER.id }); expect(screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia")).toBeVisible();
});
it("requires explicit reopen and displays schedule, notes and totals", async () => {
  const action = operationAction(); render(<OperationsOrderCard cycleId={CYCLE_ID} cycleStatus="IN_PRODUCTION" order={{ ...ORDER, fulfillmentStatus: "PACKED", confirmedDeliveryTime: null }} reopenAction={action} />);
  expect(screen.queryByRole("spinbutton")).toBeNull(); expect(screen.getByText("ยังไม่กำหนดเวลา")).toBeVisible(); expect(screen.getByText("โทรก่อนส่ง")).toBeVisible(); expect(screen.getByText("ไม่ใส่พริก")).toBeVisible(); await userEvent.click(screen.getByRole("button", { name: "เปิดแก้ไขการแพ็ก" })); await waitFor(() => expect(action).toHaveBeenCalled()); expect(payloadOf(action).orderId).toBe(ORDER.id);
});
it.each(["COMPLETED", "CANCELLED"] as const)("makes %s cycle cards read-only even for legacy inconsistent orders", status => { render(<OperationsOrderCard cycleId={CYCLE_ID} cycleStatus={status} order={ORDER} />); expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("spinbutton")).toBeNull(); });
it.each(["DELIVERED", "CANCELLED"] as const)("makes %s fulfillment read-only", fulfillmentStatus => { render(<OperationsOrderCard cycleId={CYCLE_ID} cycleStatus="IN_PRODUCTION" order={{ ...ORDER, fulfillmentStatus }} />); expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("spinbutton")).toBeNull(); });
