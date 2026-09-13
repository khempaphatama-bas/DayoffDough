import Link from "next/link";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import { CycleForm } from "@/modules/cycles/ui/cycle-form";
import { CYCLE_STATUS_LABELS } from "@/modules/cycles/ui/cycle-list";
import { CycleStatusForm } from "@/modules/cycles/ui/cycle-status-form";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type {
  CycleOrderSummary,
  OrderDetail,
} from "@/modules/orders/application/orders";
import { OrderList } from "@/modules/orders/ui/order-list";
import { formatUnitLabel } from "@/modules/units/domain/units";

function formatCycleDate(value: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function formatCycleDateTime(value: Date | null): string {
  if (!value) return "ยังไม่กำหนด";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function ProductionFrozenWarning({
  status,
}: Readonly<{ status: BakeCycle["status"] }>) {
  if (status !== "LOCKED" && status !== "IN_PRODUCTION") return null;
  return (
    <div
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950"
      role="alert"
    >
      ข้อมูลที่กระทบการผลิตถูกล็อก กรุณาปลดล็อกรอบก่อนแก้ไข
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: Readonly<{ label: string; value: string; detail?: string }>) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-stone-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-stone-900">{value}</p>
      {detail ? <p className="mt-1 text-xs text-stone-500">{detail}</p> : null}
    </article>
  );
}

export function CycleDetail({
  cycle,
  summary,
  orders,
}: Readonly<{
  cycle: BakeCycle;
  summary: CycleOrderSummary;
  orders: ReadonlyArray<OrderDetail>;
}>) {
  const acceptsNewOrders = cycle.status === "DRAFT" || cycle.status === "OPEN";

  return (
    <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8">
      <header className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800"
            href="/cycles"
          >
            ← รอบอบ
          </Link>
          <p className="mt-4 text-sm font-bold text-amber-800">
            รอบ #{cycle.cycleNumber}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">
            {cycle.name}
          </h1>
          <p className="mt-2 text-stone-600">
            {CYCLE_STATUS_LABELS[cycle.status]} · ส่งหลัก{" "}
            {formatCycleDate(cycle.primaryDeliveryDate)}
          </p>
        </div>
        <div className="grid gap-3">
          {acceptsNewOrders ? (
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-amber-800 px-6 text-lg font-bold text-amber-900"
              href={`/orders/new?cycleId=${cycle.id}`}
            >
              เพิ่มออเดอร์
            </Link>
          ) : null}
          {cycle.status === "OPEN" ? (
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-800 px-6 text-lg font-bold text-white shadow-sm"
              href={`/cycles/${cycle.id}/planning`}
            >
              ตรวจแผนและล็อกรอบ
            </Link>
          ) : null}
          {cycle.activePlanningSnapshotId !== null ? (
            <>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-stone-900 px-6 text-lg font-bold text-white shadow-sm"
                href={`/cycles/${cycle.id}/planning`}
              >
                ดูแผนการผลิต
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-amber-800 px-6 text-lg font-bold text-amber-900"
                href={`/cycles/${cycle.id}/production`}
              >
                ดู Production Timeline
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-amber-800 px-6 text-lg font-bold text-amber-900"
                href={`/cycles/${cycle.id}/shopping`}
              >
                เช็กสต๊อกและรายการซื้อ
              </Link>
            </>
          ) : null}
        </div>
      </header>

      <ProductionFrozenWarning status={cycle.status} />

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-stone-500">สถานะรอบอบ</p>
          <p className="mt-1 text-xl font-bold text-stone-900">
            {CYCLE_STATUS_LABELS[cycle.status]}
          </p>
        </div>
        <CycleStatusForm cycleId={cycle.id} status={cycle.status} />
      </section>

      <section
        aria-labelledby="cycle-summary-heading"
        className="grid gap-4"
      >
        <h2 className="text-2xl font-bold text-stone-900" id="cycle-summary-heading">
          สรุปรอบผลิต
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            detail={`${summary.cancelledOrderCount} ออเดอร์ยกเลิก`}
            label="ออเดอร์ที่ใช้งาน"
            value={`${summary.activeOrderCount} ออเดอร์`}
          />
          <SummaryCard
            label="ยอดขาย"
            value={`฿${formatSatangAsBaht(summary.grandTotalSatang)}`}
          />
          <SummaryCard
            label="ชำระแล้ว"
            value={`฿${formatSatangAsBaht(summary.amountPaidSatang)}`}
          />
          <SummaryCard
            label="คงเหลือ"
            value={`฿${formatSatangAsBaht(summary.balanceSatang)}`}
          />
        </div>
      </section>

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-bold text-stone-900">ความต้องการผลิต</h2>
        {summary.demand.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-stone-600">
            ยังไม่มีสินค้าที่ต้องผลิต
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
            {summary.demand.map((item) => (
              <li
                className="flex min-h-14 items-center justify-between gap-4 px-4 py-3"
                key={item.productId}
              >
                <span className="font-semibold text-stone-900">
                  {item.productName}
                </span>
                <span className="text-lg font-bold text-amber-900">
                  {item.quantity} {formatUnitLabel(item.sellingUnit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4">
        <h2 className="text-2xl font-bold text-stone-900">ออเดอร์ในรอบนี้</h2>
        <OrderList orders={orders} />
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-2xl font-bold text-stone-900">ข้อมูลรอบอบ</h2>
          <dl className="mt-4 grid gap-4 rounded-2xl bg-stone-100 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-stone-500">วันปิดรับออเดอร์</dt>
              <dd className="mt-1 font-semibold text-stone-800">
                {formatCycleDateTime(cycle.orderCutoffAt)}
              </dd>
            </div>
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
              <dt className="text-stone-500">หมายเหตุ</dt>
              <dd className="mt-1 text-stone-700">
                {cycle.notes || "ยังไม่มีหมายเหตุ"}
              </dd>
            </div>
          </dl>
        </div>
        <CycleForm cycle={cycle} />
      </section>
    </main>
  );
}
