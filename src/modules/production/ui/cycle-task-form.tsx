"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
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
  if (Number.isNaN(value.getTime())) return "";
  const bangkokWallClock = new Date(value.getTime() + 7 * 60 * 60 * 1000);
  const pad = (part: number, width: number) => String(part).padStart(width, "0");
  return `${pad(bangkokWallClock.getUTCFullYear(), 4)}-${pad(bangkokWallClock.getUTCMonth() + 1, 2)}-${pad(bangkokWallClock.getUTCDate(), 2)}T${pad(bangkokWallClock.getUTCHours(), 2)}:${pad(bangkokWallClock.getUTCMinutes(), 2)}`;
}

/** Convert a Bangkok wall-clock value to the canonical UTC instant expected by Task 8. */
export function bangkokLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(year, month, 0);
  const daysInMonth = monthEnd.getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, 0, 0);
  instant.setUTCHours(instant.getUTCHours() - 7);
  return instant.toISOString();
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
  const lastSuccessState = useRef<ProductionActionState | null>(null);

  useEffect(() => {
    if (mode !== "create" || !state.saved) return;
    if (lastSuccessState.current === state) return;
    lastSuccessState.current = state;
    const timer = window.setTimeout(() => setCreationRequestId(uuid()), 0);
    return () => window.clearTimeout(timer);
  }, [mode, state]);

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
    if (mode === "create" && state.saved) {
      const freshRequestId = uuid();
      setCreationRequestId(freshRequestId);
      formData.set("creationRequestId", freshRequestId);
    }
    const local = String(formData.get("scheduledAt") ?? "");
    const utc = bangkokLocalToIso(local);
    if (utc) formData.set("scheduledAt", utc);
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
        <Errors error={state.fieldErrors.productId} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          จำนวนแบตช์
          <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={batchCount} min="0.000001" name="batchCount" step="0.000001" type="number" />
          <Errors error={state.fieldErrors.batchCount} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ระยะเวลา (นาที)
          <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={duration} min="1" name="estimatedDurationMinutes" required type="number" />
          <Errors error={state.fieldErrors.estimatedDurationMinutes} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ลำดับ
          <input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" defaultValue={sequence} min="1" name="sequence" required type="number" />
          <Errors error={state.fieldErrors.sequence} />
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
