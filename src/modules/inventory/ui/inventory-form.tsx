"use client";

import { startTransition, useActionState, useState } from "react";
import type { InventoryActionState } from "@/app/(app)/inventory/actions";
import type { InventoryItem } from "@/modules/inventory/application/inventory";
import { isPrepOnly, type IngredientKind } from "@/modules/inventory/domain/ingredient-kind";
import { formatUnitLabel, type UnitCode } from "@/modules/units/domain/units";

type ItemAction = (previous: InventoryActionState, formData: FormData) => Promise<InventoryActionState>;
type EditPolicy = Readonly<{ canChangeIdentity: boolean; canChangePack: boolean }>;
type Draft = Pick<InventoryItem, "name" | "category" | "ingredientKind" | "baseUnit" |
  "purchaseUnitLabel" | "baseQuantityPerPurchasePack" | "minimumStockQuantity"> & { notes: string };

const INITIAL_STATE: InventoryActionState = { error: null, saved: false };
const UNITS: Record<IngredientKind, readonly UnitCode[]> = {
  STANDARD: ["mg", "g", "kg", "ml", "l", "piece"],
  WATER: ["ml", "l"],
  ICE: ["g", "kg"],
};
const EMPTY_DRAFT: Draft = {
  name: "", category: "INGREDIENT", ingredientKind: "STANDARD", baseUnit: "g",
  purchaseUnitLabel: "", baseQuantityPerPurchasePack: "", minimumStockQuantity: "0", notes: "",
};
const LABEL = "grid gap-2 text-sm font-semibold text-stone-700";
const INPUT = "min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal disabled:bg-stone-100 disabled:text-stone-600";
const ERROR = "rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800";

export function InventoryForm({ action, initialItem, editPolicy }: Readonly<{
  action: ItemAction;
  initialItem?: InventoryItem;
  editPolicy?: EditPolicy;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const initial = initialItem ? {
    ...initialItem,
    notes: initialItem.notes ?? "",
    // Prep-only pack defaults are internal placeholders, not a purchase pack for a standard item.
    ...(isPrepOnly(initialItem.ingredientKind) ? { purchaseUnitLabel: "", baseQuantityPerPurchasePack: "" } : {}),
  } : EMPTY_DRAFT;
  const identityLocked = editPolicy?.canChangeIdentity === false;
  const packLocked = editPolicy?.canChangePack === false;
  // A save elsewhere can lock fields while this draft is still open. Submit the latest locked values,
  // and never carry quantities entered under a different unit into the restored unit.
  const unitRestored = identityLocked && draft !== null && draft.baseUnit !== initial.baseUnit;
  const canonicalFields: Partial<Draft> = {
    ...(identityLocked ? { category: initial.category, ingredientKind: initial.ingredientKind, baseUnit: initial.baseUnit } : {}),
    ...(packLocked ? { purchaseUnitLabel: initial.purchaseUnitLabel } : {}),
    ...(packLocked || unitRestored ? { baseQuantityPerPurchasePack: initial.baseQuantityPerPurchasePack } : {}),
    ...(unitRestored ? { minimumStockQuantity: initial.minimumStockQuantity } : {}),
  };
  const fields = { ...(draft ?? initial), ...canonicalFields };
  const prepOnly = isPrepOnly(fields.ingredientKind);
  const categoryLocked = identityLocked || prepOnly;
  const [state, formAction, pending] = useActionState(async (previous: InventoryActionState, data: FormData) => {
    const result = await action(previous, data);
    if (result.saved && !initialItem) setDraft(null);
    return result;
  }, INITIAL_STATE);

  function change(patch: Partial<Draft>) {
    setDraft((current) => ({ ...(current ?? initial), ...canonicalFields, ...patch }));
  }

  function changeKind(ingredientKind: IngredientKind) {
    if (ingredientKind === fields.ingredientKind) return;
    change({
      ingredientKind,
      ...(ingredientKind === "STANDARD"
        ? { baseUnit: "g" }
        : { category: "INGREDIENT", baseUnit: ingredientKind === "WATER" ? "ml" : "g" }),
    });
  }

  return (
    <section className="grid gap-4">
      {initialItem ? <h2 className="text-xl font-bold text-stone-900">แก้ไขรายการ</h2> : (
        <button aria-expanded={open} className="min-h-11 justify-self-start rounded-xl bg-stone-900 px-5 font-semibold text-white" onClick={() => setOpen((value) => !value)} type="button">
          เพิ่มรายการ
        </button>
      )}
      {open || initialItem ? (
        <form className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2" method="post" onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const data = new FormData(event.currentTarget);
          // React's automatic form reset would reset even controlled selects after an action error.
          startTransition(() => formAction(data));
        }}>
          {initialItem ? <input name="itemId" type="hidden" value={initialItem.id} /> : null}
          <label className={LABEL}>
            ชื่อรายการ
            <input className={INPUT} name="name" onChange={(event) => change({ name: event.target.value })} required value={fields.name} />
          </label>
          <label className={LABEL}>
            ชนิดวัตถุดิบ
            <select className={INPUT} disabled={identityLocked} name="ingredientKind" onChange={(event) => changeKind(event.target.value as IngredientKind)} value={fields.ingredientKind}>
              <option value="STANDARD">ทั่วไป</option>
              <option value="WATER">น้ำ</option>
              <option value="ICE">น้ำแข็ง</option>
            </select>
          </label>
          <label className={LABEL}>
            ประเภท
            <select className={INPUT} disabled={categoryLocked} name="category" onChange={(event) => change({ category: event.target.value as Draft["category"] })} value={fields.category}>
              <option value="INGREDIENT">วัตถุดิบ</option>
              <option value="PACKAGING">บรรจุภัณฑ์</option>
              <option value="CONSUMABLE">วัสดุสิ้นเปลือง</option>
            </select>
          </label>
          <label className={LABEL}>
            หน่วยฐาน
            <select className={INPUT} disabled={identityLocked} name="baseUnit" onChange={(event) => change({ baseUnit: event.target.value as UnitCode })} value={fields.baseUnit}>
              {UNITS[fields.ingredientKind].map((unit) => <option key={unit} value={unit}>{unit === "l" ? "L" : formatUnitLabel(unit)}</option>)}
            </select>
          </label>
          {categoryLocked ? <input name="category" type="hidden" value={fields.category} /> : null}
          {identityLocked ? <>
            <input name="ingredientKind" type="hidden" value={fields.ingredientKind} />
            <input name="baseUnit" type="hidden" value={fields.baseUnit} />
            <p className="text-sm text-stone-600 md:col-span-2">รายการนี้ถูกใช้งานแล้ว หากต้องการเปลี่ยนหน่วยฐาน ประเภท หรือชนิด ให้เพิ่มรายการใหม่แทน</p>
          </> : null}
          {unitRestored && !prepOnly ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 md:col-span-2" role="status">หน่วยฐานถูกล็อก จึงคืนค่าปริมาณต่อแพ็กและสต๊อกขั้นต่ำตามหน่วยเดิม กรุณาตรวจสอบก่อนบันทึก</p> : null}
          {prepOnly ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 md:col-span-2">ไม่คิดต้นทุนและไม่ต้องนับสต๊อก</p>
          ) : <>
            <label className={LABEL}>
              ชื่อหน่วยซื้อ
              <input className={INPUT} disabled={packLocked} name="purchaseUnitLabel" onChange={(event) => change({ purchaseUnitLabel: event.target.value })} required value={fields.purchaseUnitLabel} />
            </label>
            <label className={LABEL}>
              ปริมาณต่อแพ็ก
              <input className={INPUT} disabled={packLocked} inputMode="decimal" min="0.000001" name="baseQuantityPerPurchasePack" onChange={(event) => change({ baseQuantityPerPurchasePack: event.target.value })} required step="0.000001" type="number" value={fields.baseQuantityPerPurchasePack} />
            </label>
            {packLocked ? <>
              <input name="purchaseUnitLabel" type="hidden" value={fields.purchaseUnitLabel} />
              <input name="baseQuantityPerPurchasePack" type="hidden" value={fields.baseQuantityPerPurchasePack} />
              <p className="text-sm text-stone-600 md:col-span-2">กรุณาจบรอบผลิตที่ใช้ขนาดแพ็กนี้ก่อนเปลี่ยนข้อมูลแพ็ก</p>
            </> : null}
            <label className={LABEL}>
              สต๊อกขั้นต่ำ
              <input className={INPUT} inputMode="decimal" min="0" name="minimumStockQuantity" onChange={(event) => change({ minimumStockQuantity: event.target.value })} required step="0.000001" type="number" value={fields.minimumStockQuantity} />
            </label>
          </>}
          <label className={`${LABEL} md:col-span-2`}>
            หมายเหตุ
            <textarea className="min-h-24 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" name="notes" onChange={(event) => change({ notes: event.target.value })} value={fields.notes} />
          </label>
          {state.error ? <p className={`${ERROR} md:col-span-2`} role="alert">{state.error}</p> : null}
          {state.saved ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2" aria-live="polite">บันทึกรายการแล้ว</p> : null}
          <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2" disabled={pending} type="submit">
            {pending ? "กำลังบันทึก…" : "บันทึกรายการ"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function ArchiveInventoryForm({ action, itemId }: Readonly<{ action: ItemAction; itemId: string }>) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      {state.saved ? <p aria-live="polite" className="text-sm text-stone-700">ปิดใช้งานรายการแล้ว</p> : confirming ? (
        <form action={formAction} className="grid gap-3">
          <input name="itemId" type="hidden" value={itemId} />
          <p className="text-sm text-stone-700">รายการนี้จะไม่อยู่ในตัวเลือกใหม่ แต่ยังเปิดดูประวัติได้ ต้องการปิดใช้งานหรือไม่?</p>
          <div className="flex flex-wrap gap-3">
            <button className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold disabled:opacity-60" disabled={pending} onClick={() => setConfirming(false)} type="button">ยกเลิก</button>
            <button className="min-h-11 rounded-xl bg-red-800 px-4 font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "กำลังปิดใช้งาน…" : "ยืนยันปิดใช้งาน"}</button>
          </div>
        </form>
      ) : (
        <button className="min-h-11 justify-self-start rounded-xl border border-red-200 px-4 font-semibold text-red-800" onClick={() => setConfirming(true)} type="button">ปิดใช้งาน</button>
      )}
      {state.error ? <p className={ERROR} role="alert">{state.error}</p> : null}
    </section>
  );
}
