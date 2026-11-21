"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useRef, useState } from "react";
import {
  activateRecipeVersionWithFeedbackAction,
  archiveRecipeVersionAction,
  createRecipeVersionAction,
  type ProductActionState,
} from "@/app/(app)/products/actions";
import { isPrepOnly, type IngredientKind } from "@/modules/inventory/domain/ingredient-kind";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type { RecipeVersion } from "@/modules/products/application/products";
import { formatUnitLabel, type UnitCode } from "@/modules/units/domain/units";

type IngredientOption = Readonly<{
  id: string;
  name: string;
  baseUnit: UnitCode;
  ingredientKind: IngredientKind;
}>;

type IngredientRow = Readonly<{
  key: number;
  item: IngredientOption | null;
  quantity: string;
}>;

type EditorProps = Readonly<{
  productId: string;
  defaultYieldUnit: UnitCode;
  ingredientOptions: ReadonlyArray<IngredientOption>;
  initialVersion?: RecipeVersion;
}>;

const INITIAL_STATE: ProductActionState = { error: null, saved: false };
const MAX_INGREDIENTS = 50;
const YIELD_UNITS = ["piece", "mg", "g", "kg", "ml", "l"] as const;
const LABEL_CLASS = "grid min-w-0 gap-2 text-sm font-semibold text-stone-700";
const FIELD_CLASS = "min-h-11 w-full min-w-0 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal";
const SECONDARY_BUTTON = "min-h-11 rounded-xl border border-stone-300 px-4 text-sm font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60";
const ALERT_CLASS = "rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800";

export function RecipeVersionForm(props: EditorProps) {
  const [open, setOpen] = useState(false);
  const visible = open || Boolean(props.initialVersion);
  const panelId = useId();

  return (
    <section className="grid min-w-0 scroll-mt-6 gap-4" id="recipe-editor">
      {props.initialVersion ? (
        <Link className={`${SECONDARY_BUTTON} inline-flex items-center justify-self-start`} href={`/products/${props.productId}#recipe-editor`}>ยกเลิกการใช้ต้นแบบ</Link>
      ) : (
        <button aria-controls={panelId} aria-expanded={visible} className="min-h-11 justify-self-start rounded-xl bg-stone-900 px-5 font-semibold text-white" onClick={() => setOpen((current) => !current)} type="button">
          {visible ? "ปิดแบบฟอร์มสูตร" : "เพิ่มเวอร์ชันสูตร"}
        </button>
      )}
      <div hidden={!visible} id={panelId}>
        {visible ? <RecipeDraft {...props} /> : null}
      </div>
    </section>
  );
}

function RecipeDraft({ productId, defaultYieldUnit, ingredientOptions, initialVersion }: EditorProps) {
  const [draft, setDraft] = useState(() => ({
    versionCode: "",
    baseYieldQuantity: initialVersion?.baseYieldQuantity ?? "",
    yieldUnit: initialVersion?.yieldUnit ?? defaultYieldUnit,
    laborMinutesPerBatch: String(initialVersion?.laborMinutesPerBatch ?? 0),
    utilityCostBahtPerBatch: formatSatangAsBaht(initialVersion?.utilityCostSatangPerBatch ?? 0),
    wasteAllowancePercent: initialVersion?.wasteAllowancePercent ?? "",
    instructions: initialVersion?.instructions ?? "",
  }));
  const [rows, setRows] = useState<IngredientRow[]>(() => initialVersion ? initialVersion.ingredients.map((ingredient, key) => ({
    key,
    item: {
      id: ingredient.inventoryItemId,
      name: ingredient.inventoryItemName,
      baseUnit: ingredient.baseUnit,
      ingredientKind: ingredient.ingredientKind,
    },
    quantity: ingredient.quantityInBaseUnit,
  })) : [{ key: 0, item: null, quantity: "" }]);
  const nextKey = useRef(rows.length);
  const rowId = useId();
  const [state, formAction, pending] = useActionState(createRecipeVersionAction, INITIAL_STATE);
  const optionsById = new Map(ingredientOptions.map((option) => [option.id, option]));
  const hasInactiveRow = rows.some(({ item }) => item && !optionsById.has(item.id));

  function updateDraft<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateRow(key: number, change: (row: IngredientRow) => IngredientRow) {
    setRows((current) => current.map((row) => row.key === key ? change(row) : row));
  }

  return (
    <form className="grid min-w-0 gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2" method="post" onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      // A rejected save must not trigger React's native reset of the draft selects.
      startTransition(() => formAction(data));
    }}>
      <input name="productId" type="hidden" value={productId} />
      <input name="ingredientCount" type="hidden" value={rows.length} />
      {initialVersion ? (
        <p className="break-words rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
          ใช้สูตร {initialVersion.versionCode} เป็นต้นแบบ ตั้งรหัสใหม่เพื่อบันทึกโดยไม่เปลี่ยนสูตรต้นฉบับ
        </p>
      ) : null}
      <label className={LABEL_CLASS}>รหัสเวอร์ชัน<input className={FIELD_CLASS} maxLength={80} name="versionCode" onChange={(event) => updateDraft("versionCode", event.target.value)} required value={draft.versionCode} /></label>
      <label className={LABEL_CLASS}>ผลผลิตต่อสูตร<input className={FIELD_CLASS} inputMode="decimal" min="0.000001" name="baseYieldQuantity" onChange={(event) => updateDraft("baseYieldQuantity", event.target.value)} required step="0.000001" type="number" value={draft.baseYieldQuantity} /></label>
      <label className={LABEL_CLASS}>หน่วยผลผลิต<select className={FIELD_CLASS} name="yieldUnit" onChange={(event) => updateDraft("yieldUnit", event.target.value as UnitCode)} value={draft.yieldUnit}>
        {YIELD_UNITS.map((unit) => <option key={unit} value={unit}>{formatUnitLabel(unit)}</option>)}
      </select></label>
      <label className={LABEL_CLASS}>เวลาแรงงานต่อสูตร (นาที)<input className={FIELD_CLASS} min="0" name="laborMinutesPerBatch" onChange={(event) => updateDraft("laborMinutesPerBatch", event.target.value)} required step="1" type="number" value={draft.laborMinutesPerBatch} /></label>
      <label className={LABEL_CLASS}>ค่าไฟหรือแก๊สต่อสูตร (บาท)<input className={FIELD_CLASS} min="0" name="utilityCostBahtPerBatch" onChange={(event) => updateDraft("utilityCostBahtPerBatch", event.target.value)} required step="0.01" type="number" value={draft.utilityCostBahtPerBatch} /></label>
      <label className={LABEL_CLASS}>ค่าเผื่อสูญเสีย (%)<input className={FIELD_CLASS} max="100" min="0" name="wasteAllowancePercent" onChange={(event) => updateDraft("wasteAllowancePercent", event.target.value)} step="0.0001" type="number" value={draft.wasteAllowancePercent} /></label>

      <fieldset className="grid min-w-0 gap-4 rounded-2xl border border-stone-200 p-4 md:col-span-2">
        <legend className="px-2 font-bold text-stone-900">วัตถุดิบในสูตร</legend>
        {ingredientOptions.length === 0 ? (
          <p className="text-sm text-amber-900">ยังไม่มีวัตถุดิบให้เลือก กรุณาเพิ่มวัตถุดิบในหน้าคลังสินค้าก่อนบันทึก</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-amber-900">กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ</p>
        ) : rows.length > MAX_INGREDIENTS ? (
          <p className="text-sm text-amber-900">กรุณาลดจำนวนรายการวัตถุดิบให้เหลือไม่เกิน {MAX_INGREDIENTS} รายการ</p>
        ) : null}
        {rows.map(({ key, item, quantity }, index) => {
          const unavailable = item !== null && !optionsById.has(item.id);
          const hintId = `${rowId}-${key}`;
          return (
            <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" key={key}>
              <label className={LABEL_CLASS}>วัตถุดิบ {index + 1}
                <select aria-describedby={unavailable ? hintId : undefined} className={FIELD_CLASS} name={`ingredientId_${index}`} onChange={(event) => {
                  const nextItem = optionsById.get(event.target.value) ?? null;
                  updateRow(key, (row) => ({
                    ...row,
                    item: nextItem,
                    quantity: row.item && row.item.baseUnit !== nextItem?.baseUnit ? "" : row.quantity,
                  }));
                }} required value={item?.id ?? ""}>
                  <option disabled value="">เลือกวัตถุดิบ</option>
                  {unavailable ? <option disabled value={item.id}>{item.name} ({formatUnitLabel(item.baseUnit)}) · ปิดใช้งาน</option> : null}
                  {ingredientOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({formatUnitLabel(option.baseUnit)})</option>)}
                </select>
              </label>
              <label className={LABEL_CLASS}>ปริมาณวัตถุดิบ {index + 1}
                <input aria-describedby={item ? hintId : undefined} className={FIELD_CLASS} inputMode="decimal" min="0.000001" name={`ingredientQuantity_${index}`} onChange={(event) => {
                  const value = event.target.value;
                  updateRow(key, (row) => ({ ...row, quantity: value }));
                }} required step="0.000001" type="number" value={quantity} />
              </label>
              <input name={`ingredientBaseUnit_${index}`} type="hidden" value={item?.baseUnit ?? ""} />
              <input name={`ingredientKind_${index}`} type="hidden" value={item?.ingredientKind ?? ""} />
              <button aria-label={`ลบวัตถุดิบ ${index + 1}`} className={`${SECONDARY_BUTTON} self-end justify-self-start`} onClick={() => setRows((current) => current.filter((row) => row.key !== key))} type="button">ลบ</button>
              {item ? (
                <p className={`text-xs md:col-span-full ${unavailable ? "text-amber-900" : "text-stone-600"}`} id={hintId}>
                  หน่วยที่ใช้ในสูตร: {formatUnitLabel(item.baseUnit)}
                  {isPrepOnly(item.ingredientKind) ? " · ไม่คิดต้นทุนและไม่ต้องนับสต๊อก" : ""}
                  {unavailable ? " · วัตถุดิบนี้ปิดใช้งานแล้ว กรุณาเลือกวัตถุดิบอื่นแทนหรือลบรายการนี้" : ""}
                </p>
              ) : null}
            </div>
          );
        })}
        <button className={`${SECONDARY_BUTTON} justify-self-start`} disabled={rows.length >= MAX_INGREDIENTS || ingredientOptions.length === 0} onClick={() => {
          const key = nextKey.current++;
          setRows((current) => [...current, { key, item: null, quantity: "" }]);
        }} type="button">เพิ่มวัตถุดิบ</button>
      </fieldset>

      <label className={`${LABEL_CLASS} md:col-span-2`}>วิธีทำ<textarea className={`${FIELD_CLASS} min-h-32 py-3`} maxLength={20000} name="instructions" onChange={(event) => updateDraft("instructions", event.target.value)} value={draft.instructions} /></label>
      {state.error ? <p className={`${ALERT_CLASS} md:col-span-2`} role="alert">{state.error}</p> : null}
      {state.saved ? (
        <div className="break-words rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2" role="status">
          <p>บันทึกเวอร์ชันสูตรแล้ว ยังไม่ได้เปิดใช้งาน</p>
          {state.archivedVersionCodes?.map((code) => <p key={code}>สูตร {code} ถูกย้ายไปที่ประวัติ</p>)}
        </div>
      ) : null}
      <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2" disabled={pending || hasInactiveRow || rows.length === 0 || rows.length > MAX_INGREDIENTS || ingredientOptions.length === 0} type="submit">
        {pending ? "กำลังบันทึก…" : "บันทึกเวอร์ชันสูตร"}
      </button>
    </form>
  );
}

export function RecipeVersionControls({ productId, versionId }: Readonly<{ productId: string; versionId: string }>) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [activation, activate, activating] = useActionState(activateRecipeVersionWithFeedbackAction, INITIAL_STATE);
  const [archive, archiveVersion, archiving] = useActionState(archiveRecipeVersionAction, INITIAL_STATE);
  const pending = activating || archiving;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <form action={activate} onSubmit={(event) => {
          if (!window.confirm("ยืนยันเปิดใช้เวอร์ชันสูตรนี้?")) event.preventDefault();
        }}>
          <input name="productId" type="hidden" value={productId} />
          <input name="versionId" type="hidden" value={versionId} />
          <button className={`${SECONDARY_BUTTON} border-amber-800 text-amber-900 hover:bg-amber-50`} disabled={pending} type="submit">
            {activating ? "กำลังเปิดใช้…" : "เปิดใช้เวอร์ชันนี้"}
          </button>
        </form>
        {!confirmArchive ? <button className={SECONDARY_BUTTON} disabled={pending} onClick={() => setConfirmArchive(true)} type="button">เก็บเข้าประวัติ</button> : null}
      </div>
      {activation.error ? <p className={ALERT_CLASS} role="alert">{activation.error}</p> : null}
      {confirmArchive ? (
        <form action={archiveVersion} className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input name="productId" type="hidden" value={productId} />
          <input name="versionId" type="hidden" value={versionId} />
          <p>สูตรนี้ยังเปิดอ่านได้ในประวัติ แต่จะเลือกเปิดใช้งานไม่ได้</p>
          <div className="flex flex-wrap gap-2">
            <button className="min-h-11 rounded-xl bg-amber-800 px-4 font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">
              {archiving ? "กำลังเก็บเข้าประวัติ…" : "ยืนยันเก็บเข้าประวัติ"}
            </button>
            <button className={SECONDARY_BUTTON} disabled={pending} onClick={() => setConfirmArchive(false)} type="button">ยกเลิก</button>
          </div>
          {archive.error ? <p className={ALERT_CLASS} role="alert">{archive.error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
