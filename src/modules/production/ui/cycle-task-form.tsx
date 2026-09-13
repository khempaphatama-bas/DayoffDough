"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import {
  createManualCycleTaskAction,
  type ProductionActionState,
  updateCycleTaskAction,
} from "@/app/(app)/cycles/[id]/production/actions";
import type { CycleTaskView, ProductOption } from "@/modules/production/domain/types";

const INITIAL_STATE: ProductionActionState = {
  error: null,
  fieldErrors: {},
  values: {},
  saved: false,
};

const STATUS_LABELS = {
  PENDING: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  DONE: "เสร็จแล้ว",
  SKIPPED: "ข้ามงาน",
} as const;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === "x" ? random : (random & 3) | 8;
    return value.toString(16);
  });
}

export function formatBangkokDateTime(value: Date | null | undefined): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convert a Bangkok wall-clock value to the canonical UTC instant expected by Task 8. */
export function bangkokLocalToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 7, Number(minute))).toISOString();
}

function asString(values: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return values[key] ?? fallback;
}

function Errors({ error }: Readonly<{ error: string | undefined }>) {
  return error ? <span className="text-sm font-normal text-red-700">{error}</span> : null;
}

export function CycleTaskForm({
  mode,
  cycleId,
  taskGenerationId,
  task,
  products,
  action,
  onCancel,
}: Readonly<{
  mode: "create" | "edit";
  cycleId: string;
  taskGenerationId: string;
  task?: CycleTaskView;
  products: ReadonlyArray<ProductOption>;
  action?: (previousState: ProductionActionState, formData: FormData) => Promise<ProductionActionState>;
  onCancel?: () => void;
}>) {
  const [state, formAction, pending] = useActionState(
    action ?? (mode === "create" ? createManualCycleTaskAction : updateCycleTaskAction),
    INITIAL_STATE,
  );
  const [creationRequestId, setCreationRequestId] = useState(uuid);
  const [status, setStatus] = useState(task?.status ?? "PENDING");

  useEffect(() => {
    if (mode !== "create" || !state.saved) return;
    const timer = window.setTimeout(() => setCreationRequestId(uuid()), 0);
    return () => window.clearTimeout(timer);
  }, [mode, state.saved]);

  const values = state.values;
  const scheduledAt = values.scheduledAt ? formatBangkokDateTime(new Date(values.scheduledAt)) : formatBangkokDateTime(task?.scheduledAt);
  const title = asString(values, "title", task?.title ?? "");
  const productId = asString(values, "productId", task?.productId ?? "");
  const batchCount = asString(values, "batchCount", task?.batchCount ? String(Number(task.batchCount)) : "");
  const duration = asString(values, "estimatedDurationMinutes", String(task?.estimatedDurationMinutes ?? ""));
  const sequence = asString(values, "sequence", String(task?.sequence ?? "1"));
  const notes = asString(values, "notes", task?.notes ?? "");
  const skipReason = asString(values, "skipReason", task?.skipReason ?? "");
  const displayedStatus = (values.status as CycleTaskView["status"] | undefined) ?? status;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const local = String(formData.get("scheduledAt") ?? "");
    formData.set("scheduledAt", bangkokLocalToIso(local));
    startTransition(() => formAction(formData));
  }

  return (
    <form key={state.error ? JSON.stringify(state.values) : "stable"} className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm" onSubmit={submit}>
      <input name="cycleId" type="hidden" value={cycleId} />
      <input name="taskGenerationId" type="hidden" value={taskGenerationId} />
      {mode === "edit" && task ? <input name="taskId" type="hidden" value={task.id} /> : null}
      {mode === "create" ? <input data-testid="creation-request-id" name="creationRequestId" type="hidden" value={state.saved ? creationRequestId : state.values.creationRequestId ?? creationRequestId} /> : null}
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ชื่องาน
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={title} name="title" required />
        <Errors error={state.fieldErrors.title} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        สินค้า
        <select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" defaultValue={productId} name="productId">
          <option value="">งานระดับรอบ (ไม่ผูกสินค้า)</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          จำนวนแบตช์
          <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={batchCount} min="0.000001" name="batchCount" step="0.000001" type="number" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ระยะเวลา (นาที)
          <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={duration} min="1" name="estimatedDurationMinutes" required type="number" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ลำดับ
          <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={sequence} min="1" name="sequence" required type="number" />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        เวลาที่กำหนด
        <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={scheduledAt} name="scheduledAt" required type="datetime-local" />
        <Errors error={state.fieldErrors.scheduledAt} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        สถานะ
        <select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" name="status" onChange={(event) => setStatus(event.target.value as CycleTaskView["status"])} value={displayedStatus}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {displayedStatus === "SKIPPED" ? (
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          เหตุผลที่ข้าม
          <textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" defaultValue={skipReason} name="skipReason" required />
          <Errors error={state.fieldErrors.skipReason} />
        </label>
      ) : null}
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        หมายเหตุ
        <textarea className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal" defaultValue={notes} name="notes" />
      </label>
      {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.error}</p> : null}
      {state.saved ? <p aria-live="polite" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">บันทึกงานแล้ว</p> : null}
      <div className="flex flex-wrap gap-3">
        <button className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : mode === "create" ? "สร้างงาน" : "บันทึกงาน"}</button>
        {onCancel ? <button className="min-h-12 rounded-xl border border-stone-400 px-5 font-bold text-stone-800" onClick={onCancel} type="button">ยกเลิก</button> : null}
      </div>
    </form>
  );
}
