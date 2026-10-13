"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { setOrderAmountPaidAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import { formatSatangAsBaht, parseBahtToSatang } from "@/modules/money/domain/money";
import type { OperationsOrder } from "@/modules/operations/domain/types";

const INITIAL: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: false };
const buttonClass = "min-h-12 rounded-xl border border-stone-300 px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-50";

export function QuickPaymentForm({ order, action = setOrderAmountPaidAction, readOnly = false }: Readonly<{ order: OperationsOrder; action?: typeof setOrderAmountPaidAction; readOnly?: boolean }>) {
  const [value, setValue] = useState("");
  const [correction, setCorrection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  // Synchronize controlled drafts with each confirmed Server Action result, not its saved boolean.
  useEffect(() => {
    if (!state.saved) return;
    const timer = window.setTimeout(() => { setValue(""); setCorrection(false); setError(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [state]);
  let inputTarget: number | null = null;
  try { inputTarget = parseBahtToSatang(value) + (correction ? 0 : order.amountPaidSatang); } catch { /* Invalid drafts remain local until explicit submit. */ }
  function submit(target: number | null = inputTarget) {
    try {
      const targetAmountPaidSatang = target;
      if (targetAmountPaidSatang === null || !Number.isSafeInteger(targetAmountPaidSatang) || targetAmountPaidSatang < 0 || targetAmountPaidSatang > order.grandTotalSatang) throw new Error("range");
      setError(null);
      const data = new FormData(); data.set("payload", JSON.stringify({ orderId: order.id, targetAmountPaidSatang, expectedAmountPaidSatang: order.amountPaidSatang }));
      startTransition(() => formAction(data));
    } catch { setError("กรุณากรอกยอดชำระที่ถูกต้อง ไม่เกินยอดรวมออเดอร์ และทศนิยมไม่เกิน 2 ตำแหน่ง"); }
  }
  return <div className="grid gap-3">
    <p className="text-sm text-stone-700">ยอดรวม {formatSatangAsBaht(order.grandTotalSatang)} บาท · รับแล้ว {formatSatangAsBaht(order.amountPaidSatang)} บาท · คงเหลือ {formatSatangAsBaht(order.balanceSatang)} บาท</p>
    {readOnly || order.paymentStatus === "REFUNDED" || order.fulfillmentStatus === "CANCELLED" ? <p>อ่านอย่างเดียว · <Link className="inline-flex min-h-11 items-center font-semibold text-amber-900" href={`/orders/${order.id}`}>รายละเอียดออเดอร์</Link></p> : <form className="grid gap-3" onSubmit={event => { event.preventDefault(); submit(); }}>
      <input name="payload" type="hidden" value={JSON.stringify({ orderId: order.id, targetAmountPaidSatang: inputTarget, expectedAmountPaidSatang: order.amountPaidSatang })} />
      <label className="grid gap-2 text-sm font-semibold">{correction ? "ยอดสะสม" : "รับเพิ่ม"}
        <input className="min-h-12 w-full rounded-xl border border-stone-300 px-3 text-base focus-visible:outline-2 focus-visible:outline-amber-800" type="text" inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} disabled={pending} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={pending}>{correction ? "บันทึกยอดสะสม" : "บันทึกรับเงิน"}</button>
        {order.balanceSatang > 0 ? <button type="button" className={buttonClass} disabled={pending} onClick={() => submit(order.grandTotalSatang)}>ชำระครบ</button> : null}
        <button type="button" className={buttonClass} disabled={pending} onClick={() => { setCorrection(!correction); setValue(correction ? "" : formatSatangAsBaht(order.amountPaidSatang)); setError(null); }}>{correction ? "ยกเลิกแก้ยอด" : "แก้ยอดสะสม"}</button>
      </div>
      {error || state.error ? <p role="alert" className="text-sm text-red-800">{error ?? state.error} {state.kind === "STALE_DATA" ? <a className="underline" href={`/orders/${order.id}`}>โหลดข้อมูลล่าสุด</a> : null}</p> : null}
    </form>}
  </div>;
}
