"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { duplicateProductionTemplateAction, setProductionTemplateActiveAction } from "@/app/(app)/production/templates/actions";
import type { ProductionTemplateListView, ProductionTemplateSummary } from "@/modules/production/application/template-service";

type ListCallback = (templateId: string, active?: boolean) => unknown;

function scopeName(template: ProductionTemplateSummary): string {
  return template.scope === "CYCLE" ? "ทั้งรอบผลิต" : template.productName ?? "สินค้า";
}
function status(template: ProductionTemplateSummary): string {
  if (!template.active) return "ยังไม่เปิดใช้";
  return "กำลังใช้งาน";
}

export function TemplateList({
  view,
  onSetActive,
  onDuplicate,
}: Readonly<{
  view: ProductionTemplateListView;
  onSetActive?: ListCallback;
  onDuplicate?: ListCallback;
}>) {
  const [confirming, setConfirming] = useState<ProductionTemplateSummary | null>(null);
  const activate = (templateId: string, active: boolean) => {
    if (onSetActive) return onSetActive(templateId, active);
    const data = new FormData(); data.set("templateId", templateId); data.set("active", String(active));
    return setProductionTemplateActiveAction(data);
  };
  const duplicate = (templateId: string) => {
    if (onDuplicate) return onDuplicate(templateId);
    const data = new FormData(); data.set("templateId", templateId);
    return duplicateProductionTemplateAction(data);
  };
  const renderGroup = (title: string, templates: ReadonlyArray<ProductionTemplateSummary>) => <section className="grid gap-4"><h2 className="text-2xl font-bold text-stone-900">{title}</h2>{templates.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 bg-white/60 p-5 text-sm text-stone-600">ยังไม่มีเทมเพลต</p> : templates.map((template) => <article className="flex flex-col justify-between gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center" key={template.id}><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-stone-900">{template.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-700"}`}>{status(template)}</span></div><p className="mt-1 text-sm text-stone-600">{scopeName(template)} · {template.activeActivityCount} กิจกรรมที่ใช้งาน</p></div><div className="flex flex-wrap gap-2"><Link aria-label={`แก้ไข ${template.name}`} className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4 font-semibold" href={`/production/templates/${template.id}`}>แก้ไข</Link><button className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => startTransition(() => { void duplicate(template.id); })} type="button">ทำสำเนา</button>{template.active ? <button aria-label={`ปิดใช้เทมเพลต ${template.name}`} className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => startTransition(() => { void activate(template.id, false); })} type="button">ปิดใช้</button> : <button aria-label={`เปิดใช้เทมเพลต ${template.name}`} className="min-h-11 rounded-xl bg-amber-800 px-4 font-semibold text-white" onClick={() => { const conflicts = templates.some((candidate) => candidate.active && candidate.id !== template.id && candidate.scope === template.scope && (candidate.scope === "CYCLE" || candidate.productId === template.productId)); if (conflicts) setConfirming(template); else startTransition(() => { void activate(template.id, true); }); }} type="button">เปิดใช้</button>}</div></article>)}</section>;
  return <div className="grid gap-8">
    {view.productsMissingReadyTemplate.length > 0 ? <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-950">สินค้าที่ยังไม่มีเทมเพลตพร้อมใช้</h2><ul className="mt-2 list-disc pl-5 text-sm text-amber-900">{view.productsMissingReadyTemplate.map((product) => <li key={product.id}>{product.name}</li>)}</ul></aside> : null}
    {renderGroup("เทมเพลตทั้งรอบผลิต", view.cycleTemplates)}
    {renderGroup("เทมเพลตต่อสินค้า", view.productTemplates)}
    {confirming ? <div aria-labelledby="replace-template-title" aria-modal="true" className="fixed inset-0 z-10 grid place-items-center bg-stone-950/40 p-5" role="dialog"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"><h2 className="text-xl font-bold text-stone-900" id="replace-template-title">ยืนยันการเปลี่ยนเทมเพลตที่ใช้งาน</h2><p className="mt-2 text-stone-600">การเปิดใช้ {confirming.name} จะปิดใช้เทมเพลตเดิมสำหรับ {scopeName(confirming)}.</p><div className="mt-5 flex justify-end gap-3"><button className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => setConfirming(null)} type="button">ยกเลิก</button><button className="min-h-11 rounded-xl bg-amber-800 px-4 font-semibold text-white" onClick={() => { const template = confirming; setConfirming(null); startTransition(() => { void activate(template.id, true); }); }} type="button">ยืนยันการเปิดใช้</button></div></div></div> : null}
  </div>;
}
