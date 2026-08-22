"use client";

import { useActionState, useState } from "react";
import {
  createPackagingRuleAction,
  type DeliveryActionState,
} from "@/app/(app)/delivery/actions";

type Option = Readonly<{ id: string; name: string }>;
type PackagingOption = Option & Readonly<{ baseUnit: string }>;

const INITIAL_STATE: DeliveryActionState = { error: null, saved: false };

export function PackagingRuleForm({
  products,
  deliveryMethods,
  packagingItems,
}: Readonly<{
  products: ReadonlyArray<Option>;
  deliveryMethods: ReadonlyArray<Option>;
  packagingItems: ReadonlyArray<PackagingOption>;
}>) {
  const [scope, setScope] = useState<"PRODUCT" | "DELIVERY_METHOD">("PRODUCT");
  const [state, formAction, pending] = useActionState(
    createPackagingRuleAction,
    INITIAL_STATE,
  );
  const missingTarget = scope === "PRODUCT" ? products.length === 0 : deliveryMethods.length === 0;

  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2">
      <h2 className="text-xl font-bold text-stone-900 md:col-span-2">เพิ่มกฎบรรจุภัณฑ์</h2>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">ขอบเขตกฎ<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" name="scope" onChange={(event) => setScope(event.target.value as "PRODUCT" | "DELIVERY_METHOD")} value={scope}><option value="PRODUCT">สินค้า</option><option value="DELIVERY_METHOD">วิธีส่ง</option></select></label>
      {scope === "PRODUCT" ? (
        <label className="grid gap-2 text-sm font-semibold text-stone-700">สินค้า<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue="" name="productId" required><option disabled value="">เลือกสินค้า</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      ) : (
        <label className="grid gap-2 text-sm font-semibold text-stone-700">วิธีส่ง<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue="" name="deliveryMethodId" required><option disabled value="">เลือกวิธีส่ง</option>{deliveryMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
      )}
      <label className="grid gap-2 text-sm font-semibold text-stone-700">รายการบรรจุภัณฑ์<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue="" name="inventoryItemId" required><option disabled value="">เลือกบรรจุภัณฑ์</option>{packagingItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.baseUnit})</option>)}</select></label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">วิธีคิดจำนวน<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" key={scope} name="consumptionBasis" defaultValue={scope === "PRODUCT" ? "PER_PRODUCT_UNIT" : "PER_DELIVERY"}>{scope === "PRODUCT" ? <><option value="PER_PRODUCT_UNIT">ต่อหน่วยสินค้า</option><option value="PER_ORDER">ต่อออเดอร์ที่มีสินค้านี้</option></> : <option value="PER_DELIVERY">ต่อการจัดส่ง</option>}</select></label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">จำนวนที่ใช้<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" inputMode="decimal" min="0.000001" name="quantityInBaseUnit" required step="0.000001" type="number" /></label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">หมายเหตุ<textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" name="notes" /></label>
      {missingTarget || packagingItems.length === 0 ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">ต้องมี{scope === "PRODUCT" ? "สินค้า" : "วิธีส่ง"}และรายการบรรจุภัณฑ์ก่อนเพิ่มกฎ</p> : null}
      {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2" role="alert">{state.error}</p> : null}
      {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2" aria-live="polite">บันทึกกฎบรรจุภัณฑ์แล้ว</p> : null}
      <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2" disabled={pending || missingTarget || packagingItems.length === 0} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกกฎบรรจุภัณฑ์"}</button>
    </form>
  );
}
