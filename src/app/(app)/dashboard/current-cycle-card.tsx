import Link from "next/link";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type { CycleOrderSummary } from "@/modules/orders/application/orders";
import {
  formatUnitLabel,
  type UnitCode,
} from "@/modules/units/domain/units";

export function selectNearestOpenCycle(
  cycles: ReadonlyArray<BakeCycle>,
): BakeCycle | null {
  return (
    [...cycles]
      .filter((cycle) => cycle.status === "OPEN")
      .sort(
        (left, right) =>
          left.primaryDeliveryDate.localeCompare(right.primaryDeliveryDate) ||
          left.cycleNumber - right.cycleNumber,
      )[0] ?? null
  );
}

function formatDeliveryDate(value: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function formatDemandUnits(summary: CycleOrderSummary): string {
  const totalsByUnit = new Map<UnitCode, number>();
  for (const item of summary.demand) {
    const total = (totalsByUnit.get(item.sellingUnit) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Cycle demand exceeds the safe integer range");
    }
    totalsByUnit.set(item.sellingUnit, total);
  }
  if (totalsByUnit.size === 0) return "0 ชิ้น";
  return [...totalsByUnit].map(
    ([unit, quantity]) => `${quantity} ${formatUnitLabel(unit)}`,
  ).join(" · ");
}

type CurrentCycleCardProps =
  | Readonly<{ cycle: BakeCycle; summary: CycleOrderSummary }>
  | Readonly<{ cycle: null; summary: null }>;

export function CurrentCycleCard(props: CurrentCycleCardProps) {
  if (props.cycle === null) {
    return (
      <section className="grid gap-4 rounded-3xl border border-dashed border-amber-300 bg-amber-50 p-6">
        <div>
          <p className="text-sm font-semibold text-amber-800">รอบผลิตถัดไป</p>
          <h2 className="mt-2 text-2xl font-bold text-stone-900">
            ยังไม่มีรอบผลิตที่เปิดรับออเดอร์
          </h2>
          <p className="mt-2 text-stone-600">
            เปิดรอบผลิตเพื่อเริ่มบันทึกออเดอร์และดูจำนวนสินค้าที่ต้องทำ
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl bg-amber-800 px-5 font-semibold text-white"
          href="/cycles/new"
        >
          เปิดรอบผลิต
        </Link>
      </section>
    );
  }

  const { cycle, summary } = props;
  return (
    <section className="grid gap-5 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div>
          <p className="text-sm font-semibold text-amber-800">รอบผลิตถัดไป</p>
          <h2 className="mt-2 text-2xl font-bold text-stone-900">
            {cycle.name}
          </h2>
          <p className="mt-2 text-stone-600">
            วันส่งหลัก {formatDeliveryDate(cycle.primaryDeliveryDate)}
          </p>
        </div>
        <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
          เปิดรับออเดอร์
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-4">
          <dt className="text-xs font-semibold text-stone-500">ออเดอร์</dt>
          <dd className="mt-1 text-xl font-bold text-stone-900">
            {summary.activeOrderCount} ออเดอร์
          </dd>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <dt className="text-xs font-semibold text-stone-500">สินค้าที่ต้องผลิต</dt>
          <dd className="mt-1 text-xl font-bold text-stone-900">
            {formatDemandUnits(summary)}
          </dd>
        </div>
        <div className="col-span-2 rounded-2xl bg-white p-4 lg:col-span-1">
          <dt className="text-xs font-semibold text-stone-500">ยอดขาย</dt>
          <dd className="mt-1 text-xl font-bold text-stone-900">
            ฿{formatSatangAsBaht(summary.grandTotalSatang)}
          </dd>
        </div>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-800 px-5 font-semibold text-white"
          href={`/orders/new?cycleId=${cycle.id}`}
        >
          เพิ่มออเดอร์
        </Link>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-800 px-5 font-semibold text-amber-900"
          href={`/cycles/${cycle.id}`}
        >
          ดูรอบผลิต
        </Link>
      </div>
    </section>
  );
}
