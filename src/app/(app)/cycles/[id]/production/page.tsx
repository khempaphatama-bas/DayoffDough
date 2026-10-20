import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createProductionQueryService } from "@/modules/production/application/production-queries";
import { CycleTaskList, ProductionGenerationLinks } from "@/modules/production/ui/cycle-task-list";
import type { CycleProductionView } from "@/modules/production/domain/types";

function parsePositiveGeneration(raw: string | ReadonlyArray<string> | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const generation = Number(raw);
  return Number.isSafeInteger(generation) ? generation : null;
}

function NoGeneration({ view }: Readonly<{ view: Extract<CycleProductionView, { kind: "NO_GENERATION" }> }>) {
  const canRelock = view.cycle.cycleStatus === "LOCKED" || view.cycle.cycleStatus === "IN_PRODUCTION";
  return (
    <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-stone-900">{view.reason === "LEGACY_SNAPSHOT" ? "รอบรุ่นนี้ยังไม่มี Production Timeline" : "รอบนี้ยังไม่มีแผน Production Timeline"}</h2>
      {view.reason === "LEGACY_SNAPSHOT" ? <p className="text-stone-700">ข้อมูลรุ่นนี้เกิดก่อนระบบ Production Timeline จึงเปิดดูงานไม่ได้</p> : <p className="text-stone-700">เมื่อมีแผนที่ล็อกแล้ว งานผลิตจะปรากฏที่นี่</p>}
      {canRelock ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">ปลดล็อก/ล็อกแผนใหม่ได้จากหน้าแผนการผลิต</p> : null}
    </section>
  );
}

export default async function ProductionPage({ params, searchParams }: Readonly<{ params: Promise<{ id: string }>; searchParams?: Promise<{ generation?: string | ReadonlyArray<string> }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const rawGeneration = (searchParams ? await searchParams : {}).generation;
  const generation = parsePositiveGeneration(rawGeneration);
  if (generation === null) notFound();
  let view: CycleProductionView;
  try {
    view = await createProductionQueryService(db).getCycleProduction(owner.id, id, generation);
  } catch (error) {
    if (error instanceof Error && error.message === "Production generation not found") notFound();
    throw error;
  }
  return (
    <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8">
      <header>
        <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800" href={`/cycles/${view.cycle.cycleId}`}>← {view.cycle.cycleName}</Link>
        <p className="mt-4 text-sm font-bold text-amber-800">รอบ #{view.cycle.cycleNumber}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">Production Timeline</h1>
        {view.kind === "CURRENT" ? <Link className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-800 px-5 font-bold text-white" href={`/cycles/${view.cycle.cycleId}/operations`}>{view.cycle.cycleStatus === "COMPLETED" || view.cycle.cycleStatus === "CANCELLED" ? "ดู Operations" : "เปิด Operations"}</Link> : null}
        {view.kind !== "NO_GENERATION" ? <p className="mt-2 text-sm font-semibold text-stone-700">วันส่งหลัก: {view.generation.primaryDeliveryDate}</p> : null}
      </header>
      {view.kind === "NO_GENERATION" ? <NoGeneration view={view} /> : <><CycleTaskList view={view} /><ProductionGenerationLinks view={view} />{view.generation.planningStatus === "ACTIVE" && (view.cycle.cycleStatus === "LOCKED" || view.cycle.cycleStatus === "IN_PRODUCTION") ? <p className="text-sm text-stone-600">ปลดล็อกเพื่อสร้างรุ่นใหม่ได้จากหน้าแผนการผลิต</p> : null}</>}
    </main>
  );
}
