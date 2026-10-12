"use client";

import { useActionState, type FormEvent } from "react";
import {
  changeCycleStatusAction,
  type CycleStatusActionState,
} from "@/app/(app)/cycles/actions";
import {
  BAKE_CYCLE_STATUS_TRANSITIONS,
  CYCLE_STATUS_LABELS,
  type BakeCycleStatus,
} from "@/modules/cycles/domain/cycle-lifecycle";

const INITIAL_STATE: CycleStatusActionState = {
  error: null,
  saved: false,
};

export function CycleStatusForm({
  cycleId,
  status,
}: Readonly<{ cycleId: string; status: BakeCycleStatus }>) {
  const [state, formAction, pending] = useActionState(
    changeCycleStatusAction,
    INITIAL_STATE,
  );
  const targets = BAKE_CYCLE_STATUS_TRANSITIONS[status].filter(
    (target) => target !== "IN_PRODUCTION" && target !== "COMPLETED",
  );

  if (targets.length === 0) {
    return <p className="text-sm text-stone-600">รอบนี้ไม่มีสถานะถัดไป</p>;
  }

  function confirmCancellation(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    if (
      formData.get("status") === "CANCELLED" &&
      !window.confirm("ยืนยันยกเลิกรอบผลิตนี้หรือไม่?")
    ) {
      event.preventDefault();
    }
  }

  return (
    <form
      action={formAction}
      aria-label="เปลี่ยนสถานะรอบผลิต"
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={confirmCancellation}
    >
      <input name="cycleId" type="hidden" value={cycleId} />
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        เปลี่ยนสถานะ
        <select
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
          defaultValue=""
          name="status"
          required
        >
          <option disabled value="">เลือกสถานะใหม่</option>
          {targets.map((value) => (
            <option key={value} value={value}>
              {CYCLE_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <button
        className="min-h-11 self-end rounded-xl border border-stone-800 px-5 font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "กำลังอัปเดต…" : "อัปเดตสถานะ"}
      </button>
      {state.error ? (
        <p
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:col-span-2"
        >
          อัปเดตสถานะรอบอบแล้ว
        </p>
      ) : null}
    </form>
  );
}
