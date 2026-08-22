"use client";

import { useActionState } from "react";
import {
  changeCycleStatusAction,
  type CycleStatusActionState,
} from "@/app/(app)/cycles/actions";
import type { Phase2CycleStatus } from "@/modules/cycles/application/cycles";
import { CYCLE_STATUS_LABELS } from "@/modules/cycles/ui/cycle-list";

const INITIAL_STATE: CycleStatusActionState = {
  error: null,
  saved: false,
};

export function CycleStatusForm({
  cycleId,
  status,
}: Readonly<{ cycleId: string; status: Phase2CycleStatus }>) {
  const [state, formAction, pending] = useActionState(
    changeCycleStatusAction,
    INITIAL_STATE,
  );

  return (
    <form
      action={formAction}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <input name="cycleId" type="hidden" value={cycleId} />
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        เปลี่ยนสถานะ
        <select
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
          defaultValue={status}
          name="status"
        >
          {Object.entries(CYCLE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
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
