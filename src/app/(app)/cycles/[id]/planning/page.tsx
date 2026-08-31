import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createCycleService } from "@/modules/cycles/application/cycles";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { PlanningPreviewForm } from "@/modules/planning/ui/planning-preview-form";

export default async function PlanningPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const cycleService = createCycleService(db);
  const planningQueries = createPlanningQueryService(db);
  let cycle: Awaited<ReturnType<typeof cycleService.get>>;
  let generations: Awaited<ReturnType<typeof planningQueries.listGenerations>>;
  let preview: Awaited<ReturnType<typeof planningQueries.preview>> | null;

  try {
    cycle = await cycleService.get(owner.id, id);
    generations = await planningQueries.listGenerations(owner.id, id);
    preview =
      cycle.status === "OPEN"
        ? await planningQueries.preview(owner.id, id)
        : null;
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

  return (
    <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8">
      <header>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800"
          href={`/cycles/${cycle.id}`}
        >
          ← {cycle.name}
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
      {cycle.status !== "DRAFT" && cycle.status !== "OPEN" ? (
        <p className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-700 shadow-sm">
          มีแผนที่ล็อกไว้ {generations.length} รุ่น
        </p>
      ) : null}
    </main>
  );
}
