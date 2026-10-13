"use client";

import type { CycleOperationsView } from "@/modules/operations/domain/types";
import { compareOperationsOrders } from "@/modules/operations/domain/rules";
import { ORDER_PAYMENT_STATUS_LABELS } from "@/modules/orders/ui/order-status-labels";
import { QuickPaymentForm } from "./quick-payment-form";

export function OperationsPaymentBoard({ view }: Readonly<{ view: CycleOperationsView }>) {
  if (view.kind !== "READY") return null;
  const orders = view.orders.filter(order => order.fulfillmentStatus !== "CANCELLED").toSorted(compareOperationsOrders);
  return <section aria-label="รับชำระเงิน" className="grid gap-4">
    <h2 className="text-2xl font-bold">รับชำระเงิน</h2>
    {orders.length === 0 ? <p className="text-stone-600">ไม่มีออเดอร์รับชำระเงิน</p> : null}
    {orders.map(order => <article className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4" key={order.id}>
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{order.customerName}</h3><span className="rounded-full bg-stone-100 px-3 py-1 text-sm">{ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}</span></div>
      <p className="text-sm text-stone-700">{order.confirmedDeliveryDate ?? "ยังไม่กำหนดวัน"} · {order.confirmedDeliveryTime ?? "ยังไม่กำหนดเวลา"} · {order.deliveryMethodName ?? "ยังไม่กำหนดวิธีส่ง"}</p>
      <QuickPaymentForm order={order} readOnly={view.cycle.status === "CANCELLED"} />
    </article>)}
  </section>;
}
