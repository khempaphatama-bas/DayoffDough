"use client";

import { useActionState, type FormEvent } from "react";
import type {
  OrderStatusActionState,
} from "@/app/(app)/orders/actions";
import type {
  OrderDetail,
  OrderFulfillmentStatus,
} from "@/modules/orders/application/orders";
export {
  ORDER_FULFILLMENT_STATUS_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
} from "@/modules/orders/ui/order-status-labels";

type StatusAction = (
  previousState: OrderStatusActionState,
  formData: FormData,
) => Promise<OrderStatusActionState>;

type OrderStatusActionsProps = Readonly<{
  orderId: string;
  paymentStatus: OrderDetail["paymentStatus"];
  fulfillmentStatus: OrderFulfillmentStatus;
  updateFulfillmentStatus: StatusAction;
  cancelOrder: StatusAction;
  markOrderRefunded: StatusAction;
  restoreOrderPaymentTracking: StatusAction;
}>;

const INITIAL_STATE: OrderStatusActionState = {
  error: null,
  saved: false,
};

const FORWARD_ACTIONS: ReadonlyArray<
  Readonly<{ status: Exclude<OrderFulfillmentStatus, "CANCELLED">; label: string }>
> = [
  { status: "CONFIRMED", label: "ยืนยันออเดอร์" },
  { status: "IN_PRODUCTION", label: "เริ่มผลิต" },
  { status: "PACKED", label: "แพ็กเสร็จแล้ว" },
  { status: "DELIVERED", label: "จัดส่งแล้ว" },
];

function ActionFeedback({
  state,
  success,
}: Readonly<{ state: OrderStatusActionState; success: string }>) {
  if (state.error) {
    return (
      <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
        {state.error}
      </p>
    );
  }
  return state.saved ? (
    <p aria-live="polite" className="text-sm text-emerald-800">
      {success}
    </p>
  ) : null;
}

export function OrderStatusActions({
  orderId,
  paymentStatus,
  fulfillmentStatus,
  updateFulfillmentStatus,
  cancelOrder,
  markOrderRefunded,
  restoreOrderPaymentTracking,
}: OrderStatusActionsProps) {
  const [fulfillmentState, fulfillmentAction, fulfillmentPending] =
    useActionState(updateFulfillmentStatus, INITIAL_STATE);
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelOrder,
    INITIAL_STATE,
  );
  const [refundState, refundAction, refundPending] = useActionState(
    markOrderRefunded,
    INITIAL_STATE,
  );
  const [restoreState, restoreAction, restorePending] = useActionState(
    restoreOrderPaymentTracking,
    INITIAL_STATE,
  );
  const currentIndex = FORWARD_ACTIONS.findIndex(
    (action) => action.status === fulfillmentStatus,
  );
  const availableForwardActions =
    fulfillmentStatus === "CANCELLED" || fulfillmentStatus === "DELIVERED"
      ? []
      : FORWARD_ACTIONS.filter((_, index) => index > currentIndex);

  function confirmCancellation(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("ยืนยันยกเลิกออเดอร์นี้หรือไม่?")) {
      event.preventDefault();
    }
  }

  function confirmDelivery(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (
      submitter?.value === "DELIVERED" &&
      !window.confirm("ยืนยันว่าออเดอร์นี้จัดส่งแล้วหรือไม่?")
    ) {
      event.preventDefault();
    }
  }

  return (
    <section className="grid gap-4" aria-label="จัดการสถานะออเดอร์">
      {availableForwardActions.length > 0 ? (
        <form
          action={fulfillmentAction}
          className="flex flex-wrap gap-2"
          onSubmit={confirmDelivery}
        >
          <input name="orderId" type="hidden" value={orderId} />
          {availableForwardActions.map((action) => (
            <button
              className="min-h-11 rounded-xl border border-stone-800 px-4 font-semibold text-stone-800 disabled:opacity-60"
              disabled={fulfillmentPending}
              key={action.status}
              name="status"
              type="submit"
              value={action.status}
            >
              {action.label}
            </button>
          ))}
        </form>
      ) : null}
      <ActionFeedback
        state={fulfillmentState}
        success="อัปเดตการจัดเตรียมแล้ว"
      />

      <div className="flex flex-wrap gap-2">
        {paymentStatus === "REFUNDED" ? (
          <form action={restoreAction}>
            <input name="orderId" type="hidden" value={orderId} />
            <input name="status" type="hidden" value="RESTORE" />
            <button
              className="min-h-11 rounded-xl border border-amber-800 px-4 font-semibold text-amber-900 disabled:opacity-60"
              disabled={restorePending}
              type="submit"
            >
              กลับมาติดตามการชำระเงิน
            </button>
          </form>
        ) : (
          <form action={refundAction}>
            <input name="orderId" type="hidden" value={orderId} />
            <input name="status" type="hidden" value="REFUNDED" />
            <button
              className="min-h-11 rounded-xl border border-amber-800 px-4 font-semibold text-amber-900 disabled:opacity-60"
              disabled={refundPending}
              type="submit"
            >
              บันทึกคืนเงิน
            </button>
          </form>
        )}
        {fulfillmentStatus !== "CANCELLED" &&
        fulfillmentStatus !== "DELIVERED" ? (
          <form action={cancelAction} onSubmit={confirmCancellation}>
            <input name="orderId" type="hidden" value={orderId} />
            <input name="status" type="hidden" value="CANCELLED" />
            <button
              className="min-h-11 rounded-xl border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-60"
              disabled={cancelPending}
              type="submit"
            >
              ยกเลิกออเดอร์
            </button>
          </form>
        ) : null}
      </div>
      <ActionFeedback state={cancelState} success="ยกเลิกออเดอร์แล้ว" />
      <ActionFeedback state={refundState} success="บันทึกการคืนเงินแล้ว" />
      <ActionFeedback
        state={restoreState}
        success="กลับมาติดตามการชำระเงินแล้ว"
      />
    </section>
  );
}
