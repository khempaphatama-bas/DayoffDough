"use client";

import { useActionState, useState } from "react";
import {
  createRecipeVersionAction,
  type ProductActionState,
} from "@/app/(app)/products/actions";

type IngredientOption = Readonly<{
  id: string;
  name: string;
  baseUnit: string;
}>;

const INITIAL_STATE: ProductActionState = { error: null, saved: false };

export function RecipeVersionForm({
  productId,
  defaultYieldUnit,
  ingredientOptions,
}: Readonly<{
  productId: string;
  defaultYieldUnit: string;
  ingredientOptions: ReadonlyArray<IngredientOption>;
}>) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([0]);
  const [state, formAction, pending] = useActionState(
    createRecipeVersionAction,
    INITIAL_STATE,
  );

  return (
    <section className="grid gap-4">
      <button className="min-h-11 justify-self-start rounded-xl bg-stone-900 px-5 font-semibold text-white" onClick={() => setOpen((value) => !value)} type="button">เพิ่มเวอร์ชันสูตร</button>
      {open ? (
        ingredientOptions.length === 0 ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">ต้องเพิ่มวัตถุดิบประเภทวัตถุดิบก่อนสร้างสูตร</p>
        ) : (
          <form action={formAction} className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2">
            <input name="productId" type="hidden" value={productId} />
            <input name="ingredientCount" type="hidden" value={rows.length} />
            <label className="grid gap-2 text-sm font-semibold text-stone-700">รหัสเวอร์ชัน<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" name="versionCode" required /></label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">ผลผลิตต่อสูตร<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" inputMode="decimal" min="0.000001" name="baseYieldQuantity" required step="0.000001" type="number" /></label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">หน่วยผลผลิต<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue={defaultYieldUnit} name="yieldUnit"><option value="piece">ชิ้น</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">เวลาแรงงานต่อสูตร (นาที)<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue="0" min="0" name="laborMinutesPerBatch" required step="1" type="number" /></label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">ค่าไฟหรือแก๊สต่อสูตร (บาท)<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue="0.00" min="0" name="utilityCostBahtPerBatch" required step="0.01" type="number" /></label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">ค่าเผื่อสูญเสีย (%)<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" max="100" min="0" name="wasteAllowancePercent" step="0.0001" type="number" /></label>

            <fieldset className="grid gap-4 rounded-2xl border border-stone-200 p-4 md:col-span-2">
              <legend className="px-2 font-bold text-stone-900">วัตถุดิบในสูตร</legend>
              {rows.map((row, index) => (
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" key={row}>
                  <label className="grid gap-2 text-sm font-semibold text-stone-700">วัตถุดิบ {index + 1}<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue="" name={`ingredientId_${index}`} required><option disabled value="">เลือกวัตถุดิบ</option>{ingredientOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.baseUnit})</option>)}</select></label>
                  <label className="grid gap-2 text-sm font-semibold text-stone-700">ปริมาณวัตถุดิบ {index + 1}<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" inputMode="decimal" min="0.000001" name={`ingredientQuantity_${index}`} required step="0.000001" type="number" /></label>
                  {rows.length > 1 ? <button aria-label={`ลบวัตถุดิบ ${index + 1}`} className="min-h-11 self-end rounded-xl border border-stone-300 px-3 text-sm font-semibold" onClick={() => setRows((current) => current.filter((value) => value !== row))} type="button">ลบ</button> : null}
                </div>
              ))}
              <button className="min-h-11 justify-self-start rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => setRows((current) => [...current, Math.max(...current) + 1])} type="button">เพิ่มวัตถุดิบ</button>
            </fieldset>

            <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">วิธีทำ<textarea className="min-h-32 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" name="instructions" /></label>
            {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2" role="alert">{state.error}</p> : null}
            {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2" aria-live="polite">บันทึกเวอร์ชันสูตรแล้ว</p> : null}
            <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกเวอร์ชันสูตร"}</button>
          </form>
        )
      ) : null}
    </section>
  );
}
