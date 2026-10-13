"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { confirmOrdersAction, startOrdersAction, deliverOrdersAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import { compareOperationsOrders } from "@/modules/operations/domain/rules";
import type { CycleOperationsView, CycleOperationsHeader, OperationsOrder } from "@/modules/operations/domain/types";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { OperationsOrderCard } from "./operations-order-card";
import { handleOperationsDialogKeyDown } from "./operations-dialog-keyboard";

const INITIAL: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: false };
const buttonClass = "min-h-12 rounded-xl border border-stone-300 bg-white px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-50";
type ReadyView = Extract<CycleOperationsView, { kind: "READY" }>;

function OrderGroup({ orders, cycle, title, label, action, delivery = false, disabled = false }: Readonly<{ orders: readonly OperationsOrder[]; cycle: CycleOperationsHeader; title: string; label: string; action: typeof confirmOrdersAction; delivery?: boolean; disabled?: boolean }>) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const trigger = useRef<HTMLButtonElement>(null); const cancel = useRef<HTMLButtonElement>(null); const confirm = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  // Server-confirmed success resets the selection for every returned state, including repeated saved=true.
  useEffect(() => {
    if (!state.saved) return;
    const timer = window.setTimeout(() => { setSelected(new Set()); setConfirming(false); trigger.current?.focus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);
  const selectedOrders = orders.filter(order => selected.has(order.id));
  const ids = selectedOrders.map(order => order.id).sort();
  const paymentWarning = selectedOrders.filter(order => order.paymentStatus === "UNPAID" || order.paymentStatus === "PARTIAL");
  const blocked = disabled || pending || ids.length === 0 || ids.length > 100;
  function close() { if (!pending) { setConfirming(false); trigger.current?.focus(); } }
  return <section aria-label={title} className="grid gap-4">
    <h2 className="text-xl font-bold">{title}</h2>
    {orders.map(order => <div className="grid gap-2" key={order.id}>
      <label className="flex min-h-12 items-center gap-3 rounded-xl px-2 font-semibold"><input type="checkbox" className="size-6 accent-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800" checked={selected.has(order.id)} disabled={disabled || pending} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(order.id); else next.delete(order.id); setSelected(next); }} />เลือก{delivery ? "จัดส่ง" : label} {order.customerName}</label>
      <OperationsOrderCard cycleId={cycle.id} cycleStatus={cycle.status} order={order} />
    </div>)}
    {disabled ? <p className="text-sm text-stone-600">ต้องเริ่มรอบผลิตก่อน</p> : null}
    {ids.length > 100 ? <p role="alert" className="text-red-800">เลือกได้ครั้งละไม่เกิน 100 ออเดอร์</p> : null}
    <form action={formAction} className="grid gap-3">
      <input name="payload" type="hidden" value={JSON.stringify({ cycleId: cycle.id, orderIds: ids })} />
      <button type={delivery ? "button" : "submit"} ref={trigger} className={buttonClass} disabled={blocked} onClick={delivery ? () => setConfirming(true) : undefined}>{label} {ids.length} ออเดอร์</button>
      {state.error && !confirming ? <p role="alert" className="text-sm text-red-800">{state.error} {state.kind === "STALE_DATA" ? <a className="underline" href={`/cycles/${cycle.id}/operations`}>โหลดข้อมูลล่าสุด</a> : null}</p> : null}
      {confirming ? <div role="dialog" aria-modal="true" aria-labelledby={dialogId} className="fixed inset-0 z-40 grid place-items-center bg-stone-950/40 p-4" onKeyDown={event => handleOperationsDialogKeyDown(event, close)}>
        <div className="grid max-h-[85dvh] w-full max-w-md gap-4 overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
          <h3 id={dialogId} className="text-xl font-bold">ยืนยันส่งสำเร็จ {ids.length} ออเดอร์</h3>
          <ul>{selectedOrders.map(order => <li key={order.id}>{order.customerName} · {order.deliveryMethodName ?? "ยังไม่กำหนดวิธีส่ง"}</li>)}</ul>
          {paymentWarning.length > 0 ? <p className="rounded-xl bg-amber-50 p-3 text-amber-900">ยอดค้าง {paymentWarning.length} ออเดอร์ · {formatSatangAsBaht(paymentWarning.reduce((sum, order) => sum + order.balanceSatang, 0))} บาท · ยังบันทึกยอดชำระหลังส่งได้</p> : null}
          <div className="flex flex-wrap gap-3"><button type="button" ref={cancel} className={buttonClass} disabled={pending} onClick={close}>ยกเลิก</button><button type="submit" ref={confirm} className={buttonClass} disabled={blocked}>ยืนยันจัดส่ง</button></div>
          {state.error ? <p role="alert" className="text-red-800">{state.error} {state.kind === "STALE_DATA" ? <a className="underline" href={`/cycles/${cycle.id}/operations`}>โหลดข้อมูลล่าสุด</a> : null}</p> : null}
        </div>
      </div> : null}
    </form>
  </section>;
}

function ActiveOrders({ view, confirmAction, startAction, deliverAction }: Readonly<{ view: ReadyView; confirmAction: typeof confirmOrdersAction; startAction: typeof startOrdersAction; deliverAction: typeof deliverOrdersAction }>) {
  const orders = view.orders.filter(order => order.fulfillmentStatus !== "CANCELLED").toSorted(compareOperationsOrders);
  const writable = view.cycle.status === "LOCKED" || view.cycle.status === "IN_PRODUCTION";
  if (!writable) return <div className="grid gap-4">{orders.map(order => <OperationsOrderCard key={order.id} order={order} cycleId={view.cycle.id} cycleStatus={view.cycle.status} />)}</div>;
  const group = (status: OperationsOrder["fulfillmentStatus"]) => orders.filter(order => order.fulfillmentStatus === status);
  return <>
    {group("NEW").length ? <OrderGroup orders={group("NEW")} cycle={view.cycle} title="รอยืนยันออเดอร์" label="ยืนยันออเดอร์" action={confirmAction} /> : null}
    {group("CONFIRMED").length ? <OrderGroup orders={group("CONFIRMED")} cycle={view.cycle} title="รอเริ่มทำออเดอร์" label="เริ่มทำออเดอร์" action={startAction} disabled={view.cycle.status !== "IN_PRODUCTION"} /> : null}
    {group("IN_PRODUCTION").length ? <section aria-label="กำลังแพ็ก" className="grid gap-4"><h2 className="text-xl font-bold">กำลังแพ็ก</h2>{group("IN_PRODUCTION").map(order => <OperationsOrderCard key={order.id} order={order} cycleId={view.cycle.id} cycleStatus={view.cycle.status} />)}</section> : null}
    {group("PACKED").length ? <OrderGroup orders={group("PACKED")} cycle={view.cycle} title="พร้อมจัดส่ง" label="ยืนยันส่งสำเร็จ" action={deliverAction} delivery disabled={view.cycle.status !== "IN_PRODUCTION"} /> : null}
    {group("DELIVERED").length ? <section aria-label="ส่งสำเร็จแล้ว" className="grid gap-4"><h2 className="text-xl font-bold">ส่งสำเร็จแล้ว</h2>{group("DELIVERED").map(order => <OperationsOrderCard key={order.id} order={order} cycleId={view.cycle.id} cycleStatus={view.cycle.status} />)}</section> : null}
  </>;
}

export function OperationsOrderBoard({ view, confirmAction = confirmOrdersAction, startAction = startOrdersAction, deliverAction = deliverOrdersAction }: Readonly<{ view: CycleOperationsView; confirmAction?: typeof confirmOrdersAction; startAction?: typeof startOrdersAction; deliverAction?: typeof deliverOrdersAction }>) {
  if (view.kind !== "READY") return null;
  return <section aria-label="เตรียมและแพ็กออเดอร์" className="grid gap-6">
    <h2 className="text-2xl font-bold">เตรียมและแพ็กออเดอร์</h2>
    {view.orders.length === 0 ? <p className="text-stone-600">ไม่มีออเดอร์ที่ต้องดำเนินการ</p> : null}
    <ActiveOrders key={view.cycle.id} view={view} confirmAction={confirmAction} startAction={startAction} deliverAction={deliverAction} />
    <details className="rounded-2xl border border-stone-200 p-4"><summary className="min-h-12 cursor-pointer rounded-xl py-3 font-bold focus-visible:outline-2 focus-visible:outline-amber-800">ออเดอร์ที่ยกเลิก ({view.cancelledOrders.length})</summary><div className="grid gap-4 pt-3">{view.cancelledOrders.toSorted(compareOperationsOrders).map(order => <OperationsOrderCard key={order.id} cycleId={view.cycle.id} cycleStatus={view.cycle.status} order={order} />)}</div></details>
  </section>;
}
