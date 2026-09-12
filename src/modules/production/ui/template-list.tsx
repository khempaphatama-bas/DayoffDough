"use client";

import Link from "next/link";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  duplicateProductionTemplateAction,
  setProductionTemplateActiveAction,
  type TemplateMutationActionState,
} from "@/app/(app)/production/templates/actions";
import type {
  ProductionTemplateListView,
  ProductionTemplateSummary,
} from "@/modules/production/application/template-service";

type ListCallback = (
  templateId: string,
  active?: boolean,
) => Promise<TemplateMutationActionState | void> | TemplateMutationActionState | void;

function scopeName(template: ProductionTemplateSummary): string {
  return template.scope === "CYCLE" ? "ทั้งรอบผลิต" : template.productName ?? "สินค้า";
}

function status(template: ProductionTemplateSummary): string {
  return template.active ? "กำลังใช้งาน" : "ยังไม่เปิดใช้";
}

function replacementConflict(
  candidate: ProductionTemplateSummary,
  template: ProductionTemplateSummary,
): boolean {
  return candidate.active && candidate.id !== template.id && candidate.scope === template.scope && (
    candidate.scope === "CYCLE" || candidate.productId === template.productId
  );
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
  const [feedback, setFeedback] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const activate = async (templateId: string, active: boolean) => {
    const result = onSetActive
      ? await onSetActive(templateId, active)
      : await defaultActiveAction(templateId, active);
    if (result?.error) setFeedback(result.error);
  };
  const duplicate = async (templateId: string) => {
    const result = onDuplicate
      ? await onDuplicate(templateId)
      : await defaultDuplicateAction(templateId);
    if (result?.error) setFeedback(result.error);
  };

  function closeConfirmation() {
    setConfirming(null);
    openerRef.current?.focus();
  }

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!buttons || buttons.length === 0) return;
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const renderGroup = (title: string, templates: ReadonlyArray<ProductionTemplateSummary>) => (
    <section className="grid gap-4">
      <h2 className="text-2xl font-bold text-stone-900">{title}</h2>
      {templates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-white/60 p-5 text-sm text-stone-600">ยังไม่มีเทมเพลต</p>
      ) : templates.map((template) => (
        <article className="flex flex-col justify-between gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center" key={template.id}>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-stone-900">{template.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-700"}`}>{status(template)}</span></div>
            <p className="mt-1 text-sm text-stone-600">{scopeName(template)} · {template.activeActivityCount} กิจกรรมที่ใช้งาน</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link aria-label={`แก้ไข ${template.name}`} className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4 font-semibold" href={`/production/templates/${template.id}`}>แก้ไข</Link>
            <button className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => startTransition(() => { void duplicate(template.id); })} type="button">ทำสำเนา</button>
            {template.active ? <button aria-label={`ปิดใช้เทมเพลต ${template.name}`} className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => startTransition(() => { void activate(template.id, false); })} type="button">ปิดใช้</button> : <button aria-label={`เปิดใช้เทมเพลต ${template.name}`} className="min-h-11 rounded-xl bg-amber-800 px-4 font-semibold text-white" onClick={(event) => { setFeedback(null); if (templates.some((candidate) => replacementConflict(candidate, template))) { openerRef.current = event.currentTarget; setConfirming(template); } else startTransition(() => { void activate(template.id, true); }); }} type="button">เปิดใช้</button>}
          </div>
        </article>
      ))}
    </section>
  );

  return <div className="grid gap-8">
    {feedback ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{feedback}</p> : null}
    {view.productsMissingReadyTemplate.length > 0 ? <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-950">สินค้าที่ยังไม่มีเทมเพลตพร้อมใช้</h2><ul className="mt-2 list-disc pl-5 text-sm text-amber-900">{view.productsMissingReadyTemplate.map((product) => <li key={product.id}>{product.name}</li>)}</ul></aside> : null}
    {renderGroup("เทมเพลตทั้งรอบผลิต", view.cycleTemplates)}
    {renderGroup("เทมเพลตต่อสินค้า", view.productTemplates)}
    {confirming ? <div aria-labelledby="replace-template-title" aria-modal="true" className="fixed inset-0 z-10 grid place-items-center bg-stone-950/40 p-5" onKeyDown={onDialogKeyDown} ref={dialogRef} role="dialog"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"><h2 className="text-xl font-bold text-stone-900" id="replace-template-title">ยืนยันการเปลี่ยนเทมเพลตที่ใช้งาน</h2><p className="mt-2 text-stone-600">การเปิดใช้ {confirming.name} จะปิดใช้เทมเพลตเดิมสำหรับ {scopeName(confirming)}.</p><div className="mt-5 flex justify-end gap-3"><button className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={closeConfirmation} ref={cancelRef} type="button">ยกเลิก</button><button className="min-h-11 rounded-xl bg-amber-800 px-4 font-semibold text-white" onClick={() => { const template = confirming; closeConfirmation(); startTransition(() => { void activate(template.id, true); }); }} type="button">ยืนยันการเปิดใช้</button></div></div></div> : null}
  </div>;
}

async function defaultDuplicateAction(templateId: string): Promise<TemplateMutationActionState> {
  const data = new FormData();
  data.set("templateId", templateId);
  return duplicateProductionTemplateAction(data);
}

async function defaultActiveAction(templateId: string, active: boolean): Promise<TemplateMutationActionState> {
  const data = new FormData();
  data.set("templateId", templateId);
  data.set("active", String(active));
  return setProductionTemplateActiveAction(data);
}
