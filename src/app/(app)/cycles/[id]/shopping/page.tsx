import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createShoppingQueryService } from "@/modules/shopping/application/shopping-queries";
import type {
  CountRequiredView,
  NoPlanView,
} from "@/modules/shopping/domain/types";
import { ShoppingView } from "@/modules/shopping/ui/shopping-view";
import { StockCountForm } from "@/modules/shopping/ui/stock-count-form";

function parseGeneration(
  raw: string | ReadonlyArray<string> | undefined,
): number | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const generation = Number(raw);
  return Number.isSafeInteger(generation) ? generation : null;
}

function GenerationNavigation({
  view,
}: Readonly<{ view: CountRequiredView | NoPlanView }>) {
  return (
    <div className="grid gap-6">
      {view.cycle.generation !== null ? (
        <section className="grid gap-2 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-stone-900">
              แผนรุ่น {view.cycle.generation}
            </h2>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">
              ใช้งานอยู่
            </span>
          </div>
        </section>
      ) : null}

      {view.generations.length > 0 ? (
        <nav
          aria-label="ประวัติรุ่นเช็กสต๊อกและรายการซื้อ"
          className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-bold text-stone-900">
            ประวัติรายการซื้อ
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {view.generations.map((generation) => {
              const active = generation.status === "ACTIVE";
              const statusLabel = active ? "ใช้งานอยู่" : "แทนที่แล้ว";
              return (
                <li key={generation.id}>
                  <Link
                    aria-current={
                      generation.generation === view.cycle.generation
                        ? "page"
                        : undefined
                    }
                    aria-label={`เปิดรายการซื้อรุ่น ${generation.generation} · ${statusLabel}`}
                    className="flex min-h-11 items-center rounded-xl bg-stone-50 px-4 font-bold text-amber-900"
                    href={
                      active
                        ? `/cycles/${view.cycle.cycleId}/shopping`
                        : `/cycles/${view.cycle.cycleId}/shopping?generation=${generation.generation}`
                    }
                  >
                    รุ่น {generation.generation} · {statusLabel}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

export default async function ShoppingPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    generation?: string | ReadonlyArray<string>;
  }>;
}>) {
  const owner = await requireOwner();
  const { id } = await params;
  const rawGeneration = (searchParams ? await searchParams : {}).generation;
  const generation = parseGeneration(rawGeneration);
  if (generation === null) notFound();

  const shoppingQueries = createShoppingQueryService(db);
  let view: Awaited<ReturnType<typeof shoppingQueries.getCycleStockCheck>>;
  try {
    view = await shoppingQueries.getCycleStockCheck(owner.id, id, generation);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Shopping generation not found"
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
          href={`/cycles/${view.cycle.cycleId}`}
        >
          ← {view.cycle.cycleName}
        </Link>
        <p className="mt-4 text-sm font-bold text-amber-800">
          รอบ #{view.cycle.cycleNumber}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">
          เช็กสต๊อกและรายการซื้อ
        </h1>
      </header>

      {view.kind === "COUNT_REQUIRED" ? (
        <>
          <GenerationNavigation view={view} />
          <StockCountForm view={view} />
        </>
      ) : null}
      {view.kind === "SHOPPING" || view.kind === "HISTORY" ? (
        <ShoppingView view={view} />
      ) : null}
      {view.kind === "NO_PLAN" ? (
        <>
          <GenerationNavigation view={view} />
          <section className="rounded-3xl border border-stone-200 bg-white p-5 text-stone-700 shadow-sm">
            <h2 className="text-xl font-bold text-stone-900">
              รอบนี้ไม่มีแผนที่ล็อกไว้
            </h2>
            <p className="mt-2 text-sm">
              เปิดรอบและล็อกแผนการผลิตก่อนเริ่มเช็กสต๊อก
            </p>
          </section>
        </>
      ) : null}
    </main>
  );
}
