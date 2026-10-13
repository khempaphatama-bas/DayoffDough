"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { startCycleAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import { CYCLE_STATUS_LABELS } from "@/modules/cycles/domain/cycle-lifecycle";
import type { CycleOperationsView } from "@/modules/operations/domain/types";
import { createUtcCalendarDate } from "@/modules/production/domain/task-generation";

const INITIAL_STATE: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: false };

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" })
    .format(createUtcCalendarDate(year!, month! - 1, day!, 5));
}

function StartCycleForm({ cycleId }: Readonly<{ cycleId: string }>) {
  const [state, formAction, pending] = useActionState(startCycleAction, INITIAL_STATE);
  return (
    <form action={formAction} className="grid gap-3">
      <input name="payload" type="hidden" value={JSON.stringify({ cycleId })} />
      <button className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-60" disabled={pending} type="submit">
        {pending ? "กำลังเริ่มรอบผลิต…" : "เริ่มรอบผลิต"}
      </button>
      {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p> : null}
    </form>
  );
}

export function OperationsHeader({ view }: Readonly<{ view: CycleOperationsView }>) {
  const router = useRouter();
  const { cycle } = view;
  const terminal = cycle.status === "COMPLETED" || cycle.status === "CANCELLED";
  return (
    <header className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        เลือกรอบผลิต
        <select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800" value={cycle.id}
          onChange={(event) => {
            const id = event.target.value;
            if (id !== cycle.id && view.cycleOptions.some((option) => option.id === id)) router.push(`/cycles/${id}/operations`);
          }}>
          {view.cycleOptions.map((option) => <option key={option.id} value={option.id}>รอบ {option.cycleNumber} · {option.name} · {CYCLE_STATUS_LABELS[option.status]}</option>)}
          {!view.cycleOptions.some((option) => option.id === cycle.id) ? <option value={cycle.id}>รอบ {cycle.cycleNumber} · {cycle.name} · {CYCLE_STATUS_LABELS[cycle.status]}</option> : null}
        </select>
      </label>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-stone-900">รอบ {cycle.cycleNumber} · {cycle.name}</h1>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-bold text-stone-800">{CYCLE_STATUS_LABELS[cycle.status]}</span>
          {terminal ? <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-700">อ่านอย่างเดียว</span> : null}
        </div>
      </div>
      <dl className="grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
        <div><dt>วันผลิต</dt><dd>{dateLabel(cycle.targetProductionDate)}</dd></div>
        <div><dt>วันส่ง</dt><dd>{dateLabel(cycle.primaryDeliveryDate)}</dd></div>
      </dl>
      {view.kind === "READY" ? <div className="grid gap-2 text-sm text-stone-700">
        <p>รุ่นงานปัจจุบัน {view.generation.generation}</p>
        <p>{view.completion.ready ? "งานและออเดอร์พร้อมจบรอบ" : `งานค้าง ${view.completion.remainingTaskCount} งาน · ออเดอร์ยังไม่ส่ง ${view.completion.remainingOrderCount} ใบ`}</p>
      </div> : <p className="text-sm text-stone-700">ยังไม่มีรุ่นงานปัจจุบัน</p>}
      {view.kind === "READY" && cycle.status === "LOCKED" ? <StartCycleForm cycleId={cycle.id} key={cycle.id} /> : null}
      <nav aria-label="หน้าที่เกี่ยวข้องกับรอบผลิต" className="flex flex-wrap gap-4">
        <Link className="inline-flex min-h-11 items-center font-bold text-amber-900" href={`/cycles/${cycle.id}/production`}>Production Timeline</Link>
        <Link className="inline-flex min-h-11 items-center font-bold text-amber-900" href={`/cycles/${cycle.id}/planning`}>แผนการผลิต</Link>
      </nav>
    </header>
  );
}
