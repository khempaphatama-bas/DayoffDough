"use client";

import { useActionState } from "react";
import {
  createCycleAction,
  type CycleActionState,
  updateCycleAction,
} from "@/app/(app)/cycles/actions";
import type { BakeCycle } from "@/modules/cycles/application/cycles";

const INITIAL_STATE: CycleActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
};

function FieldErrors({
  errors,
}: Readonly<{ errors: ReadonlyArray<string> | undefined }>) {
  return errors?.map((error) => (
    <span className="text-sm font-normal text-red-700" key={error}>
      {error}
    </span>
  ));
}

function formatBangkokDateTime(value: Date | null): string {
  if (!value) return "";
  const bangkokTime = new Date(value.getTime() + 7 * 60 * 60 * 1000);
  return bangkokTime.toISOString().slice(0, 16);
}

export function CycleForm({
  cycle,
}: Readonly<{ cycle?: BakeCycle }>) {
  const action = cycle ? updateCycleAction : createCycleAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form
      action={formAction}
      className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2"
    >
      {cycle ? <input name="cycleId" type="hidden" value={cycle.id} /> : null}
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
        ชื่อรอบอบ
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={cycle?.name ?? ""}
          name="name"
          required
        />
        <FieldErrors errors={state.fieldErrors.name} />
      </label>
      {!cycle ? (
        <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
          สถานะเริ่มต้น
          <select
            className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
            defaultValue="OPEN"
            name="status"
          >
            <option value="OPEN">เปิดรับออเดอร์</option>
            <option value="DRAFT">แบบร่าง</option>
          </select>
          <FieldErrors errors={state.fieldErrors.status} />
        </label>
      ) : null}
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        วันปิดรับออเดอร์
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={formatBangkokDateTime(cycle?.orderCutoffAt ?? null)}
          name="orderCutoffAt"
          type="datetime-local"
        />
        <FieldErrors errors={state.fieldErrors.orderCutoffAt} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        วันผลิต
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={cycle?.targetProductionDate ?? ""}
          name="targetProductionDate"
          required
          type="date"
        />
        <FieldErrors errors={state.fieldErrors.targetProductionDate} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        วันส่งหลัก
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={cycle?.primaryDeliveryDate ?? ""}
          name="primaryDeliveryDate"
          required
          type="date"
        />
        <FieldErrors errors={state.fieldErrors.primaryDeliveryDate} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
        หมายเหตุ
        <textarea
          className="min-h-24 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal"
          defaultValue={cycle?.notes ?? ""}
          name="notes"
        />
        <FieldErrors errors={state.fieldErrors.notes} />
      </label>
      {state.error ? (
        <p
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2"
        >
          บันทึกรอบอบแล้ว
        </p>
      ) : null}
      <button
        className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2"
        disabled={pending}
        type="submit"
      >
        {pending
          ? "กำลังบันทึก…"
          : cycle
            ? "บันทึกข้อมูลรอบอบ"
            : "สร้างรอบอบ"}
      </button>
    </form>
  );
}
