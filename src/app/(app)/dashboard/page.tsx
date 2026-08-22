import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createDeliveryService } from "@/modules/delivery/application/delivery";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { createProductService } from "@/modules/products/application/products";
import { evaluateMasterDataReadiness } from "@/modules/readiness/domain/readiness";
import { createSettingsService } from "@/modules/settings/application/settings";

export default async function DashboardPage() {
  const owner = await requireOwner();
  const [settings, inventory, products, delivery] = await Promise.all([
    createSettingsService(db).get(owner.id),
    createInventoryService(db).listItems(owner.id),
    createProductService(db).listProducts(owner.id),
    createDeliveryService(db).listDeliveryConfiguration(owner.id),
  ]);
  const activeProducts = products.filter((product) => product.active);
  const readiness = evaluateMasterDataReadiness({
    settingsConfigured: settings !== null,
    inventoryItemCount: inventory.filter((item) => item.active).length,
    inventoryPricedCount: inventory.filter(
      (item) => item.active && item.latestPrice !== null,
    ).length,
    productCount: activeProducts.length,
    activeRecipeCount: activeProducts.filter(
      (product) => product.activeRecipeVersionId !== null,
    ).length,
    deliveryMethodCount: delivery.methods.filter((method) => method.active).length,
  });

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-8 md:px-8 md:py-10">
      <header className="max-w-3xl">
        <p className="mb-2 text-sm font-semibold text-amber-800">Day Off Dough OS</p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">จัดข้อมูลตั้งต้นของร้านให้พร้อม</h1>
        <p className="mt-3 leading-7 text-stone-600">Phase แรกช่วยเก็บต้นทุนวัตถุดิบ สินค้า สูตร บรรจุภัณฑ์ และวิธีส่ง ก่อนเริ่มรับออเดอร์เป็น Bake Cycle</p>
      </header>

      <section className={`rounded-3xl border p-6 ${readiness.ready ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
        <p className="text-sm font-semibold">สถานะความพร้อม</p>
        <h2 className="mt-2 text-2xl font-bold">{readiness.message}</h2>
        <p className="mt-2 text-sm leading-6 opacity-80">{readiness.ready ? "พร้อมสำหรับเริ่มสร้าง Bake Cycle และรับออเดอร์ใน Phase ถัดไป" : "เปิดแต่ละหัวข้อด้านล่างเพื่อเติมข้อมูลที่ยังขาด"}</p>
      </section>

      <section aria-labelledby="readiness-heading" className="grid gap-4">
        <h2 className="text-2xl font-bold text-stone-900" id="readiness-heading">รายการตรวจความพร้อม</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {readiness.cards.map((card) => (
            <Link className="group flex min-h-36 flex-col justify-between rounded-3xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700" href={card.href} key={card.key}>
              <div className="flex items-start justify-between gap-3"><h3 className="font-bold text-stone-900">{card.label}</h3><span aria-hidden="true" className={`mt-1 h-2.5 w-2.5 rounded-full ${card.ready ? "bg-emerald-500" : "bg-amber-500"}`} /></div>
              <div className="mt-6 flex items-end justify-between gap-3"><p className={`text-sm font-semibold ${card.ready ? "text-emerald-700" : "text-amber-800"}`}>{card.status}</p><span className="text-stone-400 transition group-hover:translate-x-1 group-hover:text-amber-800" aria-hidden="true">→</span></div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
