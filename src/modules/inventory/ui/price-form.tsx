"use client";

import { useActionState } from "react";
import {
  addInventoryPriceAction,
  recordInventoryCountAction,
  type InventoryActionState,
} from "@/app/(app)/inventory/actions";

const INITIAL_STATE: InventoryActionState = { error: null, saved: false };

export function PriceForm({
  itemId,
  packBaseQuantity,
  defaultDate,
}: Readonly<{ itemId: string; packBaseQuantity: string; defaultDate: string }>) {
  const [state, formAction, pending] = useActionState(
    addInventoryPriceAction,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-stone-900">เพิ่มราคาซื้อ</h2>
      <input name="itemId" type="hidden" value={itemId} />
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ราคาต่อแพ็ก
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" inputMode="decimal" min="0" name="packPriceBaht" required step="0.01" type="number" />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ปริมาณฐานในแพ็ก
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={packBaseQuantity} inputMode="decimal" min="0.000001" name="packBaseQuantity" required step="0.000001" type="number" />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        วันที่มีผล
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={defaultDate} name="effectiveDate" required type="date" />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ซื้อจาก
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" name="purchasedFrom" />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        หมายเหตุราคา
        <textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" name="notes" />
      </label>
      {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p> : null}
      {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800" aria-live="polite">บันทึกราคาแล้ว</p> : null}
      <button className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกราคา"}</button>
    </form>
  );
}

export function PhysicalCountForm({ itemId }: Readonly<{ itemId: string }>) {
  const [state, formAction, pending] = useActionState(
    recordInventoryCountAction,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-stone-900">นับสต๊อกจริง</h2>
      <input name="itemId" type="hidden" value={itemId} />
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        จำนวนที่นับได้
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" inputMode="decimal" min="0" name="countedQuantity" required step="0.000001" type="number" />
      </label>
      {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p> : null}
      {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800" aria-live="polite">อัปเดตยอดสต๊อกแล้ว</p> : null}
      <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกยอดนับ"}</button>
    </form>
  );
}
