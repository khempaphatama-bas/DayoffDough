import Link from "next/link";
import {
  CYCLE_STATUS_LABELS,
  type BakeCycle,
  type BakeCycleStatus,
} from "@/modules/cycles/domain/cycle-lifecycle";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type { CycleOrderSummary } from "@/modules/orders/application/orders";

export { CYCLE_STATUS_LABELS } from "@/modules/cycles/domain/cycle-lifecycle";

function formatCycleDate(value: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function StatusBadge({ status }: Readonly<{ status: BakeCycleStatus }>) {
  const color =
    status === "OPEN"
      ? "bg-emerald-50 text-emerald-800"
      : status === "IN_PRODUCTION"
        ? "bg-blue-50 text-blue-800"
        : status === "CANCELLED"
          ? "bg-red-50 text-red-700"
          : "bg-stone-100 text-stone-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
      {CYCLE_STATUS_LABELS[status]}
    </span>
  );
}

export function CycleList({
  cycles,
  query,
  status,
  summaries,
}: Readonly<{
  cycles: ReadonlyArray<BakeCycle>;
  query: string;
  status: "all" | BakeCycleStatus;
  summaries: ReadonlyMap<string, CycleOrderSummary>;
}>) {
  return (
    <section className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
        method="get"
      >
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ค้นหารอบอบ
          <input
            className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
            defaultValue={query}
            name="query"
            placeholder="ชื่อรอบอบ"
            type="search"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          สถานะ
          <select
            className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
            defaultValue={status}
            name="status"
          >
            <option value="all">ทั้งหมด</option>
            {Object.entries(CYCLE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="min-h-11 self-end rounded-xl border border-stone-800 px-5 font-semibold"
          type="submit"
        >
          ค้นหา
        </button>
      </form>

      {cycles.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">
          ยังไม่พบรอบอบที่ค้นหา
        </div>
      ) : (
        <>
          <div className="grid gap-3 xl:hidden">
            {cycles.map((cycle) => (
              <article
                className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
                key={cycle.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-amber-800">
                      #{cycle.cycleNumber}
                    </p>
                    <Link
                      className="mt-1 inline-flex min-h-11 items-center font-bold text-stone-900"
                      href={`/cycles/${cycle.id}`}
                    >
                      {cycle.name}
                    </Link>
                  </div>
                  <StatusBadge status={cycle.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-stone-500">วันผลิต</dt>
                    <dd className="mt-1 font-semibold text-stone-800">
                      {formatCycleDate(cycle.targetProductionDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">วันส่งหลัก</dt>
                    <dd className="mt-1 font-semibold text-stone-800">
                      {formatCycleDate(cycle.primaryDeliveryDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">ออเดอร์</dt>
                    <dd className="mt-1 font-semibold text-stone-800">
                      {summaries.get(cycle.id)?.activeOrderCount ?? 0} ใช้งาน ·{" "}
                      {summaries.get(cycle.id)?.cancelledOrderCount ?? 0} ยกเลิก
                    </dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">ยอดขาย</dt>
                    <dd className="mt-1 font-bold text-stone-900">
                      ฿{formatSatangAsBaht(
                        summaries.get(cycle.id)?.grandTotalSatang ?? 0,
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm xl:block">
            <div className="grid grid-cols-[4rem_minmax(0,1fr)_8rem_8rem_8rem_10rem_7rem] gap-4 border-b border-stone-200 bg-stone-50 px-5 py-3 text-xs font-bold text-stone-500">
              <span>รอบ</span>
              <span>ชื่อรอบอบ</span>
              <span>สถานะ</span>
              <span>วันผลิต</span>
              <span>วันส่งหลัก</span>
              <span>ออเดอร์</span>
              <span>ยอดขาย</span>
            </div>
            {cycles.map((cycle) => (
              <article
                className="grid grid-cols-[4rem_minmax(0,1fr)_8rem_8rem_8rem_10rem_7rem] items-center gap-4 border-b border-stone-100 px-5 py-4 last:border-b-0"
                key={cycle.id}
              >
                <span className="text-sm font-bold text-amber-800">
                  #{cycle.cycleNumber}
                </span>
                <Link
                  className="inline-flex min-h-11 items-center font-semibold text-stone-900 hover:text-amber-800"
                  href={`/cycles/${cycle.id}`}
                >
                  {cycle.name}
                </Link>
                <div>
                  <StatusBadge status={cycle.status} />
                </div>
                <span className="text-sm text-stone-700">
                  {formatCycleDate(cycle.targetProductionDate)}
                </span>
                <span className="text-sm font-semibold text-stone-800">
                  {formatCycleDate(cycle.primaryDeliveryDate)}
                </span>
                <span className="text-sm text-stone-700">
                  {summaries.get(cycle.id)?.activeOrderCount ?? 0} ใช้งาน ·{" "}
                  {summaries.get(cycle.id)?.cancelledOrderCount ?? 0} ยกเลิก
                </span>
                <span className="font-bold text-stone-900">
                  ฿{formatSatangAsBaht(
                    summaries.get(cycle.id)?.grandTotalSatang ?? 0,
                  )}
                </span>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
