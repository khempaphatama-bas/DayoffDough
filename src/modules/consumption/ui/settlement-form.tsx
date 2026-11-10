"use client";

import Link from "next/link";
import Decimal from "decimal.js";
import { useActionState, useRef, useState } from "react";
import { formatUnitLabel } from "@/modules/units/domain/units";
import { settleUseInputSchema } from "../domain/forms";
import { calculateUseEffect, canonicalQuantity } from "../domain/rules";
import type { ConsumptionActionState, ConsumptionBasis, SettlementPreview } from "../domain/types";

type Props = Readonly<{
  preview: SettlementPreview;
  action: (previous: ConsumptionActionState, data: FormData) => Promise<ConsumptionActionState>;
}>;
type Entry = { inventoryItemId: string; usedQuantity: string; basis: ConsumptionBasis; reason: string };
const INITIAL: ConsumptionActionState = { error: null, fieldErrors: {}, saved: false, stale: false, result: null, blockers: [] };
const INPUT = "min-h-11 w-full min-w-0 max-w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal";
const ExactDecimal = Decimal.clone({ precision: 64 });

function newIntent(preview: SettlementPreview) {
  return {
    preview, requestId: crypto.randomUUID(), confirmed: false, reason: "",
    contexts: preview.contexts.map(row => ({
      ...row.source,
      items: row.items.map((item): Entry => ({ inventoryItemId: item.inventoryItemId, usedQuantity: row.cycle.cycleStatus === "CANCELLED" ? "" : item.usedQuantity ?? "", basis: row.cycle.cycleStatus === "CANCELLED" ? "OWNER_REPORTED" : item.basis, reason: item.reason ?? "" })),
    })),
    counts: preview.counts.map(row => ({ inventoryItemId: row.inventoryItemId, remainingQuantity: "" })),
  };
}
function needsReason(entry: Entry, planned: string) {
  try { const used = canonicalQuantity(entry.usedQuantity); return used === "0" || used !== canonicalQuantity(planned); }
  catch { return false; }
}

export function SettlementSelection({ items, selectedItemIds = [], actionHref, pending = false, onSelectionChange }: Readonly<{
  items: readonly Readonly<{ inventoryItemId: string; inventoryItemName: string }>[];
  selectedItemIds?: readonly string[];
  actionHref?: string;
  pending?: boolean;
  onSelectionChange?: () => void;
}>) {
  const [selection, setSelection] = useState(() => [...selectedItemIds]);
  return <form aria-label="เลือกรายการนับของเหลือ" method="get" action={actionHref} className="grid min-w-0 gap-3 rounded-3xl border border-stone-200 bg-white p-5">
    <input type="hidden" name="mode" value="settle" />
    <fieldset disabled={pending} className="grid min-w-0 gap-3">
      <legend className="font-bold">เลือกรายการที่จะนับของเหลือ</legend>
      <p className="text-sm text-stone-600">ยอดใช้ปกติบันทึกเฉพาะรอบนี้ การนับของเหลือจะแสดงทุกรอบค้างที่เกี่ยวข้องกับรายการที่เลือก พร้อมยอดใช้อื่นทั้งหมดของรอบเหล่านั้น เปลี่ยนรายการนับต้องเปิดตัวอย่างทั้งชุดใหม่ก่อนบันทึก</p>
      {items.map(item => <label key={item.inventoryItemId} className="flex min-h-11 items-center gap-3"><input className="size-5 shrink-0" type="checkbox" name="countItem" value={item.inventoryItemId} checked={selection.includes(item.inventoryItemId)} onChange={event => {
        setSelection(current => event.target.checked ? [...current, item.inventoryItemId] : current.filter(value => value !== item.inventoryItemId));
        onSelectionChange?.();
      }} />นับของเหลือ {item.inventoryItemName}</label>)}
      <button type="submit" disabled={selection.length === 0} className="min-h-12 rounded-xl border border-amber-800 px-4 font-bold text-amber-900 disabled:opacity-60">ดูตัวอย่างและเริ่มรายการนับใหม่</button>
    </fieldset>
  </form>;
}

function SettlementIntentForm({ preview: incoming, action }: Props) {
  // Same selected set does not adopt unsolicited contexts or ledger tokens. Only
  // an explicit GET refresh (document navigation) captures a fresh server preview.
  const [intent, setIntent] = useState(() => newIntent(incoming));
  const [selectionDirty, setSelectionDirty] = useState(false);
  const completed = useRef(new Set<string>());
  const [state, formAction, pending] = useActionState(async (previous: ConsumptionActionState, data: FormData) => {
    const next = await action(previous, data);
    const operationId = next.saved ? next.result?.operationId : undefined;
    if (operationId && !completed.current.has(operationId)) {
      completed.current.add(operationId);
      setIntent(newIntent(intent.preview));
    }
    return next;
  }, INITIAL);
  const preview = intent.preview;
  const selected = new Set(preview.countedItemIds);
  const allItems = preview.contexts.flatMap(row => row.items);
  // Selected stock can have no pending usage of its own. Match the query's
  // touched union without fabricating an item in any immutable context.
  const union = new Set([...preview.countedItemIds, ...allItems.map(row => row.inventoryItemId)]);
  const exactSet = (ids: readonly string[], expected: Set<string>) => ids.length === expected.size && new Set(ids).size === ids.length && ids.every(id => expected.has(id));
  const coherent = selected.size > 0 && selected.size === preview.countedItemIds.length &&
    exactSet(preview.counts.map(row => row.inventoryItemId), selected) &&
    exactSet(preview.expectedLedger.map(row => row.inventoryItemId), union) &&
    exactSet(preview.stock.map(row => row.inventoryItemId), union) &&
    preview.contexts.every(row => row.context.id === row.source.contextId && row.cycle.cycleId === row.source.cycleId && row.cycle.planningSnapshotId === row.source.planningSnapshotId && row.context.currentRevisionId === null && row.items.some(item => selected.has(item.inventoryItemId)));
  const input = {
    requestId: intent.requestId, reason: intent.reason.trim(), expectedLedger: preview.expectedLedger,
    contexts: intent.contexts.map(row => ({ ...row, confirmTakenOutOfUse: intent.confirmed, items: row.items.map(item => ({ ...item, reason: item.reason.trim() || null })) })),
    counts: intent.counts,
  };
  const parsed = settleUseInputSchema.safeParse(input);
  const ready = !selectionDirty && coherent && parsed.success && intent.contexts.every(row => {
    const context = preview.contexts.find(context => context.source.contextId === row.contextId)!;
    return exactSet(row.items.map(item => item.inventoryItemId), new Set(context.items.map(item => item.inventoryItemId))) && row.items.every(entry => {
      const item = context.items.find(item => item.inventoryItemId === entry.inventoryItemId)!;
      return (!needsReason(entry, item.plannedQuantity) || Boolean(entry.reason.trim())) && (context.cycle.cycleStatus !== "CANCELLED" || entry.basis === "OWNER_REPORTED");
    });
  });
  const refreshQuery = new URLSearchParams({ mode: "settle" });
  preview.countedItemIds.forEach(id => refreshQuery.append("countItem", id));
  const refreshHref = `?${refreshQuery}`;
  const labelFor = (id: string) => allItems.find(item => item.inventoryItemId === id)?.inventoryItemName ?? id;
  function update(contextId: string, itemId: string, patch: Partial<Entry>) {
    setIntent(current => ({ ...current, contexts: current.contexts.map(row => row.contextId === contextId ? { ...row, items: row.items.map(item => item.inventoryItemId === itemId ? { ...item, ...patch } : item) } : row) }));
  }
  function errors(path: string) {
    return { "aria-invalid": Boolean(state.fieldErrors[path]), "aria-describedby": state.fieldErrors[path] ? `settle-${path}-error` : undefined };
  }
  function fieldError(path: string) {
    return state.fieldErrors[path] ? <p id={`settle-${path}-error`} className="text-sm text-red-700">{state.fieldErrors[path]}</p> : null;
  }

  if (preview.contexts.length === 0 || !coherent) return (
    <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5">
      <p>{preview.contexts.length === 0 ? "ไม่มีรอบค้างยอดใช้สำหรับรายการที่เลือก ใช้การนับสต๊อกปัจจุบันตามปกติ" : "ข้อมูลตัวอย่างไม่ครบ กรุณาเปิดข้อมูลล่าสุด"}</p>
      {preview.countedItemIds.map((id, index) => <Link className="inline-flex min-h-11 items-center font-bold text-amber-900 underline" href={`/inventory/${id}`} key={`${id}-${index}`}>นับสต๊อกปัจจุบัน {labelFor(id)}</Link>)}
      <a className="inline-flex min-h-11 items-center font-bold underline" href={refreshHref}>เปิดข้อมูลล่าสุดและเริ่มรายการใหม่</a>
    </section>
  );

  return <div className="grid min-w-0 gap-5">
    <SettlementSelection items={[...union].sort().map(id => ({ inventoryItemId: id, inventoryItemName: labelFor(id) }))} selectedItemIds={preview.countedItemIds} pending={pending} onSelectionChange={() => {
      setSelectionDirty(true);
      setIntent(newIntent(preview));
    }} />
    {selectionDirty ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">เปลี่ยนรายการนับแล้ว กรุณาดูตัวอย่างใหม่ ข้อมูลและโทเคนเดิมใช้บันทึกไม่ได้</p> : null}
    <form action={formAction} aria-label="นับของเหลือและเคลียร์ยอดใช้" className="grid min-w-0 gap-4 [overflow-wrap:anywhere]">
      <input type="hidden" name="payload" disabled={selectionDirty} value={JSON.stringify(parsed.success ? parsed.data : input)} />
      <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">ของเหลือคือยอดหลังใช้ทุกรายการด้านล่าง ไม่หักยอดใช้ออกจากของเหลือซ้ำ ตามแผนเป็นประมาณการ ไม่ใช่ยอดใช้จริง ยอดใช้และยอดนับจะบันทึกพร้อมกันทั้งชุดเท่านั้น</p>
      <fieldset disabled={pending || selectionDirty} className="grid min-w-0 gap-4">
        <legend className="sr-only">ยอดใช้ทุกรอบที่เกี่ยวข้องและของเหลือที่เลือกนับ</legend>
        {preview.contexts.map(context => {
          const contextIndex = intent.contexts.findIndex(row => row.contextId === context.source.contextId);
          const draft = intent.contexts[contextIndex]!;
          const cancelled = context.cycle.cycleStatus === "CANCELLED";
          return <section key={context.source.contextId} className="grid min-w-0 gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold"><Link href={`/cycles/${context.source.cycleId}/consumption`} className="inline-flex min-h-11 items-center text-amber-900 underline">{context.cycle.cycleName}</Link> · รุ่น {context.cycle.generation}</h2>
            {cancelled ? <p className="text-sm text-amber-950">รอบยกเลิก ต้องกรอกใช้จริงทุกบรรทัด ไม่คืนสต๊อกตามสถานะ</p> : null}
            {context.items.map(item => {
              const index = draft.items.findIndex(row => row.inventoryItemId === item.inventoryItemId);
              const entry = draft.items[index]!;
              const prefix = `settle-${context.source.contextId}-${item.inventoryItemId}`;
              const path = `contexts.${contextIndex}.items.${index}`;
              let effect: ReturnType<typeof calculateUseEffect> | null = null;
              try { effect = calculateUseEffect({ previousUsed: null, newUsed: entry.usedQuantity, initialCountMovementId: null, currentCountMovementId: null, countSettled: selected.has(item.inventoryItemId) }); } catch { /* Blank/invalid actual stays unresolved. */ }
              return <section key={item.inventoryItemId} aria-label={item.inventoryItemName} className="grid min-w-0 gap-2 rounded-2xl bg-stone-50 p-4">
                <h3 className="text-lg font-bold">{item.inventoryItemName}</h3>
                <p className="text-sm">ตามแผน {item.plannedQuantity} {formatUnitLabel(item.baseUnit)}</p>
                <label htmlFor={`${prefix}-use`} className="text-sm font-semibold">จำนวนใช้ {item.inventoryItemName}</label>
                <input {...errors(`${path}.usedQuantity`)} id={`${prefix}-use`} className={INPUT} required type="text" inputMode="decimal" value={entry.usedQuantity} onChange={event => {
                  const usedQuantity = event.target.value; let basis = entry.basis;
                  try { if (canonicalQuantity(usedQuantity) !== canonicalQuantity(item.plannedQuantity)) basis = "OWNER_REPORTED"; } catch { /* Keep incomplete draft. */ }
                  update(draft.contextId, item.inventoryItemId, { usedQuantity, basis });
                }} />
                {fieldError(`${path}.usedQuantity`)}
                <label htmlFor={`${prefix}-basis`} className="text-sm font-semibold">ที่มาของยอดใช้ {item.inventoryItemName}</label>
                <select {...errors(`${path}.basis`)} id={`${prefix}-basis`} className={INPUT} value={entry.basis} onChange={event => update(draft.contextId, item.inventoryItemId, event.target.value === "PLANNED" ? { basis: "PLANNED", usedQuantity: item.plannedQuantity } : { basis: "OWNER_REPORTED" })}>
                  {!cancelled ? <option value="PLANNED">ตามแผน (ประมาณการ)</option> : null}
                  <option value="OWNER_REPORTED">เจ้าของบันทึกใช้จริง</option>
                </select>
                {fieldError(`${path}.basis`)}
                <label htmlFor={`${prefix}-reason`} className="text-sm font-semibold">เหตุผล {item.inventoryItemName}</label>
                <input {...errors(`${path}.reason`)} id={`${prefix}-reason`} className={INPUT} required={needsReason(entry, item.plannedQuantity)} value={entry.reason} onChange={event => update(draft.contextId, item.inventoryItemId, { reason: event.target.value })} />
                <p className="text-sm text-stone-600">ต้องระบุเหตุผลเมื่อยอดต่างจากแผนหรือเป็นศูนย์</p>
                {fieldError(`${path}.reason`)}
                <p className="text-sm">{effect ? `${effect.mode} · ผลยอดใช้ ${effect.delta}${effect.mode === "COUNT_SETTLED" ? " · รวมอยู่ในยอดนับของเหลือ" : " · ปรับจากสต๊อกปัจจุบัน"}` : "กรอกยอดใช้ที่ถูกต้องเพื่อดูผลสต๊อก"}</p>
              </section>;
            })}
          </section>;
        })}
        {preview.stock.filter(stock => !selected.has(stock.inventoryItemId)).map(stock => {
          let delta: string | null = null;
          try {
            delta = intent.contexts.flatMap(context => context.items).filter(item => item.inventoryItemId === stock.inventoryItemId)
              .reduce((sum, item) => sum.minus(canonicalQuantity(item.usedQuantity)), new ExactDecimal(0)).toFixed();
          } catch { /* All involved lines must resolve before projecting the union. */ }
          return <p key={stock.inventoryItemId} className="rounded-xl bg-blue-50 p-4 text-sm">{delta === null ? `${labelFor(stock.inventoryItemId)} · กรอกยอดใช้ทุกรอบเพื่อดู DIRECT รวม` : `${labelFor(stock.inventoryItemId)} · DIRECT รวม ${delta} · ยอดบัญชี ${stock.balance} → คงเหลือที่เสนอ ${new ExactDecimal(stock.balance).plus(delta).toFixed()}`}</p>;
        })}
        {intent.counts.map((count, index) => {
          const name = labelFor(count.inventoryItemId);
          const stock = preview.stock.find(row => row.inventoryItemId === count.inventoryItemId)!;
          let remaining: string | null = null;
          try { remaining = canonicalQuantity(count.remainingQuantity); } catch { /* Physical count starts blank. */ }
          return <section key={count.inventoryItemId} className="grid min-w-0 gap-2 rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <label htmlFor={`settle-count-${count.inventoryItemId}`} className="font-bold">ของเหลือหลังใช้ {name}</label>
            <p className="text-sm">ยอดบัญชีก่อนนับ {stock.balance} · COUNT จะตั้งยอดเท่าของเหลือหลังใช้</p>
            <input {...errors(`counts.${index}.remainingQuantity`)} id={`settle-count-${count.inventoryItemId}`} className={INPUT} required type="text" inputMode="decimal" value={count.remainingQuantity} onChange={event => setIntent(current => ({ ...current, counts: current.counts.map(row => row.inventoryItemId === count.inventoryItemId ? { ...row, remainingQuantity: event.target.value } : row) }))} />
            {fieldError(`counts.${index}.remainingQuantity`)}
            {remaining !== null ? <p className="text-sm">ยอดหลังนับ {remaining} · ผล COUNT {new ExactDecimal(remaining).minus(stock.balance).toFixed()}</p> : null}
            <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`/inventory/${count.inventoryItemId}`}>นับสต๊อกปัจจุบัน {name} สำหรับการปรับครั้งถัดไป</Link>
          </section>;
        })}
        <label className="flex min-h-11 items-start gap-3 rounded-2xl bg-stone-50 p-4 text-sm"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={intent.confirmed} onChange={event => setIntent(current => ({ ...current, confirmed: event.target.checked }))} />ยืนยันว่าของเหลือเป็นยอดหลังใช้ทุกรายการที่แสดง และผลิตเสร็จแล้ว</label>
        <label htmlFor="settle-reason" className="font-semibold">เหตุผลการนับและเคลียร์ยอดใช้</label>
        <textarea {...errors("reason")} id="settle-reason" className={`${INPUT} min-h-20 py-3`} required value={intent.reason} onChange={event => setIntent(current => ({ ...current, reason: event.target.value }))} />
        {fieldError("reason")}
      </fieldset>
      {state.error || Object.keys(state.fieldErrors).length > 0 ? <div role="alert" className="grid gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-800">
        <p>ยังไม่ได้บันทึกยอดใช้หรือยอดนับทั้งชุด</p><p>{state.error}</p>
        <ul>{Object.entries(state.fieldErrors).map(([path, message]) => <li key={path}>{message}</li>)}</ul>
        {state.stale ? <p>รายการหรือสต๊อกเปลี่ยน กรุณาเปิดข้อมูลล่าสุดเพื่อตรวจทั้งชุดใหม่ ไม่มีการเพิ่มรอบเข้าแบบฟอร์มนี้อัตโนมัติ</p> : null}
        {state.blockers.map(row => <Link className="inline-flex min-h-11 items-center font-bold underline" href={`/cycles/${row.cycleId}/consumption`} key={row.cycleId}>{row.cycleName}</Link>)}
      </div> : null}
      {state.saved && state.result ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">บันทึกยอดใช้ {state.result.revisionIds.length} รอบ และยอดนับ {state.result.countMovementIds.length} รายการแล้ว · ทั้งชุดพร้อมกัน</p> : null}
      <button type="submit" className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={pending || !ready}>{pending ? "กำลังบันทึก…" : "บันทึกยอดใช้และของเหลือพร้อมกัน"}</button>
      {!pending ? <a className="inline-flex min-h-11 items-center font-bold text-amber-900 underline" href={refreshHref}>เปิดข้อมูลล่าสุดและเริ่มรายการใหม่</a> : null}
    </form>
  </div>;
}

export function SettlementForm(props: Props) {
  // Selection is intent identity; order alone is not a new intent.
  return <SettlementIntentForm {...props} key={[...props.preview.countedItemIds].sort().join(":")} />;
}
