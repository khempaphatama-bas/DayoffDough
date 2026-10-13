"use client";

import { useActionState, useState } from "react";
import { setPackedQuantityAction, type OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
import type { OperationsOrderItem } from "@/modules/operations/domain/types";

const INITIAL: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: false };
const buttonClass = "min-h-12 rounded-xl border border-stone-300 px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-50";

export function PackingProgressForm({ cycleId, item, action = setPackedQuantityAction }: Readonly<{ cycleId: string; item: OperationsOrderItem; action?: typeof setPackedQuantityAction }>) {
  const [value, setValue] = useState(String(item.packedQuantity));
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const quantity = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(quantity) && quantity >= 0 && quantity <= item.quantity;
  return <form action={formAction} className="grid gap-3 rounded-xl bg-stone-50 p-3">
    <p className="font-semibold">{item.productName} · สั่ง {item.quantity} · แพ็กแล้ว {item.packedQuantity}</p>
    {item.lineNote ? <p className="text-sm text-stone-700">{item.lineNote}</p> : null}
    <input type="hidden" name="payload" value={JSON.stringify({ cycleId, orderItemId: item.id, packedQuantity: quantity, expectedPackedQuantity: item.packedQuantity })} />
    <label className="grid gap-2 text-sm font-semibold">จำนวนที่แพ็กแล้ว {item.productName}
      <input className="min-h-12 w-full rounded-xl border border-stone-300 px-3 text-base focus-visible:outline-2 focus-visible:outline-amber-800" type="number" inputMode="numeric" min={0} max={item.quantity} step={1} value={value} onChange={event => setValue(event.target.value)} disabled={pending} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} aria-label={`ลดจำนวนแพ็ก ${item.productName}`} disabled={pending || !valid || quantity === 0} onClick={() => setValue(String(quantity - 1))}>−</button>
      <button type="button" className={buttonClass} aria-label={`เพิ่มจำนวนแพ็ก ${item.productName}`} disabled={pending || !valid || quantity === item.quantity} onClick={() => setValue(String(quantity + 1))}>+</button>
      <button type="submit" className={buttonClass} disabled={pending || !valid}>บันทึกจำนวนแพ็ก {item.productName}</button>
    </div>
    {!valid ? <p role="alert" className="text-sm text-red-800">จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึง {item.quantity} และเป็นจำนวนเต็ม</p> : null}
    {state.error ? <p role="alert" className="text-sm text-red-800">{state.fieldErrors.packedQuantity ?? state.error} {state.kind === "STALE_DATA" ? <a className="underline" href={`/cycles/${cycleId}/operations`}>โหลดข้อมูลล่าสุด</a> : null}</p> : null}
  </form>;
}
