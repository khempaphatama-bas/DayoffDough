"use client";

import type { CycleOperationsView, OperationsTask } from "@/modules/operations/domain/types";
import { CycleTaskCard } from "@/modules/production/ui/cycle-task-card";

type ReadyView = Extract<CycleOperationsView, { kind: "READY" }>;

const dateFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" });

function TaskCards({ tasks, view, writable, showDate = false }: Readonly<{ tasks: readonly OperationsTask[]; view: ReadyView; writable: boolean; showDate?: boolean }>) {
  return tasks.map((task) => <div className="grid gap-2" key={task.id}>
    {showDate ? <p className="text-sm font-semibold text-stone-700">{dateFormatter.format(task.scheduledAt)}</p> : null}
    <CycleTaskCard cycleId={view.cycle.id} generationId={view.generation.id}
      products={view.products} task={task} writable={writable && task.taskGenerationId === view.generation.id} />
  </div>);
}

export function OperationsTaskTimeline({ view }: Readonly<{ view: CycleOperationsView }>) {
  if (view.kind === "NO_GENERATION") return <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700">{view.reason === "LEGACY_PLAN" ? "รอบรุ่นนี้ยังไม่มี Production Timeline" : "รอบนี้ยังไม่มีแผน Production Timeline"}</p>;
  const writable = view.cycle.status === "LOCKED" || view.cycle.status === "IN_PRODUCTION";
  const { overdue, today, future } = view.taskBuckets;
  const finished = view.tasks.length > 0 && view.tasks.every((task) => task.status === "DONE" || task.status === "SKIPPED");
  return (
    <section aria-label="งานตามเวลา" className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-stone-900">ต้องทำอะไรต่อ</h2>
        {!writable ? <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-700">อ่านอย่างเดียว</span> : null}
      </div>
      {finished ? <p className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">งานทั้งหมดเสร็จแล้ว</p> : null}
      <section aria-labelledby="operations-overdue" className="grid gap-4">
        <h3 className="text-xl font-bold text-stone-900" id="operations-overdue">เลยกำหนด</h3>
        <TaskCards showDate tasks={overdue} view={view} writable={writable} />
        {overdue.length === 0 ? <p className="text-stone-600">ไม่มีงานเลยกำหนด</p> : null}
      </section>
      <section aria-labelledby="operations-today" className="grid gap-4">
        <h3 className="text-xl font-bold text-stone-900" id="operations-today">วันนี้</h3>
        <TaskCards tasks={today} view={view} writable={writable} />
        {today.length === 0 ? <p className="text-stone-600">ไม่มีงานวันนี้</p> : null}
      </section>
      <details aria-label="งานวันถัดไป" className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
        <summary className="min-h-11 cursor-pointer rounded-xl py-3 font-bold text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800">วันถัดไป ({future.length} งาน)</summary>
        <div className="grid gap-4 pt-4">
          <TaskCards showDate tasks={future} view={view} writable={writable} />
          {future.length === 0 ? <p className="text-stone-600">ไม่มีงานวันถัดไป</p> : null}
        </div>
      </details>
    </section>
  );
}
