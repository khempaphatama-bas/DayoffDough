import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createCycleService } from "@/modules/cycles/application/cycles";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { PlanningGenerationView } from "@/modules/planning/ui/planning-generation-view";
import { PlanningPreviewForm } from "@/modules/planning/ui/planning-preview-form";
import { UnlockCycleForm } from "@/modules/planning/ui/unlock-cycle-form";

function parseGeneration(
  raw: string | ReadonlyArray<string> | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return undefined;
  const generation = Number(raw);
  return Number.isSafeInteger(generation) ? generation : undefined;
}

export default async function PlanningPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ generation?: string | ReadonlyArray<string> }>;
}>) {
  const owner = await requireOwner();
  const { id } = await params;
  const rawGeneration = (searchParams ? await searchParams : {}).generation;
  const selectedGeneration = parseGeneration(rawGeneration);
  if (rawGeneration !== undefined && selectedGeneration === undefined) {
    notFound();
  }
  const cycleService = createCycleService(db);
  const planningQueries = createPlanningQueryService(db);
  let cycle: Awaited<ReturnType<typeof cycleService.get>>;
  let generations: Awaited<ReturnType<typeof planningQueries.listGenerations>>;
  let preview: Awaited<ReturnType<typeof planningQueries.preview>> | null;
  let generationView: Awaited<
    ReturnType<typeof planningQueries.getGeneration>
  > | null;
  let noLockedPlan = false;

  try {
    cycle = await cycleService.get(owner.id, id);
    generations = await planningQueries.listGenerations(owner.id, id);
    preview = null;
    generationView = null;
    if (selectedGeneration !== undefined) {
      generationView = await planningQueries.getGeneration(
        owner.id,
        id,
        selectedGeneration,
      );
    } else if (cycle.status === "OPEN") {
      preview = await planningQueries.preview(owner.id, id);
    } else if (
      (cycle.status === "COMPLETED" || cycle.status === "CANCELLED") &&
      cycle.activePlanningSnapshotId === null
    ) {
      noLockedPlan = true;
    } else if (cycle.status !== "DRAFT") {
      generationView = await planningQueries.getGeneration(owner.id, id);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Cycle not found" ||
        error.message === "Planning generation not found")
    ) {
      notFound();
    }
    throw error;
  }
  const displayedCycleName = generationView?.cycleName ?? cycle.name;

  return (
    <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8">
      <header>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800"
          href={`/cycles/${cycle.id}`}
        >
          ← {displayedCycleName}
        </Link>
        <p className="mt-4 text-sm font-bold text-amber-800">
          รอบ #{cycle.cycleNumber}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">
          วางแผนการผลิต
        </h1>
      </header>

      {cycle.status === "DRAFT" ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-5 font-semibold text-amber-950">
          กรุณาเปิดรอบผลิตก่อน
        </p>
      ) : null}
      {preview ? <PlanningPreviewForm preview={preview} /> : null}
      {generationView ? (
        <PlanningGenerationView
          cycleId={cycle.id}
          generation={generationView}
          generations={generations}
        />
      ) : null}
      {cycle.status === "LOCKED" || cycle.status === "IN_PRODUCTION" ? (
        <UnlockCycleForm cycleId={cycle.id} status={cycle.status} />
      ) : null}
      {noLockedPlan ? (
        <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700 shadow-sm">
          รอบนี้ไม่มีแผนที่ล็อกไว้
        </p>
      ) : null}
    </main>
  );
}
