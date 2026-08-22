"use client";

import { useActionState, useState } from "react";
import {
  createProductAction,
  type ProductActionState,
} from "@/app/(app)/products/actions";

const INITIAL_STATE: ProductActionState = { error: null, saved: false };

export function ProductForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createProductAction,
    INITIAL_STATE,
  );
  return (
    <section className="grid gap-4">
      <button className="min-h-11 justify-self-start rounded-xl bg-stone-900 px-5 font-semibold text-white" onClick={() => setOpen((value) => !value)} type="button">เพิ่มสินค้า</button>
      {open ? (
        <form action={formAction} className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-stone-700">ชื่อสินค้า<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" name="name" required /></label>
          <label className="grid gap-2 text-sm font-semibold text-stone-700">หน่วยขาย<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue="piece" name="sellingUnit"><option value="piece">ชิ้น</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></label>
          <label className="grid gap-2 text-sm font-semibold text-stone-700">ราคาขาย<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" inputMode="decimal" min="0" name="defaultUnitPriceBaht" required step="0.01" type="number" /></label>
          <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">หมายเหตุ<textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" name="notes" /></label>
          {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2" role="alert">{state.error}</p> : null}
          {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2" aria-live="polite">บันทึกสินค้าแล้ว</p> : null}
          <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกสินค้า"}</button>
        </form>
      ) : null}
    </section>
  );
}
