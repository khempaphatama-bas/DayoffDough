import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import {
  type BakeCycle,
  createCycleService,
} from "@/modules/cycles/application/cycles";
import { CycleForm } from "@/modules/cycles/ui/cycle-form";
import { CYCLE_STATUS_LABELS } from "@/modules/cycles/ui/cycle-list";
import { CycleStatusForm } from "@/modules/cycles/ui/cycle-status-form";

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

export function CycleDetail({ cycle }: Readonly<{ cycle: BakeCycle }>) {
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
            {CYCLE_STATUS_LABELS[cycle.status]} · ส่งหลัก {formatCycleDate(cycle.primaryDeliveryDate)}
          </p>
        </div>
        <Link
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-800 px-6 text-lg font-bold text-white shadow-sm"
          href={`/orders/new?cycleId=${cycle.id}`}
        >
          เพิ่มออเดอร์
        </Link>
      </header>

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-stone-500">สถานะรอบอบ</p>
          <p className="mt-1 text-xl font-bold text-stone-900">
            {CYCLE_STATUS_LABELS[cycle.status]}
          </p>
        </div>
        <CycleStatusForm cycleId={cycle.id} status={cycle.status} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-6">
          <h2 className="text-xl font-bold text-stone-900">ยอดออเดอร์</h2>
          <p className="mt-2 text-stone-600">
            ยังไม่มีสรุปยอดออเดอร์ในขั้นตอนนี้
          </p>
          <p className="mt-1 text-sm text-stone-500">
            เมื่อเชื่อมออเดอร์เข้ากับรอบอบแล้ว จำนวนออเดอร์และยอดขายจะแสดงที่นี่
          </p>
        </article>
        <article className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-6">
          <h2 className="text-xl font-bold text-stone-900">ความต้องการผลิต</h2>
          <p className="mt-2 text-stone-600">
            ยังไม่มีสรุปความต้องการผลิตในขั้นตอนนี้
          </p>
          <p className="mt-1 text-sm text-stone-500">
            เมื่อมีรายการสินค้าในออเดอร์ จำนวนที่ต้องผลิตจะแสดงที่นี่
          </p>
        </article>
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

export default async function CycleDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const cycle = await createCycleService(db).get(owner.id, id);
  return <CycleDetail cycle={cycle} />;
}
