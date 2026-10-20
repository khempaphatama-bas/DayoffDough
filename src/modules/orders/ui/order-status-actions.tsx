"use client";

import { useActionState, type FormEvent } from "react";
import Link from "next/link";
import { reopenOrderPackingAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import type {
  OrderStatusActionState,
} from "@/app/(app)/orders/actions";
import type {
  OrderDetail,
  OrderFulfillmentStatus,
} from "@/modules/orders/application/orders";
import type { BakeCycleStatus } from "@/modules/cycles/domain/cycle-lifecycle";
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
  cycleId: string;
  cycleStatus: BakeCycleStatus;
  paymentStatus: OrderDetail["paymentStatus"];
  fulfillmentStatus: OrderFulfillmentStatus;
  updateFulfillmentStatus: StatusAction;
  reopenOrderPacking?: typeof reopenOrderPackingAction;
  cancelOrder: StatusAction;
  markOrderRefunded: StatusAction;
  restoreOrderPaymentTracking: StatusAction;
}>;

const INITIAL_STATE: OrderStatusActionState = {
  error: null,
  saved: false,
};

const INITIAL_OPERATIONS_STATE: OperationsActionState = {
  error: null,
  kind: null,
  fieldErrors: {},
  saved: false,
};

function ActionFeedback({
  state,
  success,
}: Readonly<{ state: OrderStatusActionState; success: string }>) {
  if (state.error) {
    return (
      <div className="grid gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
        {state.error}
        {state.operationsHref ? <Link className="inline-flex min-h-11 items-center font-semibold underline" href={state.operationsHref}>บันทึกจำนวนที่แพ็กใน Operations</Link> : null}
      </div>
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
  cycleId,
  cycleStatus,
  paymentStatus,
  fulfillmentStatus,
  updateFulfillmentStatus,
  reopenOrderPacking = reopenOrderPackingAction,
  cancelOrder,
  markOrderRefunded,
  restoreOrderPaymentTracking,
}: OrderStatusActionsProps) {
  const [fulfillmentState, fulfillmentAction, fulfillmentPending] =
    useActionState(updateFulfillmentStatus, INITIAL_STATE);
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenOrderPacking,
    INITIAL_OPERATIONS_STATE,
  );
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
  const productionFrozen = cycleStatus !== "DRAFT" && cycleStatus !== "OPEN";
  const canConfirm = fulfillmentStatus === "NEW" && (cycleStatus === "DRAFT" || cycleStatus === "OPEN" || cycleStatus === "LOCKED" || cycleStatus === "IN_PRODUCTION");
  const next = canConfirm ? { status: "CONFIRMED", label: "ยืนยันออเดอร์" }
    : cycleStatus === "IN_PRODUCTION" && fulfillmentStatus === "CONFIRMED" ? { status: "IN_PRODUCTION", label: "เริ่มทำออเดอร์" }
    : cycleStatus === "IN_PRODUCTION" && fulfillmentStatus === "IN_PRODUCTION" ? { status: "PACKED", label: "ยืนยันแพ็กครบ" }
    : cycleStatus === "IN_PRODUCTION" && fulfillmentStatus === "PACKED" ? { status: "DELIVERED", label: "จัดส่งแล้ว" }
    : null;

  function confirmCancellation(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("ยืนยันยกเลิกออเดอร์นี้หรือไม่?")) {
      event.preventDefault();
    }
  }

  return (
    <section className="grid gap-4" aria-label="จัดการสถานะออเดอร์">
      {productionFrozen && fulfillmentStatus !== "CANCELLED" ? <Link className="inline-flex min-h-11 items-center font-semibold text-amber-900 underline" href={`/cycles/${cycleId}/operations`}>เปิด Operations</Link> : null}
      {next ? (
        <form
          action={fulfillmentAction}
          className="flex flex-wrap gap-2"
        >
          <input name="orderId" type="hidden" value={orderId} />
          <input name="cycleId" type="hidden" value={cycleId} />
          <button className="min-h-11 rounded-xl border border-stone-800 px-4 font-semibold text-stone-800 disabled:opacity-60"
            disabled={fulfillmentPending || reopenPending} name="status" type="submit" value={next.status}>
            {next.label}
          </button>
        </form>
      ) : null}
      {cycleStatus === "IN_PRODUCTION" && fulfillmentStatus === "PACKED" ? <form action={reopenAction}>
        <input name="payload" type="hidden" value={JSON.stringify({ cycleId, orderId })} />
        <button className="min-h-11 rounded-xl border border-amber-800 px-4 font-semibold text-amber-900 disabled:opacity-60" disabled={reopenPending || fulfillmentPending} type="submit">เปิดแก้ไขการแพ็ก</button>
      </form> : null}
      <ActionFeedback state={reopenState} success="เปิดแก้ไขการแพ็กแล้ว" />
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
        fulfillmentStatus !== "DELIVERED" &&
        !productionFrozen ? (
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
