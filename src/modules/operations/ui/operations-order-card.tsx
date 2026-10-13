"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmOrderPackedAction, reopenOrderPackingAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import type { CycleOperationsHeader, OperationsOrder } from "@/modules/operations/domain/types";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { ORDER_FULFILLMENT_STATUS_LABELS, ORDER_PAYMENT_STATUS_LABELS } from "@/modules/orders/ui/order-status-labels";
import { PackingProgressForm } from "./packing-progress-form";

const INITIAL: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: false };
function OrderAction({ cycleId, orderId, action, label }: Readonly<{ cycleId: string; orderId: string; action: typeof confirmOrderPackedAction; label: string }>) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return <form action={formAction} className="grid gap-2"><input type="hidden" name="payload" value={JSON.stringify({ cycleId, orderId })} />
    <button type="submit" disabled={pending} className="min-h-12 rounded-xl bg-amber-800 px-4 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-50">{label}</button>
    {state.error ? <p role="alert" className="text-sm text-red-800">{state.error} {state.kind === "STALE_DATA" ? <a className="underline" href={`/cycles/${cycleId}/operations`}>โหลดข้อมูลล่าสุด</a> : null}</p> : null}
  </form>;
}

export function OperationsOrderCard({ cycleId, cycleStatus, order, confirmPackedAction = confirmOrderPackedAction, reopenAction = reopenOrderPackingAction }: Readonly<{ cycleId: string; cycleStatus: CycleOperationsHeader["status"]; order: OperationsOrder; confirmPackedAction?: typeof confirmOrderPackedAction; reopenAction?: typeof reopenOrderPackingAction }>) {
  const writable = cycleStatus === "IN_PRODUCTION";
  const packing = writable && order.fulfillmentStatus === "IN_PRODUCTION";
  const complete = order.items.length > 0 && order.items.every(item => item.packedQuantity === item.quantity);
  return <article aria-label={`ออเดอร์ ${order.customerName}`} className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4">
    <h3 className="text-lg font-bold"><Link href={`/orders/${order.id}`} className="inline-flex min-h-11 items-center text-amber-900">{order.customerName}</Link></h3>
    <div className="flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-stone-100 px-3 py-1">{ORDER_FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}</span><span className="rounded-full bg-stone-100 px-3 py-1">{ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}</span></div>
    <p>{order.confirmedDeliveryDate ?? "ยังไม่กำหนดวัน"} · <span>{order.confirmedDeliveryTime ?? "ยังไม่กำหนดเวลา"}</span> · {order.deliveryMethodName ?? "ยังไม่กำหนดวิธีส่ง"}</p>
    <p className="text-sm text-stone-700">ยอดรวม {formatSatangAsBaht(order.grandTotalSatang)} บาท · รับแล้ว {formatSatangAsBaht(order.amountPaidSatang)} บาท · คงเหลือ {formatSatangAsBaht(order.balanceSatang)} บาท</p>
    {order.deliveryNote ? <p className="whitespace-pre-wrap text-sm">{order.deliveryNote}</p> : null}
    {order.specialInstructions ? <p className="whitespace-pre-wrap text-sm">{order.specialInstructions}</p> : null}
    {order.items.map(item => packing ? <PackingProgressForm key={item.id} cycleId={cycleId} item={item} /> : <div className="text-sm" key={item.id}><p>{item.productName} · แพ็ก {item.packedQuantity} / {item.quantity}</p>{item.lineNote ? <p>{item.lineNote}</p> : null}</div>)}
    {packing && complete ? <OrderAction cycleId={cycleId} orderId={order.id} action={confirmPackedAction} label="ยืนยันแพ็กครบ" /> : null}
    {writable && order.fulfillmentStatus === "PACKED" ? <OrderAction cycleId={cycleId} orderId={order.id} action={reopenAction} label="เปิดแก้ไขการแพ็ก" /> : null}
    {!writable || order.fulfillmentStatus === "DELIVERED" || order.fulfillmentStatus === "CANCELLED" ? <p className="text-sm text-stone-600">การแพ็กและจัดส่งอ่านอย่างเดียว</p> : null}
  </article>;
}
