import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createConsumptionQueryService } from "@/modules/consumption/application/consumption-queries";
import { ConsumptionStateError } from "@/modules/consumption/domain/types";
import { ConsumptionView } from "@/modules/consumption/ui/consumption-view";

function parseGeneration(raw: string | readonly string[] | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const generation = Number(raw);
  return Number.isSafeInteger(generation) ? generation : null;
}

export default async function ConsumptionPage({ params, searchParams }: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ generation?: string | readonly string[]; mode?: string | readonly string[]; countItem?: string | readonly string[] }>;
}>) {
  const owner = await requireOwner();
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const generation = parseGeneration(search.generation);
  if (generation === null) notFound();
  const settle = search.mode === "settle";
  const selection = settle ? z.array(z.string().uuid().transform(id => id.toLowerCase())).nonempty().safeParse(typeof search.countItem === "string" ? [search.countItem] : search.countItem) : null;
  if (settle && (!selection?.success || new Set(selection.data).size !== selection.data.length || generation !== undefined)) notFound();
  const queries = createConsumptionQueryService(db);
  let view: Awaited<ReturnType<typeof queries.getCycleConsumption>>;
  let settlement: Awaited<ReturnType<typeof queries.getSettlementPreview>> | undefined;
  try {
    view = await queries.getCycleConsumption(owner.id, id, generation);
    if (selection?.success) settlement = await queries.getSettlementPreview(owner.id, selection.data);
  } catch (error) {
    if (error instanceof ConsumptionStateError && error.kind === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="mx-auto grid min-w-0 max-w-5xl gap-7 px-5 py-8">
      <header className="min-w-0">
        <Link className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-amber-800 [overflow-wrap:anywhere]" href={`/cycles/${view.cycle.cycleId}`}>← {view.cycle.cycleName}</Link>
        <p className="mt-4 text-sm font-bold text-amber-800">รอบ #{view.cycle.cycleNumber}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">บันทึกยอดใช้การผลิต</h1>
      </header>
      <ConsumptionView view={view} {...(settlement ? { settlement } : {})} />
    </main>
  );
}
