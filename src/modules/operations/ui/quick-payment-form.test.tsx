import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ setOrderAmountPaidAction: vi.fn() }));
import { ORDER } from "@tests/fixtures/operations";
import { ERROR, operationAction, payloadOf } from "@tests/helpers/operations-ui";
import { QuickPaymentForm } from "./quick-payment-form";

it("computes receive-more and pay-full cumulative targets and clears each distinct success", async () => {
  const action = operationAction(); const user = userEvent.setup(); render(<QuickPaymentForm order={ORDER} action={action} />);
  const input = screen.getByLabelText("รับเพิ่ม"); await user.type(input, "220.00"); await user.click(screen.getByRole("button", { name: "บันทึกรับเงิน" }));
  await waitFor(() => expect(input).toHaveValue("")); expect(payloadOf(action)).toEqual({ orderId: ORDER.id, targetAmountPaidSatang: 42000, expectedAmountPaidSatang: 20000 });
  await user.type(input, "100.00"); await user.click(screen.getByRole("button", { name: "บันทึกรับเงิน" })); await waitFor(() => expect(input).toHaveValue(""));
  await user.click(screen.getByRole("button", { name: "ชำระครบ" })); await waitFor(() => expect(action).toHaveBeenCalledTimes(3)); expect(payloadOf(action).targetAmountPaidSatang).toBe(50000);
});
it.each(["-1", "abc", "1.234", "300.01"])("rejects invalid or excessive receive-more %s", async value => {
  const action = operationAction(); render(<QuickPaymentForm order={ORDER} action={action} />); await userEvent.type(screen.getByLabelText("รับเพิ่ม"), value); await userEvent.click(screen.getByRole("button", { name: "บันทึกรับเงิน" })); expect(screen.getByRole("alert")).toBeVisible(); expect(action).not.toHaveBeenCalled();
});
it("corrects cumulative target to zero and preserves failed corrections", async () => {
  const action = operationAction().mockResolvedValue(ERROR); const user = userEvent.setup(); render(<QuickPaymentForm order={ORDER} action={action} />);
  await user.click(screen.getByRole("button", { name: "แก้ยอดสะสม" })); const input = screen.getByLabelText("ยอดสะสม"); await user.clear(input); await user.type(input, "0"); await user.click(screen.getByRole("button", { name: "บันทึกยอดสะสม" })); await screen.findByRole("alert"); expect(payloadOf(action).targetAmountPaidSatang).toBe(0); expect(input).toHaveValue("0");
});
it("disables payment controls while pending and refunded orders are read-only", async () => {
  let resolve!: (value: typeof ERROR) => void; const action = operationAction().mockImplementation(() => new Promise(done => { resolve = done; }));
  const { rerender } = render(<QuickPaymentForm order={ORDER} action={action} />); await userEvent.click(screen.getByRole("button", { name: "ชำระครบ" })); expect(screen.getByLabelText("รับเพิ่ม")).toBeDisabled(); resolve(ERROR); await screen.findByRole("alert");
  rerender(<QuickPaymentForm order={{ ...ORDER, paymentStatus: "REFUNDED" }} action={action} />); expect(screen.queryByRole("button")).toBeNull(); expect(screen.getByRole("link")).toHaveAttribute("href", `/orders/${ORDER.id}`);
});

it("keeps receive-more after a server error and hides pay-full when paid", async () => {
  const action = operationAction().mockResolvedValue(ERROR); const user = userEvent.setup(); const { rerender } = render(<QuickPaymentForm order={ORDER} action={action} />);
  await user.type(screen.getByLabelText("รับเพิ่ม"), "50.00"); await user.click(screen.getByRole("button", { name: "บันทึกรับเงิน" })); await screen.findByRole("alert"); expect(screen.getByLabelText("รับเพิ่ม")).toHaveValue("50.00");
  rerender(<QuickPaymentForm order={{ ...ORDER, paymentStatus: "PAID", amountPaidSatang: 50000, balanceSatang: 0 }} action={action} />); expect(screen.queryByRole("button", { name: "ชำระครบ" })).toBeNull(); expect(screen.getByRole("button", { name: "แก้ยอดสะสม" })).toBeEnabled();
});
