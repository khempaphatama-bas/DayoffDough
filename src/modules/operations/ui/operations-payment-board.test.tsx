import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ setOrderAmountPaidAction: vi.fn() }));
import { ORDER, READY_VIEW } from "@tests/fixtures/operations";
import { OperationsPaymentBoard } from "./operations-payment-board";
it("sorts a separate payment section and allows delivered/completed payment", () => {
  render(<OperationsPaymentBoard view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "COMPLETED" }, orders: [{ ...ORDER, id: "late", customerName: "Late", confirmedDeliveryTime: null, fulfillmentStatus: "DELIVERED" }, { ...ORDER, fulfillmentStatus: "DELIVERED" }], cancelledOrders: [{ ...ORDER, customerName: "Cancelled", fulfillmentStatus: "CANCELLED" }] }} />);
  const section = screen.getByRole("region", { name: "รับชำระเงิน" }); expect(within(section).getAllByRole("heading", { level: 3 }).map(x => x.textContent)).toEqual(["คุณเมย์", "Late"]); expect(within(section).getAllByRole("button", { name: "ชำระครบ" })).toHaveLength(2); expect(screen.queryByText("Cancelled")).toBeNull();
});
it("makes cancelled cycles entirely read-only", () => { render(<OperationsPaymentBoard view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "CANCELLED" }, orders: [ORDER] }} />); expect(screen.queryByRole("button")).toBeNull(); });
