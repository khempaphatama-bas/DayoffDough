"use client";

import { useState, useActionState } from "react";
import { deleteManualCycleTaskAction, updateCycleTaskAction, type ProductionActionState } from "@/app/(app)/cycles/[id]/production/actions";
import type { CycleTaskView, ProductOption } from "@/modules/production/domain/types";
import { CycleTaskForm } from "./cycle-task-form";

const INITIAL_STATE: ProductionActionState = { error: null, fieldErrors: {}, values: {}, saved: false };
const STATUS_LABELS = {
  PENDING: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  DONE: "ทำเสร็จแล้ว",
  SKIPPED: "ข้ามงาน",
} as const;

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
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
    return <button className="min-h-11 rounded-xl border border-stone-300 px-3 text-sm font-semibold text-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800" onClick={onSkip} type="button">{STATUS_LABELS[status]}</button>;
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
      <button className="min-h-11 rounded-xl border border-stone-300 px-3 text-sm font-semibold text-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800" disabled={pending} type="submit">
        {STATUS_LABELS[status]}
      </button>
      {state.error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{state.error}</p> : null}
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
      <button className="min-h-11 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800" disabled={pending} type="submit">ลบงาน</button>
      {state.error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{state.error}</p> : null}
    </form>
  );
}

export function CycleTaskCard({ task, writable, cycleId, generationId, products }: Readonly<{ task: CycleTaskView; writable: boolean; cycleId: string; generationId: string; products: readonly ProductOption[] }>) {
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
          <button className="min-h-11 rounded-xl bg-amber-800 px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800" onClick={() => setEditing(true)} type="button">แก้ไขงาน</button>
          <DeleteManualTaskButton cycleId={cycleId} generationId={generationId} task={task} />
        </div>
      ) : null}
    </article>
  );
}
