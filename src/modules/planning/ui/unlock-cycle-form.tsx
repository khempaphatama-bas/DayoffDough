"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  unlockCycleAction,
  type UnlockActionState,
} from "@/app/(app)/cycles/[id]/planning/actions";
import type { BakeCycleStatus } from "@/modules/cycles/domain/cycle-lifecycle";

const INITIAL_STATE: UnlockActionState = {
  error: null,
  saved: false,
};

function EligibleUnlockCycleForm({
  cycleId,
  status,
}: Readonly<{
  cycleId: string;
  status: "LOCKED" | "IN_PRODUCTION";
}>) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction, pending] = useActionState(
    unlockCycleAction,
    INITIAL_STATE,
  );
  const confirmed = reason.trim() !== "" && confirmation === "ปลดล็อก";

  useEffect(() => {
    if (!state.saved) return;
    router.push(`/cycles/${cycleId}`);
    router.refresh();
  }, [cycleId, router, state.saved]);

  return (
    <section className="grid gap-4 rounded-3xl border border-red-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-stone-900">ปลดล็อกรอบ</h2>
        {status === "IN_PRODUCTION" ? (
          <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            รอบนี้เริ่มผลิตแล้ว การปลดล็อกจะคืนรอบไปวางแผนใหม่
          </p>
        ) : null}
      </div>
      <form action={formAction} className="grid gap-4">
        <input name="cycleId" type="hidden" value={cycleId} />
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          เหตุผลที่ปลดล็อก
          <textarea
            className="min-h-24 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal"
            maxLength={2000}
            name="reason"
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน
          <input
            autoComplete="off"
            className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
            name="confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            required
            value={confirmation}
          />
        </label>
        {state.error ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {state.error}
          </p>
        ) : null}
        <button
          className="min-h-12 rounded-xl border border-red-700 px-5 font-bold text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!confirmed || pending}
          type="submit"
        >
          {pending ? "กำลังปลดล็อก…" : "ปลดล็อกรอบ"}
        </button>
      </form>
    </section>
  );
}

export function UnlockCycleForm({
  cycleId,
  status,
}: Readonly<{
  cycleId: string;
  status: BakeCycleStatus;
}>) {
  if (status !== "LOCKED" && status !== "IN_PRODUCTION") return null;
  return <EligibleUnlockCycleForm cycleId={cycleId} status={status} />;
}
