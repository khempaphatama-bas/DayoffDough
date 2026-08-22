import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrderStatusActions } from "./order-status-actions";

const ORDER_ID = "00000000-0000-4000-8000-000000000060";

describe("OrderStatusActions", () => {
  it("offers named forward, refund, and confirmed cancellation actions", async () => {
    const updateFulfillmentStatus = vi.fn().mockResolvedValue({
      error: null,
      saved: true,
    });
    const cancelOrder = vi.fn().mockResolvedValue({
      error: null,
      saved: true,
    });
    const markOrderRefunded = vi.fn().mockResolvedValue({
      error: null,
      saved: true,
    });
    const restoreOrderPaymentTracking = vi.fn().mockResolvedValue({
      error: null,
      saved: true,
    });
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();

    render(
      <OrderStatusActions
        cancelOrder={cancelOrder}
        fulfillmentStatus="CONFIRMED"
        markOrderRefunded={markOrderRefunded}
        orderId={ORDER_ID}
        paymentStatus="PARTIAL"
        restoreOrderPaymentTracking={restoreOrderPaymentTracking}
        updateFulfillmentStatus={updateFulfillmentStatus}
      />,
    );

    for (const name of [
      "เริ่มผลิต",
      "แพ็กเสร็จแล้ว",
      "จัดส่งแล้ว",
      "บันทึกคืนเงิน",
      "ยกเลิกออเดอร์",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "ยกเลิกออเดอร์" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelOrder).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "ยกเลิกออเดอร์" }));
    await waitFor(() => expect(cancelOrder).toHaveBeenCalledOnce());
    const submitted = cancelOrder.mock.calls[0]?.[1];
    expect(submitted).toBeInstanceOf(FormData);
    expect((submitted as FormData).get("status")).toBe("CANCELLED");
  });

  it("offers restoration only for an explicitly refunded order", async () => {
    const restoreOrderPaymentTracking = vi.fn().mockResolvedValue({
      error: null,
      saved: true,
    });
    const user = userEvent.setup();

    render(
      <OrderStatusActions
        cancelOrder={vi.fn()}
        fulfillmentStatus="CANCELLED"
        markOrderRefunded={vi.fn()}
        orderId={ORDER_ID}
        paymentStatus="REFUNDED"
        restoreOrderPaymentTracking={restoreOrderPaymentTracking}
        updateFulfillmentStatus={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "บันทึกคืนเงิน" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ยกเลิกออเดอร์" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "กลับมาติดตามการชำระเงิน" }),
    );
    await waitFor(() =>
      expect(restoreOrderPaymentTracking).toHaveBeenCalledOnce(),
    );
    const submitted = restoreOrderPaymentTracking.mock.calls[0]?.[1];
    expect((submitted as FormData).get("status")).toBe("RESTORE");
  });
});
