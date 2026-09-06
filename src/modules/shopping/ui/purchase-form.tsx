"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  recordCyclePurchaseAction,
  type PurchaseActionState,
} from "@/app/(app)/cycles/[id]/shopping/actions";
import type { CycleShoppingItemView } from "@/modules/shopping/domain/types";

const INITIAL_PURCHASE_ACTION_STATE: PurchaseActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
  stale: false,
};
const INPUT_CLASS =
  "min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal";
const TEXTAREA_CLASS =
  "min-h-20 rounded-xl border border-stone-300 bg-white px-4 py-3 text-base font-normal";

function FieldError({
  error,
  id,
}: Readonly<{ error: string | undefined; id: string }>) {
  return error ? (
    <span className="text-sm font-normal text-red-700" id={id}>
      {error}
    </span>
  ) : null;
}

function PurchaseActionForm({
  item,
  onSaved,
}: Readonly<{
  item: CycleShoppingItemView;
  onSaved(): void;
}>) {
  const [state, formAction, pending] = useActionState(
    recordCyclePurchaseAction,
    INITIAL_PURCHASE_ACTION_STATE,
  );
  const [purchaseRequestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState({
    packCount: "",
    totalPriceBaht: "",
    purchasedFrom: "",
    occurredAt: "",
    notes: "",
  });

  useEffect(() => {
    if (state.saved) onSaved();
  }, [onSaved, state.saved]);

  const packErrorId = `purchase-pack-error-${item.id}`;
  const priceErrorId = `purchase-price-error-${item.id}`;
  const storeErrorId = `purchase-store-error-${item.id}`;
  const occurredErrorId = `purchase-occurred-error-${item.id}`;
  const notesErrorId = `purchase-notes-error-${item.id}`;
  const packInputId = `purchase-pack-${item.id}`;
  const priceInputId = `purchase-price-${item.id}`;
  const storeInputId = `purchase-store-${item.id}`;
  const occurredInputId = `purchase-occurred-${item.id}`;
  const notesInputId = `purchase-notes-${item.id}`;

  return (
    <form action={formAction} className="grid gap-4 rounded-2xl bg-stone-50 p-4">
      <input name="cycleId" type="hidden" value={item.cycleId} />
      <input
        name="planningSnapshotId"
        type="hidden"
        value={item.planningSnapshotId}
      />
      <input name="shoppingItemId" type="hidden" value={item.id} />
      <input
        name="purchaseRequestId"
        type="hidden"
        value={purchaseRequestId}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 text-sm font-semibold text-stone-700">
          <label htmlFor={packInputId}>จำนวนแพ็กที่ซื้อ</label>
          <input
            aria-describedby={state.fieldErrors.packCount ? packErrorId : undefined}
            aria-invalid={Boolean(state.fieldErrors.packCount)}
            className={INPUT_CLASS}
            id={packInputId}
            inputMode="numeric"
            min="1"
            name="packCount"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                packCount: event.target.value,
              }))
            }
            required
            step="1"
            type="number"
            value={values.packCount}
          />
          <FieldError error={state.fieldErrors.packCount} id={packErrorId} />
        </div>
        <div className="grid gap-2 text-sm font-semibold text-stone-700">
          <label htmlFor={priceInputId}>ราคารวม (บาท)</label>
          <input
            aria-describedby={
              state.fieldErrors.totalPriceBaht ? priceErrorId : undefined
            }
            aria-invalid={Boolean(state.fieldErrors.totalPriceBaht)}
            className={INPUT_CLASS}
            id={priceInputId}
            inputMode="decimal"
            min="0"
            name="totalPriceBaht"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                totalPriceBaht: event.target.value,
              }))
            }
            required
            step="0.01"
            type="number"
            value={values.totalPriceBaht}
          />
          <FieldError
            error={state.fieldErrors.totalPriceBaht}
            id={priceErrorId}
          />
        </div>
        <div className="grid gap-2 text-sm font-semibold text-stone-700">
          <label htmlFor={storeInputId}>ร้านที่ซื้อ</label>
          <input
            aria-describedby={
              state.fieldErrors.purchasedFrom ? storeErrorId : undefined
            }
            aria-invalid={Boolean(state.fieldErrors.purchasedFrom)}
            className={INPUT_CLASS}
            id={storeInputId}
            maxLength={200}
            name="purchasedFrom"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                purchasedFrom: event.target.value,
              }))
            }
            type="text"
            value={values.purchasedFrom}
          />
          <FieldError
            error={state.fieldErrors.purchasedFrom}
            id={storeErrorId}
          />
        </div>
        <div className="grid gap-2 text-sm font-semibold text-stone-700">
          <label htmlFor={occurredInputId}>วันและเวลาที่ซื้อ</label>
          <input
            aria-describedby={
              state.fieldErrors.occurredAt ? occurredErrorId : undefined
            }
            aria-invalid={Boolean(state.fieldErrors.occurredAt)}
            className={INPUT_CLASS}
            id={occurredInputId}
            name="occurredAt"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                occurredAt: event.target.value,
              }))
            }
            required
            type="datetime-local"
            value={values.occurredAt}
          />
          <FieldError
            error={state.fieldErrors.occurredAt}
            id={occurredErrorId}
          />
        </div>
      </div>

      <div className="grid gap-2 text-sm font-semibold text-stone-700">
        <label htmlFor={notesInputId}>หมายเหตุ</label>
        <textarea
          aria-describedby={state.fieldErrors.notes ? notesErrorId : undefined}
          aria-invalid={Boolean(state.fieldErrors.notes)}
          className={TEXTAREA_CLASS}
          id={notesInputId}
          maxLength={2000}
          name="notes"
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          value={values.notes}
        />
        <FieldError error={state.fieldErrors.notes} id={notesErrorId} />
      </div>

      {state.error ? (
        <div
          className="grid gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <p>{state.error}</p>
          {state.stale ? (
            <Link
              className="inline-flex min-h-11 items-center font-bold underline underline-offset-4"
              href={`/cycles/${item.cycleId}/shopping`}
            >
              เปิดรายการล่าสุด
            </Link>
          ) : null}
        </div>
      ) : null}

      <button
        className="min-h-12 rounded-xl bg-amber-800 px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending
          ? "กำลังบันทึก…"
          : item.progress.status === "COMPLETE"
            ? "เพิ่มการซื้ออีกครั้ง"
            : "บันทึกการซื้อ"}
      </button>
    </form>
  );
}

export function PurchaseForm({
  item,
}: Readonly<{ item: CycleShoppingItemView }>) {
  const [submissionNumber, setSubmissionNumber] = useState(0);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  function resetAfterSaved() {
    setSavedItemId(item.id);
    setSubmissionNumber((current) => current + 1);
  }

  return (
    <div className="grid gap-3">
      {savedItemId === item.id ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          บันทึกการซื้อแล้ว
        </p>
      ) : null}
      <PurchaseActionForm
        item={item}
        key={`${item.id}:${submissionNumber}`}
        onSaved={resetAfterSaved}
      />
    </div>
  );
}
