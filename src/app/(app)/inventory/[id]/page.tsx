import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { PhysicalCountForm, PriceForm } from "@/modules/inventory/ui/price-form";
import { formatSatangAsBaht } from "@/modules/money/domain/money";

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
  let detail;
  try {
    detail = await createInventoryService(db).getItemDetail(owner.id, id);
  } catch (error) {
    if (error instanceof Error && error.message === "Inventory item not found") {
      notFound();
    }
    throw error;
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <Link className="text-sm font-semibold text-amber-800" href="/inventory">← วัตถุดิบและบรรจุภัณฑ์</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">{detail.name}</h1>
        <p className="mt-2 text-stone-600">{detail.purchaseUnitLabel} · หน่วยฐาน {detail.baseUnit}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">สต๊อกคงเหลือ</p><p className="mt-2 text-2xl font-bold">{detail.stockBalance} {detail.baseUnit}</p></article>
        <article className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">ราคาต่อแพ็กล่าสุด</p><p className="mt-2 text-2xl font-bold">{detail.latestPrice ? `฿${formatSatangAsBaht(detail.latestPrice.packPriceSatang)}` : "ยังไม่มีราคา"}</p></article>
        <article className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-500">ต้นทุนต่อ {detail.baseUnit}</p><p className="mt-2 text-2xl font-bold">{detail.latestUnitCostSatang ? `฿${detail.latestUnitCostSatang.div(100).toDecimalPlaces(4).toString()}` : "ต้นทุนไม่สมบูรณ์"}</p></article>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <PriceForm defaultDate={bangkokDateInputValue(new Date())} itemId={detail.id} packBaseQuantity={detail.baseQuantityPerPurchasePack} />
        <PhysicalCountForm itemId={detail.id} />
      </section>

      <section className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-5 py-4"><h2 className="text-xl font-bold">ประวัติราคา</h2></div>
        {detail.priceHistory.length === 0 ? (
          <p className="p-5 text-stone-600">ยังไม่มีราคา</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {detail.priceHistory.map((price) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" key={price.id}>
                <div><p className="font-semibold">฿{formatSatangAsBaht(price.packPriceSatang)}</p><p className="text-sm text-stone-500">{price.packBaseQuantity} {detail.baseUnit} ต่อแพ็ก</p></div>
                <div className="text-right text-sm text-stone-500"><p>{dateFormatter.format(price.effectiveAt)}</p>{price.purchasedFrom ? <p>{price.purchasedFrom}</p> : null}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
