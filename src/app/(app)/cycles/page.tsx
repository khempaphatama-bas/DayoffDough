import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  type BakeCycleFilters,
  createCycleService,
  type Phase2CycleStatus,
} from "@/modules/cycles/application/cycles";
import { CycleList } from "@/modules/cycles/ui/cycle-list";
import { createOrderService } from "@/modules/orders/application/orders";

type CycleSearchParams = Readonly<{
  query?: string | ReadonlyArray<string>;
  status?: string | ReadonlyArray<string>;
}>;

const PHASE_2_STATUSES: ReadonlyArray<Phase2CycleStatus> = [
  "DRAFT",
  "OPEN",
  "IN_PRODUCTION",
  "COMPLETED",
  "CANCELLED",
];

function firstValue(value: string | ReadonlyArray<string> | undefined): string {
  return typeof value === "string" ? value : value?.[0] ?? "";
}

function isPhase2Status(value: string): value is Phase2CycleStatus {
  return PHASE_2_STATUSES.some((status) => status === value);
}

export default async function CyclePage({
  searchParams,
}: Readonly<{ searchParams: Promise<CycleSearchParams> }>) {
  const owner = await requireOwner();
  const search = await searchParams;
  const query = firstValue(search.query);
  const statusValue = firstValue(search.status);
  const status = isPhase2Status(statusValue) ? statusValue : undefined;
  const filters: BakeCycleFilters = {
    query,
    ...(status ? { status } : {}),
  };
  const cycles = await createCycleService(db).list(owner.id, filters);
  const summaries = await createOrderService(db).listCycleSummaries(
    owner.id,
    cycles.map((cycle) => cycle.id),
  );

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm font-semibold text-amber-800">
            วางแผนรับออเดอร์และผลิต
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">
            รอบอบ
          </h1>
          <p className="mt-2 text-stone-600">
            กำหนดวันปิดรับออเดอร์ วันผลิต และวันส่งหลักของแต่ละรอบ
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-800 px-5 font-semibold text-white"
          href="/cycles/new"
        >
          สร้างรอบอบ
        </Link>
      </header>
      <CycleList
        cycles={cycles}
        query={query}
        status={status ?? "all"}
        summaries={summaries}
      />
    </main>
  );
}
