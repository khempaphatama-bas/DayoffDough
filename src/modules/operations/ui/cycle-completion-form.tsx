"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { completeCycleAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type { CycleOperationsView } from "@/modules/operations/domain/types";
import { handleOperationsDialogKeyDown } from "./operations-dialog-keyboard";

const INITIAL: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: false };
const buttonClass = "min-h-12 rounded-xl border border-stone-300 bg-white px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-50";

export function CycleCompletionForm({ view, action = completeCycleAction }: Readonly<{ view: CycleOperationsView; action?: typeof completeCycleAction }>) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const trigger = useRef<HTMLButtonElement>(null); const cancel = useRef<HTMLButtonElement>(null); const confirm = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);
  // Close only when the Server Action confirms this submission, including consecutive successes.
  useEffect(() => {
    if (!state.saved) return;
    const timer = window.setTimeout(() => { setConfirming(false); trigger.current?.focus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (view.kind !== "READY") return null;
  const { completion, cycle } = view;
  if (cycle.status === "COMPLETED") return completion.remainingTaskCount > 0 || completion.remainingOrderCount > 0 ? <p role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">ข้อมูลรอบที่จบแล้วไม่สอดคล้อง: งานค้าง {completion.remainingTaskCount} งาน · ออเดอร์ยังไม่ส่ง {completion.remainingOrderCount} ใบ · งาน การแพ็ก และจัดส่งอ่านอย่างเดียว แต่ยังบันทึกยอดชำระได้</p> : <p className="rounded-2xl bg-emerald-50 p-4">จบรอบผลิตแล้ว · ยังบันทึกยอดชำระได้</p>;
  if (cycle.status !== "IN_PRODUCTION") return null;
  const blocked = !completion.ready || completion.remainingTaskCount > 0 || completion.remainingOrderCount > 0 || pending;
  function close() { if (!pending) { setConfirming(false); trigger.current?.focus(); } }
  return <section aria-label="จบรอบผลิต" className="grid gap-3 rounded-2xl border border-stone-200 p-4">
    <button type="button" className={buttonClass} disabled={blocked} ref={trigger} onClick={() => setConfirming(true)}>จบรอบผลิต</button>
    {!completion.ready ? <p className="text-stone-700">ยังจบรอบไม่ได้: งานค้าง {completion.remainingTaskCount} งาน · ออเดอร์ยังไม่ส่ง {completion.remainingOrderCount} ใบ</p> : null}
    {state.error && !confirming ? <p role="alert" className="text-red-800">{state.error}</p> : null}
    {confirming ? <div role="dialog" aria-modal="true" aria-labelledby={dialogId} className="fixed inset-0 z-40 grid place-items-center bg-stone-950/40 p-4" onKeyDown={event => handleOperationsDialogKeyDown(event, close)}>
      <form action={formAction} className="grid max-h-[85dvh] w-full max-w-md gap-4 overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
        <h2 id={dialogId} className="text-xl font-bold">ยืนยันจบรอบผลิต</h2>
        <p>งานค้าง {completion.remainingTaskCount} งาน · ออเดอร์ยังไม่ส่ง {completion.remainingOrderCount} ใบ</p>
        {completion.unpaidOrderCount > 0 ? <p className="rounded-xl bg-amber-50 p-3 text-amber-900">ยอดค้าง {completion.unpaidOrderCount} ออเดอร์ · {formatSatangAsBaht(completion.outstandingSatang)} บาท · หลังจบรอบยังบันทึกยอดชำระได้</p> : null}
        <input name="payload" type="hidden" value={JSON.stringify({ cycleId: cycle.id, expectedTaskGenerationId: view.generation.id, confirmation: true })} />
        <div className="flex flex-wrap gap-3"><button type="button" ref={cancel} className={buttonClass} disabled={pending} onClick={close}>ยกเลิก</button><button type="submit" ref={confirm} className={buttonClass} disabled={blocked}>ยืนยันจบรอบผลิต</button></div>
        {state.error ? <p role="alert" className="text-red-800">{state.error} {state.kind === "STALE_DATA" ? <a className="underline" href={`/cycles/${cycle.id}/operations`}>โหลดข้อมูลล่าสุด</a> : null}</p> : null}
      </form>
    </div> : null}
  </section>;
}
