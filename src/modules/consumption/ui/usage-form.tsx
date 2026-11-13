"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { formatUnitLabel } from "@/modules/units/domain/units";
import { confirmUseInputSchema, correctUseInputSchema } from "../domain/forms";
import { calculateUseEffect, canonicalQuantity } from "../domain/rules";
import type { ConsumptionActionState, ConsumptionBasis, CycleConsumptionView } from "../domain/types";

type Props = Readonly<{
  view: CycleConsumptionView;
  mode: "CONFIRM" | "CORRECT";
  action: (previous: ConsumptionActionState, data: FormData) => Promise<ConsumptionActionState>;
}>;
type Entry = { inventoryItemId: string; usedQuantity: string; basis: ConsumptionBasis; reason: string };
const INITIAL_STATE: ConsumptionActionState = { error: null, fieldErrors: {}, saved: false, stale: false, result: null, blockers: [] };
const INPUT = "min-h-11 w-full min-w-0 max-w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal";

function newIntent(view: CycleConsumptionView) {
  return {
    requestId: crypto.randomUUID(),
    entries: view.items.map((item): Entry => ({ inventoryItemId: item.inventoryItemId, usedQuantity: item.usedQuantity ?? "", basis: item.basis, reason: item.reason ?? "" })),
    confirmed: false, empty: false, reason: "",
  };
}
function needsReason(entry: Entry, planned: string): boolean {
  try {
    const used = canonicalQuantity(entry.usedQuantity);
    return used === "0" || used !== canonicalQuantity(planned);
  } catch { return false; }
}

function UsageIntentForm({ view, mode, action }: Props) {
  const formElement = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formElement.current;
    if (!form) return;
    // React resets native controls during commit while delegated events are off.
    // Only a new successful receipt resets this fully controlled intent below.
    const preserveIntent = (event: Event) => event.preventDefault();
    form.addEventListener("reset", preserveIntent);
    return () => form.removeEventListener("reset", preserveIntent);
  }, []);
  const [intent, setIntent] = useState(() => newIntent(view));
  const completedOperations = useRef(new Set<string>());
  const [state, formAction, pending] = useActionState(async (previous: ConsumptionActionState, data: FormData) => {
    const next = await action(previous, data);
    const operationId = next.saved ? next.result?.operationId : undefined;
    // Only a newly returned immutable receipt completes this intent. Rerenders and
    // an old replay cannot consume a new UUID; failures keep the entire draft.
    if (operationId && !completedOperations.current.has(operationId)) {
      completedOperations.current.add(operationId);
      setIntent(newIntent(view));
    }
    return next;
  }, INITIAL_STATE);
  const cancelled = view.cycle.cycleStatus === "CANCELLED";
  const input = {
    ...view.source!, requestId: intent.requestId,
    items: intent.entries.map((entry) => ({ ...entry, reason: entry.reason.trim() || null })),
    expectedLedger: view.expectedLedger,
    ...(mode === "CONFIRM"
      ? { confirmTakenOutOfUse: intent.confirmed, confirmEmpty: intent.empty, reason: intent.reason.trim() || null }
      : { expectedRevisionId: view.currentRevision!.id, reason: intent.reason.trim() }),
  };
  const parsed = (mode === "CONFIRM" ? confirmUseInputSchema : correctUseInputSchema).safeParse(input);
  const ready = parsed.success && intent.entries.every((entry, index) =>
    (!needsReason(entry, view.items[index]!.plannedQuantity) || Boolean(entry.reason.trim())) &&
    (!cancelled || entry.basis === "OWNER_REPORTED"));
  function update(index: number, patch: Partial<Entry>) {
    setIntent(current => ({ ...current, entries: current.entries.map((entry, row) => row === index ? { ...entry, ...patch } : entry) }));
  }
  function fieldError(path: string) {
    const message = state.fieldErrors[path];
    return message ? <p className="text-sm text-red-700" id={`use-${view.context!.id}-${path}-error`}>{message}</p> : null;
  }
  function errorProps(path: string) {
    return { "aria-invalid": Boolean(state.fieldErrors[path]), "aria-describedby": state.fieldErrors[path] ? `use-${view.context!.id}-${path}-error` : undefined };
  }

  return (
    <form ref={formElement} action={formAction} className="grid min-w-0 gap-4 [overflow-wrap:anywhere]" aria-label={mode === "CONFIRM" ? "ยืนยันยอดใช้การผลิต" : "แก้ไขยอดใช้การผลิต"}>
      <input name="payload" type="hidden" value={JSON.stringify(parsed.success ? parsed.data : input)} />
      <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
        {mode === "CONFIRM" ? "ยืนยันหลังผลิตเสร็จ แยกจากการส่งครบหรือจบรอบ ตามแผนเป็นประมาณการ ไม่ใช่ยอดใช้จริงที่เจ้าของชั่งบันทึก" : "ตรวจยอดเดิมและผลสต๊อกที่เสนอก่อนแก้ไข ประวัติเดิมจะไม่ถูกลบ"}
      </p>
      <fieldset className="grid min-w-0 gap-4" disabled={pending}>
        <legend className="sr-only">รายการยอดใช้</legend>
        {view.items.map((item, index) => {
          // Both arrays come from the same immutable context manifest; the form
          // remounts when its context/predecessor changes.
          const entry = intent.entries[index]!;
          const previous = view.currentRevision?.items.find(row => row.inventoryItemId === item.inventoryItemId);
          const ledger = view.expectedLedger.find(row => row.inventoryItemId === item.inventoryItemId);
          let effect: ReturnType<typeof calculateUseEffect> | null = null;
          try {
            effect = calculateUseEffect({ previousUsed: previous?.usedQuantity ?? null, newUsed: entry.usedQuantity, initialCountMovementId: previous?.initialCountMovementId ?? null, currentCountMovementId: ledger?.countMovementId ?? null, countSettled: false });
          } catch { /* An unresolved/invalid draft has no proposed stock effect. */ }
          const prefix = `use-${view.context!.id}-${item.inventoryItemId}`;
          const quantityPath = `items.${index}.usedQuantity`;
          const basisPath = `items.${index}.basis`;
          const reasonPath = `items.${index}.reason`;
          return (
            <section className="grid min-w-0 gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm" key={item.inventoryItemId} aria-label={item.inventoryItemName}>
              <h3 className="break-words text-xl font-bold text-stone-900 [overflow-wrap:anywhere]">{item.inventoryItemName}</h3>
              <p className="text-sm text-stone-600">ตามแผน {item.plannedQuantity} {formatUnitLabel(item.baseUnit)}</p>
              {previous ? <p className="text-sm text-stone-700">ยอดเดิม {previous.usedQuantity} · ผลสต๊อกเดิม {previous.quantityDelta}</p> : null}
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2">
                  <label className="text-sm font-semibold" htmlFor={`${prefix}-quantity`}>จำนวนใช้ {item.inventoryItemName}</label>
                  <input {...errorProps(quantityPath)} className={INPUT} id={`${prefix}-quantity`} inputMode="decimal" type="text" required value={entry.usedQuantity} onChange={event => {
                    const usedQuantity = event.target.value;
                    let basis = entry.basis;
                    try {
                      if (canonicalQuantity(usedQuantity) !== canonicalQuantity(item.plannedQuantity)) basis = "OWNER_REPORTED";
                    } catch { /* Keep incomplete input and its basis until the amount is valid. */ }
                    update(index, { usedQuantity, basis });
                  }} />
                  {fieldError(quantityPath)}
                </div>
                <div className="grid min-w-0 gap-2">
                  <label className="text-sm font-semibold" htmlFor={`${prefix}-basis`}>ที่มาของยอดใช้ {item.inventoryItemName}</label>
                  <select {...errorProps(basisPath)} className={INPUT} id={`${prefix}-basis`} value={entry.basis} onChange={event => update(index, event.target.value === "PLANNED" ? { basis: "PLANNED", usedQuantity: item.plannedQuantity } : { basis: "OWNER_REPORTED" })}>
                    {!cancelled ? <option value="PLANNED">ตามแผน (ประมาณการ)</option> : null}
                    <option value="OWNER_REPORTED">เจ้าของบันทึกใช้จริง</option>
                  </select>
                  {fieldError(basisPath)}
                </div>
              </div>
              <label className="text-sm font-semibold" htmlFor={`${prefix}-reason`}>เหตุผล {item.inventoryItemName}</label>
              <input {...errorProps(reasonPath)} className={INPUT} id={`${prefix}-reason`} type="text" required={needsReason(entry, item.plannedQuantity)} value={entry.reason} onChange={event => update(index, { reason: event.target.value })} />
              <p className="text-sm text-stone-500">ต้องระบุเหตุผลเมื่อยอดต่างจากแผนหรือเป็นศูนย์</p>
              {fieldError(reasonPath)}
              {effect ? <p className="text-sm text-stone-700">ยอดใหม่ {canonicalQuantity(entry.usedQuantity)} · ผลสต๊อกที่เสนอ {effect.delta}</p> : <p className="text-sm text-stone-500">กรอกยอดใช้ที่ถูกต้องเพื่อดูผลสต๊อกที่เสนอ</p>}
              {effect?.mode === "HISTORY_ONLY" ? (
                <div className="grid gap-1 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
                  <p>แก้ประวัติเท่านั้น ไม่ปรับสต๊อกปัจจุบัน</p>
                  <Link className="inline-flex min-h-11 items-center font-bold underline" href={`/inventory/${item.inventoryItemId}`}>เปิดสต๊อกปัจจุบัน {item.inventoryItemName}</Link>
                </div>
              ) : null}
            </section>
          );
        })}
        {mode === "CONFIRM" ? (
          <label className="flex min-h-11 items-start gap-3 rounded-2xl bg-stone-50 p-4 text-sm">
            <input className="mt-1 size-5 shrink-0" type="checkbox" checked={intent.confirmed} onChange={event => setIntent(current => ({ ...current, confirmed: event.target.checked }))} />
            ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว
          </label>
        ) : null}
        {mode === "CONFIRM" && view.items.length === 0 ? (
          <label className="flex min-h-11 items-center gap-3 rounded-2xl bg-stone-50 p-4 text-sm">
            <input className="size-5 shrink-0" type="checkbox" checked={intent.empty} onChange={event => setIntent(current => ({ ...current, empty: event.target.checked }))} />
            ยืนยันว่ารุ่นนี้ไม่มีรายการต้องใช้
          </label>
        ) : null}
        <label className="text-sm font-semibold" htmlFor={`use-${view.context!.id}-reason`}>{mode === "CORRECT" ? "เหตุผลการแก้ไข" : "เหตุผลการบันทึก"}</label>
        <textarea {...errorProps("reason")} className={`${INPUT} min-h-20 py-3`} id={`use-${view.context!.id}-reason`} required={mode === "CORRECT" || view.items.length === 0} value={intent.reason} onChange={event => setIntent(current => ({ ...current, reason: event.target.value }))} />
        {fieldError("reason")}
      </fieldset>
      {state.error || Object.keys(state.fieldErrors).length > 0 ? (
        <div role="alert" className="grid min-w-0 gap-2 break-words rounded-xl bg-red-50 p-4 text-sm text-red-800">
          {state.error ? <p>{state.error}</p> : null}
          <ul className="grid gap-1">{Object.entries(state.fieldErrors).map(([path, message]) => <li key={path}>{message}</li>)}</ul>
          {state.stale ? <Link className="inline-flex min-h-11 items-center font-bold underline" href={`/cycles/${view.cycle.cycleId}/consumption`}>เปิดข้อมูลล่าสุด</Link> : null}
          {state.blockers.map(blocker => <Link className="inline-flex min-h-11 items-center font-bold underline" href={`/cycles/${blocker.cycleId}/consumption`} key={blocker.cycleId}>{blocker.cycleName}</Link>)}
        </div>
      ) : null}
      {state.saved && state.result ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">บันทึกยอดใช้แล้ว</p> : null}
      <button className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={pending || !ready} type="submit">{pending ? "กำลังบันทึก…" : mode === "CONFIRM" ? "ยืนยันยอดใช้" : "บันทึกการแก้ไข"}</button>
    </form>
  );
}

export function UsageForm(props: Props) {
  const { view, mode } = props;
  const matchingSource = view.source && view.context && view.source.contextId === view.context.id && view.source.cycleId === view.cycle.cycleId && view.source.planningSnapshotId === view.cycle.planningSnapshotId;
  const allowed = matchingSource && (mode === "CONFIRM"
    ? view.canConfirm && !view.currentRevision && !view.context?.currentRevisionId
    : view.canCorrect && view.currentRevision && view.currentRevision.contextId === view.context?.id && view.context.currentRevisionId === view.currentRevision.id);
  if (!allowed) return null;
  return <UsageIntentForm {...props} key={`${mode}:${view.context!.id}:${view.currentRevision?.id ?? "initial"}`} />;
}
