import Link from "next/link";
import { confirmUseAction, correctUseAction } from "@/app/(app)/cycles/[id]/consumption/actions";
import type { CycleConsumptionView } from "../domain/types";
import { UsageForm } from "./usage-form";
import { UsageHistory } from "./usage-history";

const READONLY_LABELS = {
  LEGACY: "รอบเดิม · อ่านอย่างเดียว ไม่มีการสร้างประวัติหักสต๊อกย้อนหลัง",
  HISTORY: "ประวัติรุ่นที่ถูกแทนที่ · อ่านอย่างเดียว",
  NO_PLAN: "รอบนี้ไม่มีแผนที่ล็อกไว้ · อ่านอย่างเดียว",
  NOT_STARTED: "ยังไม่ได้เริ่มผลิต · อ่านอย่างเดียว",
};

export function ConsumptionView({ view }: Readonly<{ view: CycleConsumptionView }>) {
  const matchingSource = view.source && view.context && view.source.contextId === view.context.id && view.source.cycleId === view.cycle.cycleId && view.source.planningSnapshotId === view.cycle.planningSnapshotId;
  const canConfirm = view.canConfirm && matchingSource && !view.currentRevision && !view.context?.currentRevisionId;
  const canCorrect = view.canCorrect && matchingSource && view.currentRevision && view.context?.currentRevisionId === view.currentRevision.id && view.currentRevision.contextId === view.context.id;
  const readonlyLabel = view.kind in READONLY_LABELS ? READONLY_LABELS[view.kind as keyof typeof READONLY_LABELS] : null;
  return (
    <div className="grid min-w-0 gap-6">
      <section className="grid min-w-0 gap-2 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-bold text-stone-900">{view.cycle.generation === null ? "ยอดใช้การผลิต" : `แผนรุ่น ${view.cycle.generation}`}</h2>
        {readonlyLabel ? <p className="text-sm text-stone-600">{readonlyLabel}</p> : <p className="text-sm text-stone-600">{view.kind === "RECORDED" ? "มียอดใช้ที่บันทึกแล้ว แก้ไขโดยเพิ่มประวัติใหม่" : "รอยืนยันยอดใช้หลังผลิตเสร็จ"}</p>}
      </section>
      {view.generations.length > 0 ? (
        <nav aria-label="ประวัติรุ่นยอดใช้" className="grid min-w-0 gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-stone-900">ประวัติรุ่นยอดใช้</h2>
          <ul className="grid gap-2 sm:grid-cols-2">{view.generations.map(generation => {
            const active = generation.status === "ACTIVE";
            const status = active ? "ใช้งานอยู่" : "แทนที่แล้ว";
            return <li key={generation.id}><Link aria-current={generation.generation === view.cycle.generation ? "page" : undefined} aria-label={`เปิดยอดใช้รุ่น ${generation.generation} · ${status}`} className="flex min-h-11 items-center rounded-xl bg-stone-50 px-4 font-bold text-amber-900" href={`/cycles/${view.cycle.cycleId}/consumption${active ? "" : `?generation=${generation.generation}`}`}>รุ่น {generation.generation} · {status}</Link></li>;
          })}</ul>
        </nav>
      ) : null}
      {canConfirm ? <UsageForm view={view} mode="CONFIRM" action={confirmUseAction} /> : null}
      {canCorrect ? <UsageForm view={view} mode="CORRECT" action={correctUseAction} /> : null}
      {!readonlyLabel && !canConfirm && !canCorrect ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">ยังไม่พร้อมบันทึก กรุณาเปิดข้อมูลล่าสุด</p> : null}
      <UsageHistory revisions={view.history} />
    </div>
  );
}
