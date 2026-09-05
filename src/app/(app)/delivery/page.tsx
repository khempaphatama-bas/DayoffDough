import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createDeliveryService } from "@/modules/delivery/application/delivery";
import { DeliveryMethodEditForm, DeliveryMethodForm } from "@/modules/delivery/ui/delivery-method-form";
import { PackagingRuleForm } from "@/modules/delivery/ui/packaging-rule-form";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { createProductService } from "@/modules/products/application/products";

const BASIS_LABELS = {
  PER_PRODUCT_UNIT: "ต่อหน่วยสินค้า",
  PER_ORDER: "ต่อออเดอร์ที่มีสินค้า",
  PER_DELIVERY: "ต่อการจัดส่ง",
} as const;

export default async function DeliveryPage() {
  const owner = await requireOwner();
  const [configuration, inventory, products] = await Promise.all([
    createDeliveryService(db).listDeliveryConfiguration(owner.id),
    createInventoryService(db).listCatalogItems(owner.id),
    createProductService(db).listProducts(owner.id),
  ]);
  const packagingItems = inventory
    .filter((item) =>
      (item.category === "PACKAGING" || item.category === "CONSUMABLE") && item.active,
    )
    .map((item) => ({ id: item.id, name: item.name, baseUnit: item.baseUnit }));

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-8">
      <header>
        <p className="mb-2 text-sm font-semibold text-amber-800">การรับสินค้าและบรรจุภัณฑ์</p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">การจัดส่ง</h1>
        <p className="mt-2 text-stone-600">ตั้งค่าค่าส่งที่เรียกเก็บ ต้นทุนจริง และวัสดุที่ใช้ตามวิธีส่ง</p>
      </header>

      <section className="grid gap-4">
        <div><h2 className="text-2xl font-bold text-stone-900">วิธีส่ง</h2><p className="mt-1 text-sm text-stone-600">เริ่มได้ด้วย Delivery หรือ KEX Same Day แล้วกำหนดราคาจริงของร้านเอง</p></div>
        <DeliveryMethodForm />
        {configuration.methods.length === 0 ? <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-7 text-stone-600">ยังไม่มีวิธีส่ง — เพิ่มชื่อ Delivery หรือ KEX Same Day ได้โดยระบบจะไม่ใส่ราคาให้เอง</div> : <div className="grid gap-4 lg:grid-cols-2">{configuration.methods.map((method) => <DeliveryMethodEditForm key={method.id} method={method} />)}</div>}
      </section>

      <section className="grid gap-4">
        <div><h2 className="text-2xl font-bold text-stone-900">กฎบรรจุภัณฑ์</h2><p className="mt-1 text-sm text-stone-600">กำหนดถุง กล่อง หรือวัสดุสิ้นเปลืองตามสินค้าหรือวิธีส่ง</p></div>
        <PackagingRuleForm deliveryMethods={configuration.methods.map((method) => ({ id: method.id, name: method.name }))} packagingItems={packagingItems} products={products.map((product) => ({ id: product.id, name: product.name }))} />
        {configuration.rules.length === 0 ? <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-7 text-stone-600">ยังไม่มีกฎบรรจุภัณฑ์</div> : <div className="grid gap-3">{configuration.rules.map((rule) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" key={rule.id}><div><p className="font-bold text-stone-900">{rule.targetName}</p><p className="mt-1 text-sm text-stone-600">{rule.inventoryItemName} · {BASIS_LABELS[rule.consumptionBasis]}</p></div><p className="font-semibold">{rule.quantityInBaseUnit} {rule.inventoryBaseUnit}</p></article>)}</div>}
      </section>
    </main>
  );
}
