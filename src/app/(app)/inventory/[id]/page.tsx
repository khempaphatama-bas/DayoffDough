import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { findPendingConsumption } from "@/modules/consumption/application/count-barrier";
import { createInventoryService, InventoryMaintenanceError } from "@/modules/inventory/application/inventory";
import { isPrepOnly } from "@/modules/inventory/domain/ingredient-kind";
import { ArchiveInventoryForm, InventoryForm } from "@/modules/inventory/ui/inventory-form";
import { PhysicalCountForm, PriceForm } from "@/modules/inventory/ui/price-form";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { formatUnitLabel } from "@/modules/units/domain/units";
import { archiveInventoryItemAction, updateInventoryItemAction } from "../actions";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeZone: "Asia/Bangkok",
});

function bangkokDateInputValue(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

export default async function InventoryDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const inventory = createInventoryService(db);
  let detail;
  try {
    detail = await inventory.getItemDetail(owner.id, id);
  } catch (error) {
    if (error instanceof InventoryMaintenanceError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  // The editor receives plain item fields, not the Decimal cost or history.
  const { stockBalance, latestPrice, latestUnitCostSatang, priceHistory, ...item } = detail;
  const prepOnly = isPrepOnly(item.ingredientKind);
  const canRecordStock = item.active && !prepOnly;
  const [editPolicy, blockers] = await Promise.all([
    item.active ? inventory.getItemEditPolicy(owner.id, item.id) : null,
    canRecordStock ? findPendingConsumption(db, owner.id, [item.id]) : [],
  ]);
  const unitLabel = item.baseUnit === "l" ? "L" : formatUnitLabel(item.baseUnit);

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <Link className="text-sm font-semibold text-amber-800" href="/inventory">← วัตถุดิบและบรรจุภัณฑ์</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">{item.name}</h1>
        <p className="mt-2 text-stone-600">{prepOnly ? (item.ingredientKind === "WATER" ? "น้ำ" : "น้ำแข็ง") : item.purchaseUnitLabel} · หน่วยฐาน {unitLabel}</p>
        {!item.active ? <p className="mt-2 text-sm font-semibold text-stone-600">ปิดใช้งาน</p> : null}
        {prepOnly && !editPolicy ? <p className="mt-2 text-sm text-stone-600">ไม่คิดต้นทุนและไม่ต้องนับสต๊อก</p> : null}
      </header>

      {!prepOnly ? <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">สต๊อกคงเหลือ</p><p className="mt-2 text-2xl font-bold">{stockBalance} {unitLabel}</p></article>
        <article className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">ราคาต่อแพ็กล่าสุด</p><p className="mt-2 text-2xl font-bold">{latestPrice ? `฿${formatSatangAsBaht(latestPrice.packPriceSatang)}` : "ยังไม่มีราคา"}</p></article>
        <article className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">ต้นทุนต่อ {unitLabel}</p><p className="mt-2 text-2xl font-bold">{latestUnitCostSatang ? `฿${latestUnitCostSatang.div(100).toDecimalPlaces(4).toString()}` : "ต้นทุนไม่สมบูรณ์"}</p></article>
      </section> : null}

      {item.active && editPolicy ? <InventoryForm action={updateInventoryItemAction} editPolicy={editPolicy} initialItem={item} key={item.id} /> : null}

      {canRecordStock ? <section className="grid gap-5 lg:grid-cols-2">
        <PriceForm baseUnit={item.baseUnit} defaultDate={bangkokDateInputValue(new Date())} itemId={item.id} key={`price:${item.id}`} packBaseQuantity={item.baseQuantityPerPurchasePack} />
        <PhysicalCountForm baseUnit={item.baseUnit} itemId={item.id} key={`count:${item.id}`} blockers={blockers} />
      </section> : null}

      {!prepOnly || priceHistory.length > 0 ? <section className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-5 py-4"><h2 className="text-xl font-bold">ประวัติราคา</h2></div>
        {priceHistory.length === 0 ? (
          <p className="p-5 text-stone-600">ยังไม่มีราคา</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {priceHistory.map((price) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" key={price.id}>
                <div><p className="font-semibold">฿{formatSatangAsBaht(price.packPriceSatang)}</p><p className="text-sm text-stone-500">{price.packBaseQuantity} {unitLabel} ต่อแพ็ก</p></div>
                <div className="text-right text-sm text-stone-500"><p>{dateFormatter.format(price.effectiveAt)}</p>{price.purchasedFrom ? <p>{price.purchasedFrom}</p> : null}</div>
              </li>
            ))}
          </ul>
        )}
      </section> : null}
      {item.active ? <ArchiveInventoryForm action={archiveInventoryItemAction} itemId={item.id} key={`archive:${item.id}`} /> : null}
    </main>
  );
}
