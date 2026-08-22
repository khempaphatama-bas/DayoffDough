"use client";

import { useActionState } from "react";
import {
  saveSettings,
  type SettingsActionState,
} from "@/app/(app)/settings/actions";
import { formatSatangAsBaht } from "@/modules/money/domain/money";

const INITIAL_STATE: SettingsActionState = { error: null, saved: false };

type SettingsFormValue = Readonly<{
  laborRateSatangPerHour: number;
  defaultWasteAllowancePercent: string;
  timezone: "Asia/Bangkok";
  currency: "THB";
}>;

export function SettingsForm({
  settings,
}: Readonly<{ settings: SettingsFormValue | null }>) {
  const [state, formAction, pending] = useActionState(saveSettings, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-5 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ค่าแรงต่อชั่วโมง (บาท)
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
          defaultValue={
            settings ? formatSatangAsBaht(settings.laborRateSatangPerHour) : "0.00"
          }
          inputMode="decimal"
          min="0"
          name="laborRateBaht"
          required
          step="0.01"
          type="number"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ค่าเผื่อสูญเสียเริ่มต้น (%)
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
          defaultValue={settings?.defaultWasteAllowancePercent ?? "0"}
          inputMode="decimal"
          max="100"
          min="0"
          name="defaultWasteAllowancePercent"
          required
          step="0.0001"
          type="number"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        เขตเวลา
        <select
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
          defaultValue={settings?.timezone ?? "Asia/Bangkok"}
          name="timezone"
        >
          <option value="Asia/Bangkok">Asia/Bangkok</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        สกุลเงิน
        <select
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
          defaultValue={settings?.currency ?? "THB"}
          name="currency"
        >
          <option value="THB">THB — บาทไทย</option>
        </select>
      </label>

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800" aria-live="polite">
          บันทึกการตั้งค่าร้านแล้ว
        </p>
      ) : null}

      <button
        className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white transition hover:bg-stone-700 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
      </button>
    </form>
  );
}
