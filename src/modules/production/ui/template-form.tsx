"use client";

import { startTransition, useActionState, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { saveProductionTemplateAction, type TemplateActionState } from "@/app/(app)/production/templates/actions";
import type { ProductionTemplateDetail } from "@/modules/production/application/template-service";
import type { ProductionTemplateActivityInput, ProductionTemplateScope } from "@/modules/production/domain/types";

type EditableActivity = ProductionTemplateActivityInput & Readonly<{ clientKey: string }>;
type TemplateFormAction = (state: TemplateActionState, data: FormData) => Promise<TemplateActionState>;
const INITIAL_STATE: TemplateActionState = { status: "IDLE", message: null, fieldErrors: {}, values: {} };

function activityFrom(activity: ProductionTemplateActivityInput, clientKey: string): EditableActivity {
  return { ...activity, clientKey };
}
function blankActivity(sequence: number): EditableActivity {
  return { id: null, name: "", offsetDaysFromDelivery: -1, defaultTime: "08:00", estimatedDurationMinutes: 30, sequence, notes: null, active: true, clientKey: crypto.randomUUID() };
}
function normalise(activities: ReadonlyArray<EditableActivity>) {
  return activities.map((activity, index) => ({ ...activity, sequence: index + 1 }));
}
function fieldError(state: TemplateActionState, index: number, name: string): string | undefined {
  return state.fieldErrors[`activities.${index}.${name}`] ?? state.fieldErrors[`activities.${index + 1}.${name}`];
}
function relativeDayLabel(offsetDaysFromDelivery: number): string {
  if (offsetDaysFromDelivery === 0) return "วันส่งสินค้า";
  return offsetDaysFromDelivery < 0 ? `ก่อนวันส่ง ${Math.abs(offsetDaysFromDelivery)} วัน` : `หลังวันส่ง ${offsetDaysFromDelivery} วัน`;
}

export function TemplateForm({
  products,
  initialTemplate,
  action = saveProductionTemplateAction,
}: Readonly<{
  products: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  initialTemplate?: ProductionTemplateDetail;
  action?: TemplateFormAction;
}>) {
  const initialActivities = useMemo(() => initialTemplate?.activities.map((activity, index) => activityFrom(activity, activity.id || `activity-${index}`)) ?? [blankActivity(1)], [initialTemplate]);
  const [name, setName] = useState(initialTemplate?.name ?? "");
  const [scope, setScope] = useState<ProductionTemplateScope>(initialTemplate?.scope ?? "PRODUCT");
  const [productId, setProductId] = useState(initialTemplate?.productId ?? products[0]?.id ?? "");
  const [activities, setActivities] = useState<ReadonlyArray<EditableActivity>>(initialActivities);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  useEffect(() => {
    if (state.status !== "ERROR" || Object.keys(state.values).length === 0) return;
    if (state.values.name !== undefined) setName(state.values.name);
    if (state.values.scope === "CYCLE" || state.values.scope === "PRODUCT") setScope(state.values.scope);
    if (state.values.productId !== undefined) setProductId(state.values.productId);
    try {
      const saved = JSON.parse(state.values.activities ?? "") as ProductionTemplateActivityInput[];
      if (Array.isArray(saved)) setActivities(normalise(saved.map((activity, index) => activityFrom(activity, activity.id ?? activities[index]?.clientKey ?? `activity-${index}`))));
    } catch { /* keep the values the owner was already editing */ }
  }, [state]);

  function updateActivity(index: number, values: Partial<ProductionTemplateActivityInput>) {
    setActivities((current) => normalise(current.map((activity, position) => position === index ? { ...activity, ...values } : activity)));
  }
  function move(index: number, direction: -1 | 1) {
    setActivities((current) => {
      const next = [...current]; const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return normalise(next);
    });
  }
  function drop(event: DragEvent<HTMLElement>, target: number) {
    event.preventDefault(); const source = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isInteger(source) && source !== target) {
      setActivities((current) => { const next = [...current]; const [moved] = next.splice(source, 1); if (moved) next.splice(target, 0, moved); return normalise(next); });
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    data.set("activities", JSON.stringify(normalise(activities).map(({ clientKey: _clientKey, ...activity }) => activity)));
    startTransition(() => formAction(data));
  }

  return <form className="grid gap-5" onSubmit={submit}>
    {initialTemplate ? <input name="templateId" type="hidden" value={initialTemplate.id} /> : null}
    <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2">
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">ชื่อเทมเพลต<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" name="name" onChange={(event) => setName(event.target.value)} required value={name} />{state.fieldErrors.name ? <span className="text-sm text-red-700">{state.fieldErrors.name}</span> : null}</label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">ใช้กับ<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" name="scope" onChange={(event) => setScope(event.target.value as ProductionTemplateScope)} value={scope}><option value="PRODUCT">สินค้า</option><option value="CYCLE">ทั้งรอบผลิต</option></select></label>
      {scope === "PRODUCT" ? <label className="grid gap-2 text-sm font-semibold text-stone-700">สินค้า<select className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal" name="productId" onChange={(event) => setProductId(event.target.value)} required value={productId}><option value="">เลือกสินค้า</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>{state.fieldErrors.productId ? <span className="text-sm text-red-700">{state.fieldErrors.productId}</span> : null}</label> : <input name="productId" type="hidden" value="" />}
    </section>
    <section className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-stone-900">กิจกรรมการผลิต</h2><p className="text-sm text-stone-600">กำหนดล่วงหน้าจากวันส่งสินค้า</p></div><button className="min-h-11 rounded-xl border border-stone-800 px-4 font-semibold" onClick={() => setActivities((current) => [...current, blankActivity(current.length + 1)])} type="button">เพิ่มกิจกรรม</button></div>
      {activities.map((activity, index) => <article className={`grid gap-4 rounded-3xl border bg-white p-5 shadow-sm ${activity.active ? "border-stone-200" : "border-stone-300 bg-stone-50"}`} draggable key={activity.clientKey} onDragOver={(event) => event.preventDefault()} onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))} onDrop={(event) => drop(event, index)}>
        <input name={`activityId_${index + 1}`} type="hidden" value={activity.id ?? ""} /><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold text-stone-900">กิจกรรม {index + 1}{activity.active ? "" : " (เก็บแล้ว)"}</h3><div className="flex gap-2"><button aria-label={`เลื่อนขึ้น กิจกรรม ${index + 1}`} className="min-h-11 rounded-xl border border-stone-300 px-3 disabled:opacity-40" disabled={index === 0} onClick={() => move(index, -1)} type="button">เลื่อนขึ้น</button><button aria-label={`เลื่อนลง กิจกรรม ${index + 1}`} className="min-h-11 rounded-xl border border-stone-300 px-3 disabled:opacity-40" disabled={index === activities.length - 1} onClick={() => move(index, 1)} type="button">เลื่อนลง</button><button aria-label={`${activity.active ? "เก็บ" : "กู้คืน"}กิจกรรม ${index + 1}`} className="min-h-11 rounded-xl border border-stone-300 px-3" onClick={() => updateActivity(index, { active: !activity.active })} type="button">{activity.active ? "เก็บ" : "กู้คืน"}</button></div></div>
        <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-semibold text-stone-700">ชื่อกิจกรรม {index + 1}<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" disabled={!activity.active} onChange={(event) => updateActivity(index, { name: event.target.value })} value={activity.name} />{fieldError(state, index, "name") ? <span className="text-sm text-red-700">{fieldError(state, index, "name")}</span> : null}</label><label className="grid gap-2 text-sm font-semibold text-stone-700">ก่อนวันส่ง (วัน)<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" onChange={(event) => updateActivity(index, { offsetDaysFromDelivery: Number(event.target.value) })} type="number" value={activity.offsetDaysFromDelivery} /><span className="text-sm font-normal text-stone-600">{relativeDayLabel(activity.offsetDaysFromDelivery)}</span>{fieldError(state, index, "offsetDaysFromDelivery") ? <span className="text-sm text-red-700">{fieldError(state, index, "offsetDaysFromDelivery")}</span> : null}</label><label className="grid gap-2 text-sm font-semibold text-stone-700">เวลาเริ่ม<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" onChange={(event) => updateActivity(index, { defaultTime: event.target.value })} type="time" value={activity.defaultTime} />{fieldError(state, index, "defaultTime") ? <span className="text-sm text-red-700">{fieldError(state, index, "defaultTime")}</span> : null}</label><label className="grid gap-2 text-sm font-semibold text-stone-700">ระยะเวลา (นาที) {index + 1}<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" onChange={(event) => updateActivity(index, { estimatedDurationMinutes: Number(event.target.value) })} type="number" value={activity.estimatedDurationMinutes} />{fieldError(state, index, "estimatedDurationMinutes") ? <span className="text-sm text-red-700">{fieldError(state, index, "estimatedDurationMinutes")}</span> : null}</label></div>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">หมายเหตุ<input className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal" onChange={(event) => updateActivity(index, { notes: event.target.value || null })} value={activity.notes ?? ""} /></label>
      </article>)}</section>
    {state.message ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.message}</p> : null}
    <button className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกเทมเพลต"}</button>
  </form>;
}
