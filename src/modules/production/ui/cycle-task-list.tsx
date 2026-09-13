"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import {
  deleteManualCycleTaskAction,
  updateCycleTaskAction,
  type ProductionActionState,
} from "@/app/(app)/cycles/[id]/production/actions";
import type { CycleProductionView, CycleTaskView } from "@/modules/production/domain/types";
import { CycleTaskForm } from "./cycle-task-form";

const INITIAL_STATE: ProductionActionState = { error: null, fieldErrors: {}, values: {}, saved: false };
const STATUS_LABELS = {
  PENDING: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  DONE: "ทำเสร็จแล้ว",
  SKIPPED: "ข้ามงาน",
} as const;

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function localDateLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(year!, month! - 1, day!, 5)));
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function formatDateTime(date: Date | null): string {
  return date ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date) : "";
}

function formatBatch(value: string | null): string {
  if (!value) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value;
}

function QuickStatusButton({ task, status, cycleId, generationId, onSkip }: Readonly<{ task: CycleTaskView; status: CycleTaskView["status"]; cycleId: string; generationId: string; onSkip?: () => void }>) {
  const [state, formAction, pending] = useActionState(updateCycleTaskAction, INITIAL_STATE);
  if (task.status === status) return null;
  if (status === "SKIPPED" && onSkip) {
    return <button className="min-h-10 rounded-xl border border-stone-300 px-3 text-sm font-semibold text-stone-800" onClick={onSkip} type="button">{STATUS_LABELS[status]}</button>;
  }
  const payload = {
    cycleId,
    taskGenerationId: generationId,
    taskId: task.id,
    title: task.title,
    productId: task.productId,
    batchCount: task.batchCount,
    scheduledAt: task.scheduledAt.toISOString(),
    estimatedDurationMinutes: task.estimatedDurationMinutes,
    notes: task.notes,
    sequence: task.sequence,
    status,
    skipReason: null,
  };
  return (
    <form action={formAction}>
      <input name="payload" type="hidden" value={JSON.stringify(payload)} />
      <button className="min-h-10 rounded-xl border border-stone-300 px-3 text-sm font-semibold text-stone-800" disabled={pending} type="submit">
        {STATUS_LABELS[status]}
      </button>
      {state.error ? <span className="sr-only">{state.error}</span> : null}
    </form>
  );
}

function DeleteManualTaskButton({ task, cycleId, generationId }: Readonly<{ task: CycleTaskView; cycleId: string; generationId: string }>) {
  const [state, formAction, pending] = useActionState(deleteManualCycleTaskAction, INITIAL_STATE);
  if (task.origin !== "MANUAL" || task.status !== "PENDING") return null;
  return (
    <form action={formAction}>
      <input name="cycleId" type="hidden" value={cycleId} />
      <input name="taskGenerationId" type="hidden" value={generationId} />
      <input name="taskId" type="hidden" value={task.id} />
      <button className="min-h-10 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-800" disabled={pending} type="submit">ลบงาน</button>
      {state.error ? <span className="sr-only">{state.error}</span> : null}
    </form>
  );
}

function TaskCard({ task, writable, cycleId, generationId, products }: Readonly<{ task: CycleTaskView; writable: boolean; cycleId: string; generationId: string; products: Extract<CycleProductionView, { kind: "CURRENT" | "HISTORY" }>["products"] }>) {
  const [editing, setEditing] = useState(false);
  const [editingTask, setEditingTask] = useState<CycleTaskView | null>(null);
  if (editing && writable) {
    return <CycleTaskForm mode="edit" cycleId={cycleId} taskGenerationId={generationId} task={editingTask ?? task} products={products} onCancel={() => { setEditing(false); setEditingTask(null); }} />;
  }
  return (
    <article aria-label={`${task.title} · ${task.productName ?? "งานระดับรอบ"}`} className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-stone-900">{task.title}</h3>
          <p className="text-sm text-stone-600">{formatTime(task.scheduledAt)} · {task.estimatedDurationMinutes} นาที</p>
        </div>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-bold text-stone-800">{STATUS_LABELS[task.status]}</span>
      </div>
      {task.productName ? <p className="font-semibold text-amber-900">{task.productName}{task.batchCount ? ` · ${formatBatch(task.batchCount)} แบตช์` : ""}</p> : <p className="font-semibold text-amber-900">งานระดับรอบ</p>}
      <dl className="grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
        {task.origin === "TEMPLATE" ? <div><dt className="text-stone-500">ที่มา</dt><dd>เทมเพลต: {task.sourceTemplateName} · {task.sourceActivityName}</dd></div> : <div><dt className="text-stone-500">ที่มา</dt><dd>งานที่เพิ่มเอง</dd></div>}
        {task.notes ? <div><dt className="text-stone-500">หมายเหตุ</dt><dd>{task.notes}</dd></div> : null}
      </dl>
      {task.status === "SKIPPED" && task.skipReason ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">เหตุผลที่ข้าม: {task.skipReason}</p> : null}
      {writable ? (
        <div className="flex flex-wrap gap-2" aria-label="การดำเนินการกับงาน">
          <QuickStatusButton cycleId={cycleId} generationId={generationId} status="PENDING" task={task} />
          <QuickStatusButton cycleId={cycleId} generationId={generationId} status="IN_PROGRESS" task={task} />
          <QuickStatusButton cycleId={cycleId} generationId={generationId} status="DONE" task={task} />
          <QuickStatusButton cycleId={cycleId} generationId={generationId} onSkip={() => { setEditingTask({ ...task, status: "SKIPPED", skipReason: "" }); setEditing(true); }} status="SKIPPED" task={task} />
          <button className="min-h-10 rounded-xl bg-amber-800 px-3 text-sm font-semibold text-white" onClick={() => setEditing(true)} type="button">แก้ไขงาน</button>
          <DeleteManualTaskButton cycleId={cycleId} generationId={generationId} task={task} />
        </div>
      ) : null}
    </article>
  );
}

function Timeline({ view }: Readonly<{ view: Extract<CycleProductionView, { kind: "CURRENT" | "HISTORY" }> }>) {
  const groups = new Map<string, CycleTaskView[]>();
  for (const task of view.tasks) groups.set(localDateKey(task.scheduledAt), [...(groups.get(localDateKey(task.scheduledAt)) ?? []), task]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-stone-900">ไทม์ไลน์การผลิต · รุ่น {view.generation.generation}</h2>
        {!view.writable ? <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-700">อ่านอย่างเดียว</span> : null}
      </div>
      {[...groups.entries()].map(([key, tasks]) => (
        <section aria-labelledby={`timeline-day-${key}`} className="grid gap-4" key={key}>
          <h3 className="text-xl font-bold text-stone-900" id={`timeline-day-${key}`}>{localDateLabel(key)}</h3>
          {tasks.map((task) => <TaskCard cycleId={view.cycle.cycleId} generationId={view.generation.id} key={task.id} products={view.products} task={task} writable={view.writable} />)}
        </section>
      ))}
      {view.tasks.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700">ยังไม่มีงานในรุ่นนี้</p> : null}
    </>
  );
}

export function CycleTaskList({ view }: Readonly<{ view: CycleProductionView }>) {
  const [showCreate, setShowCreate] = useState(false);
  if (view.kind === "NO_GENERATION") {
    return <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700">{view.reason === "LEGACY_SNAPSHOT" ? "รอบรุ่นนี้ยังไม่มี Production Timeline" : "รอบนี้ยังไม่มีแผน Production Timeline"}</p>;
  }
  return (
    <div className="grid gap-6">
      <Timeline view={view} />
      {view.writable ? (
        showCreate ? <CycleTaskForm mode="create" cycleId={view.cycle.cycleId} taskGenerationId={view.generation.id} products={view.products} onCancel={() => setShowCreate(false)} /> : <button className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white" onClick={() => setShowCreate(true)} type="button">เพิ่มงานเอง</button>
      ) : null}
    </div>
  );
}

export function ProductionGenerationLinks({ view }: Readonly<{ view: Extract<CycleProductionView, { kind: "CURRENT" | "HISTORY" }> }>) {
  return <nav aria-label="ประวัติรุ่น Production Timeline" className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">ประวัติ Production Timeline</h2><ul className="grid gap-2">{view.generations.map((generation) => <li className="rounded-2xl bg-stone-50 p-3" key={generation.planningSnapshotId}><Link aria-current={generation.generation === view.generation.generation ? "page" : undefined} className="inline-flex min-h-11 items-center font-bold text-amber-900" href={generation.planningStatus === "ACTIVE" ? `/cycles/${view.cycle.cycleId}/production` : `/cycles/${view.cycle.cycleId}/production?generation=${generation.generation}`}>รุ่น {generation.generation} · {generation.planningStatus === "ACTIVE" ? "ใช้งานอยู่" : "แทนที่แล้ว"}</Link><div className="grid gap-1 text-sm text-stone-600"><p>ล็อกเมื่อ {formatDateTime(generation.lockedAt)}</p>{generation.unlockReason ? <p>เหตุผลที่ปลดล็อก: {generation.unlockReason}</p> : null}{generation.unlockedAt ? <p>ปลดล็อกเมื่อ {formatDateTime(generation.unlockedAt)}</p> : null}</div></li>)}</ul></nav>;
}
