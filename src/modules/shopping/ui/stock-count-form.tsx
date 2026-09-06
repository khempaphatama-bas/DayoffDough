"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useState,
  type FormEvent,
} from "react";
import {
  confirmCycleStockAction,
  type StockActionState,
} from "@/app/(app)/cycles/[id]/shopping/actions";
import type { CountRequiredView } from "@/modules/shopping/domain/types";
import { formatUnitLabel } from "@/modules/units/domain/units";

const INITIAL_STOCK_ACTION_STATE: StockActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
  stale: false,
};

function formatQuantity(value: Decimal.Value): string {
  return new Decimal(value).toString();
}

function CountForm({ view }: Readonly<{ view: CountRequiredView }>) {
  const [state, formAction, pending] = useActionState(
    confirmCycleStockAction,
    INITIAL_STOCK_ACTION_STATE,
  );
  const [confirmationRequestId] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      view.items.map((item) => [
        item.inventoryItemId,
        formatQuantity(item.systemBalance),
      ]),
    ),
  );

  function submitCounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !window.confirm(
        `ยืนยันยอดนับสำหรับแผนรุ่น ${view.cycle.generation} และปรับยอดสต๊อกตามจำนวนจริงหรือไม่?`,
      )
    ) {
      return;
    }

    const formData = new FormData();
    formData.set(
      "payload",
      JSON.stringify({
        cycleId: view.cycle.cycleId,
        planningSnapshotId: view.cycle.planningSnapshotId,
        confirmationRequestId,
        countedAt: new Date().toISOString(),
        counts: view.items.map((item) => ({
          inventoryItemId: item.inventoryItemId,
          countedQuantity: counts[item.inventoryItemId] ?? "",
        })),
      }),
    );
    startTransition(() => formAction(formData));
  }

  return (
    <form className="grid gap-5 pb-24 md:pb-0" onSubmit={submitCounts}>
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <h2 className="font-bold">ตรวจของจริงก่อนยืนยัน</h2>
        <p>
          ยอดในระบบถูกใส่ไว้เป็นค่าเริ่มต้น กรุณานับของจริงให้ครบทุกชิ้นก่อนยืนยัน
          ยอดของแผนรุ่นนี้จะถูกล็อกและปรับสมุดสต๊อกตามจำนวนจริง
        </p>
      </section>

      <section aria-labelledby="stock-count-heading" className="grid gap-4">
        <h2 className="text-xl font-bold text-stone-900" id="stock-count-heading">
          ยอดสต๊อกที่นับจริง
        </h2>
        {view.items.map((item) => {
          const error =
            state.fieldErrors[`countedQuantity.${item.inventoryItemId}`];
          const errorId = `count-error-${item.inventoryItemId}`;
          const inputId = `count-input-${item.inventoryItemId}`;
          const unit = formatUnitLabel(item.baseUnit);
          return (
            <article
              aria-label={item.inventoryItemName}
              className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
              key={item.inventoryItemId}
            >
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-lg font-bold text-stone-900">
                    {item.inventoryItemName}
                  </h3>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700">
                    {item.inventoryCategory === "INGREDIENT"
                      ? "วัตถุดิบ"
                      : "บรรจุภัณฑ์"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-stone-600">
                  ต้องใช้ {formatQuantity(item.requiredQuantity)} {unit} · ยอดในระบบ{" "}
                  {formatQuantity(item.systemBalance)} {unit}
                </p>
              </div>

              <div className="grid gap-2 text-sm font-semibold text-stone-700">
                <label htmlFor={inputId}>
                  จำนวนที่นับจริง {item.inventoryItemName}
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <input
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={Boolean(error)}
                    className="min-h-11 min-w-0 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
                    id={inputId}
                    inputMode="decimal"
                    min="0"
                    onChange={(event) =>
                      setCounts((current) => ({
                        ...current,
                        [item.inventoryItemId]: event.target.value,
                      }))
                    }
                    required
                    step="any"
                    type="number"
                    value={counts[item.inventoryItemId] ?? ""}
                  />
                  <span className="font-bold text-stone-600">{unit}</span>
                </div>
              </div>
              {error ? (
                <p className="text-sm text-red-700" id={errorId}>
                  {error}
                </p>
              ) : null}
            </article>
          );
        })}
      </section>

      {state.error ? (
        <div
          className="grid gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <p>{state.error}</p>
          {state.stale ? (
            <Link
              className="inline-flex min-h-11 items-center font-bold underline underline-offset-4"
              href={`/cycles/${view.cycle.cycleId}/shopping`}
            >
              เปิดรายการล่าสุด
            </Link>
          ) : null}
        </div>
      ) : null}
      {state.saved ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          ยืนยันสต๊อกแล้ว
        </p>
      ) : null}

      <div
        className="sticky bottom-20 z-20 -mx-5 border-t border-stone-200 bg-stone-50/95 p-4 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0"
        data-testid="stock-count-action"
      >
        <button
          className="min-h-12 w-full rounded-xl bg-amber-800 px-6 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending
            ? "กำลังยืนยันสต๊อก…"
            : "ยืนยันสต๊อกและสร้างรายการซื้อ"}
        </button>
      </div>
    </form>
  );
}

export function StockCountForm({
  view,
}: Readonly<{ view: CountRequiredView }>) {
  return <CountForm key={view.cycle.planningSnapshotId} view={view} />;
}
