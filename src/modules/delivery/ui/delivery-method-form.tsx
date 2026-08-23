"use client";

import {
  startTransition,
  useActionState,
  useState,
  type FormEvent,
} from "react";
import {
  createDeliveryMethodAction,
  type DeliveryActionState,
  updateDeliveryMethodAction,
} from "@/app/(app)/delivery/actions";
import { formatSatangAsBaht } from "@/modules/money/domain/money";

const INITIAL_STATE: DeliveryActionState = { error: null, saved: false };

export function DeliveryMethodForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createDeliveryMethodAction,
    INITIAL_STATE,
  );
  function submitMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }
  return (
    <section className="grid gap-4">
      <button className="min-h-11 justify-self-start rounded-xl bg-stone-900 px-5 font-semibold text-white" onClick={() => setOpen((value) => !value)} type="button">เพิ่มวิธีส่ง</button>
      {open ? <form className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2" onSubmit={submitMethod}>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">ชื่อวิธีส่ง<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" name="name" required /></label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">ค่าส่งที่เรียกเก็บ<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" min="0" name="customerFeeBaht" required step="0.01" type="number" /></label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">ต้นทุนขนส่ง<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" min="0" name="internalCostBaht" required step="0.01" type="number" /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-stone-700">
          <input defaultChecked name="requiresDeliveryLocation" type="checkbox" />
          ต้องระบุสถานที่จัดส่ง
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">หมายเหตุ<textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" name="notes" /></label>
        {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2" role="alert">{state.error}</p> : null}
        {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2" aria-live="polite">บันทึกวิธีส่งแล้ว</p> : null}
        <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกวิธีส่ง"}</button>
      </form> : null}
    </section>
  );
}

export function DeliveryMethodEditForm({ method }: Readonly<{ method: { id: string; name: string; defaultCustomerFeeSatang: number; defaultInternalCostSatang: number; requiresDeliveryLocation: boolean; active: boolean; notes: string | null } }>) {
  const [state, formAction, pending] = useActionState(
    updateDeliveryMethodAction,
    INITIAL_STATE,
  );
  function submitMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }
  return <form className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5" onSubmit={submitMethod}>
    <input name="methodId" type="hidden" value={method.id} />
    <label className="grid gap-2 text-sm font-semibold text-stone-700">ชื่อวิธีส่ง<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={method.name} name="name" required /></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold text-stone-700">ค่าส่งที่เรียกเก็บ<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={formatSatangAsBaht(method.defaultCustomerFeeSatang)} min="0" name="customerFeeBaht" required step="0.01" type="number" /></label><label className="grid gap-2 text-sm font-semibold text-stone-700">ต้นทุนขนส่ง<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={formatSatangAsBaht(method.defaultInternalCostSatang)} min="0" name="internalCostBaht" required step="0.01" type="number" /></label></div>
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-stone-700"><input defaultChecked={method.requiresDeliveryLocation} name="requiresDeliveryLocation" type="checkbox" /> ต้องระบุสถานที่จัดส่ง</label>
    <label className="grid gap-2 text-sm font-semibold text-stone-700">หมายเหตุ<textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" defaultValue={method.notes ?? ""} name="notes" /></label>
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-stone-700"><input defaultChecked={method.active} name="active" type="checkbox" /> เปิดใช้งาน</label>
    {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p> : null}{state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800" aria-live="polite">บันทึกการแก้ไขแล้ว</p> : null}
    <button className="min-h-11 rounded-xl border border-stone-800 px-4 font-semibold disabled:opacity-60" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : `บันทึกการแก้ไข ${method.name}`}</button>
  </form>;
}
