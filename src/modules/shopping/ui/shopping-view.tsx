import Decimal from "decimal.js";
import Link from "next/link";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import type {
  CycleInventoryCountView,
  CyclePurchaseEntryView,
  CycleShoppingItemView,
  HistoryView,
  ShoppingView as ShoppingViewData,
  ShoppingStatus,
} from "@/modules/shopping/domain/types";
import { formatUnitLabel } from "@/modules/units/domain/units";
import { PurchaseForm } from "./purchase-form";

const STATUS_LABELS: Readonly<Record<ShoppingStatus, string>> = {
  TO_BUY: "ต้องซื้อ",
  PARTIAL: "ซื้อบางส่วน",
  COMPLETE: "ซื้อครบ",
};

const STATUS_CLASSES: Readonly<Record<ShoppingStatus, string>> = {
  TO_BUY: "bg-amber-100 text-amber-950",
  PARTIAL: "bg-blue-100 text-blue-950",
  COMPLETE: "bg-emerald-100 text-emerald-950",
};

function formatQuantity(value: Decimal.Value): string {
  return new Decimal(value).toString();
}

function formatBangkokDateTime(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function GenerationHistory({
  view,
}: Readonly<{ view: ShoppingViewData | HistoryView }>) {
  return (
    <nav
      aria-label="ประวัติรุ่นเช็กสต๊อกและรายการซื้อ"
      className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-lg font-bold text-stone-900">ประวัติรายการซื้อ</h2>
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
  );
}

function CountHistory({
  counts,
}: Readonly<{ counts: ReadonlyArray<CycleInventoryCountView> }>) {
  return (
    <section
      aria-label="ผลการนับสต๊อก"
      className="grid gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-lg font-bold text-stone-900">ผลการนับสต๊อก</h2>
      <ul className="grid gap-2 text-sm">
        {counts.map((count) => (
          <li className="rounded-xl bg-stone-50 px-4 py-3" key={count.id}>
            <span className="font-bold text-stone-900">
              {count.inventoryItemName}
            </span>{" "}
            นับได้ {formatQuantity(count.countedQuantity)}{" "}
            {formatUnitLabel(count.baseUnit)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PurchaseHistory({
  item,
}: Readonly<{ item: CycleShoppingItemView }>) {
  const unit = formatUnitLabel(item.baseUnit);
  if (item.purchases.length === 0) {
    return <p className="text-sm text-stone-500">ยังไม่มีประวัติการซื้อ</p>;
  }
  return (
    <section aria-label={`ประวัติการซื้อ ${item.inventoryItemName}`}>
      <h4 className="font-bold text-stone-900">ประวัติการซื้อ</h4>
      <ul className="mt-2 grid gap-2">
        {item.purchases.map((purchase: CyclePurchaseEntryView) => (
          <li
            className="grid gap-1 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm"
            key={purchase.id}
          >
            <p className="font-semibold text-stone-900">
              ซื้อ {formatQuantity(purchase.purchasedQuantity)} {unit} ·{" "}
              {purchase.packCount} {item.purchaseUnitLabel} · ฿
              {formatSatangAsBaht(purchase.totalPriceSatang)}
            </p>
            <p className="text-stone-500">
              {formatBangkokDateTime(purchase.occurredAt)}
              {purchase.purchasedFrom ? ` · ${purchase.purchasedFrom}` : ""}
            </p>
            {purchase.notes ? (
              <p className="text-stone-600">{purchase.notes}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShoppingItemCard({
  item,
  writable,
}: Readonly<{ item: CycleShoppingItemView; writable: boolean }>) {
  const unit = formatUnitLabel(item.baseUnit);
  return (
    <article
      aria-label={item.inventoryItemName}
      className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-stone-900">
            {item.inventoryItemName}
          </h3>
          <p className="mt-1 text-sm text-stone-500">
            {item.inventoryCategory === "INGREDIENT"
              ? "วัตถุดิบ"
              : "บรรจุภัณฑ์"}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold ${STATUS_CLASSES[item.progress.status]}`}
        >
          {STATUS_LABELS[item.progress.status]}
        </span>
      </div>

      <dl className="grid gap-3 rounded-2xl bg-stone-50 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-stone-500">จำนวนที่ต้องใช้</dt>
          <dd className="font-semibold text-stone-900">
            ต้องใช้ {formatQuantity(item.requiredQuantity)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">จำนวนที่นับจริง</dt>
          <dd className="font-semibold text-stone-900">
            นับได้ {formatQuantity(item.countedQuantity)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">จำนวนที่ขาด</dt>
          <dd className="font-semibold text-stone-900">
            ขาด {formatQuantity(item.shortfallQuantity)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">ขนาดต่อหน่วยซื้อ</dt>
          <dd className="font-semibold text-stone-900">
            1 {item.purchaseUnitLabel} ={" "}
            {formatQuantity(item.baseQuantityPerPurchasePack)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">จำนวนแนะนำ</dt>
          <dd className="font-semibold text-stone-900">
            แนะนำ {item.suggestedPackCount} {item.purchaseUnitLabel} ·{" "}
            {formatQuantity(item.suggestedPurchaseQuantity)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">ซื้อแล้ว</dt>
          <dd className="font-semibold text-stone-900">
            ซื้อแล้ว {formatQuantity(item.progress.purchasedQuantity)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">จำนวนที่ยังขาด</dt>
          <dd className="font-semibold text-stone-900">
            เหลือ {formatQuantity(item.progress.remainingQuantity)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">ราคาประมาณ</dt>
          <dd className="font-semibold text-stone-900">
            {item.estimatedCostSatang === null
              ? "ยังไม่มีราคาประมาณ"
              : `ราคาประมาณ ฿${formatSatangAsBaht(item.estimatedCostSatang)}`}
          </dd>
        </div>
      </dl>

      {formatQuantity(item.progress.overageQuantity) !== "0" ? (
        <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900">
          ซื้อเกินความต้องการ {formatQuantity(item.progress.overageQuantity)}{" "}
          {unit}
        </p>
      ) : null}

      <PurchaseHistory item={item} />
      {writable ? <PurchaseForm item={item} /> : null}
    </article>
  );
}

export function ShoppingView({
  view,
}: Readonly<{ view: ShoppingViewData | HistoryView }>) {
  const completeCount = view.items.filter(
    (item) => item.progress.status === "COMPLETE",
  ).length;
  const knownEstimatedTotal = view.items.reduce(
    (total, item) => total + (item.estimatedCostSatang ?? 0),
    0,
  );

  return (
    <div className="grid gap-6">
      <section className="grid gap-2 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-stone-900">
            แผนรุ่น {view.cycle.generation}
          </h2>
          {view.writable ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">
              ใช้งานอยู่
            </span>
          ) : (
            <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-bold text-stone-700">
              ประวัติ · อ่านอย่างเดียว
            </span>
          )}
        </div>
        {view.confirmedAt ? (
          <p className="text-sm text-stone-600">
            ยืนยันสต๊อกเมื่อ {formatBangkokDateTime(view.confirmedAt)}
          </p>
        ) : null}
      </section>

      <GenerationHistory view={view} />

      {view.counts.length === 0 ? (
        <section className="rounded-3xl border border-stone-200 bg-white p-5 text-stone-700 shadow-sm">
          <h2 className="text-xl font-bold text-stone-900">
            ไม่มีการยืนยันสต๊อกสำหรับรุ่นนี้
          </h2>
          <p className="mt-2 text-sm">
            รุ่นนี้ถูกแทนที่หรือปิดรอบก่อนมีการบันทึกยอดนับ
          </p>
        </section>
      ) : (
        <>
          <section
            aria-label="สรุปรายการซื้อ"
            className="grid gap-3 rounded-3xl bg-stone-900 p-5 text-white sm:grid-cols-2 lg:grid-cols-4"
          >
            <p className="font-bold">รายการต้องซื้อ {view.items.length}</p>
            <p className="font-bold">ซื้อครบ {completeCount}</p>
            <p className="font-bold">
              ยังไม่ครบ {view.items.length - completeCount}
            </p>
            <p className="font-bold">
              ยอดประมาณที่ทราบ ฿{formatSatangAsBaht(knownEstimatedTotal)}
            </p>
          </section>

          <CountHistory counts={view.counts} />

          {view.items.length === 0 ? (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
              <h2 className="text-xl font-bold">
                สต๊อกเพียงพอสำหรับรอบนี้
              </h2>
              <p className="mt-2 text-sm">
                ไม่ต้องสร้างรายการซื้อเพิ่มจากยอดนับชุดนี้
              </p>
            </section>
          ) : (
            <section aria-labelledby="shopping-items-heading" className="grid gap-4">
              <h2
                className="text-xl font-bold text-stone-900"
                id="shopping-items-heading"
              >
                รายการที่ต้องซื้อ
              </h2>
              {view.items.map((item) => (
                <ShoppingItemCard
                  item={item}
                  key={item.id}
                  writable={view.writable}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
