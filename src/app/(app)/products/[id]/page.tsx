import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { createProductService } from "@/modules/products/application/products";
import { ActivateVersionButton } from "@/modules/products/ui/activate-version-button";
import { RecipeVersionForm } from "@/modules/products/ui/recipe-version-form";

export default async function ProductDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const productService = createProductService(db);
  let product;
  try {
    product = await productService.getProductDetail(owner.id, id);
  } catch (error) {
    if (error instanceof Error && error.message === "Product not found") notFound();
    throw error;
  }
  const inventory = await createInventoryService(db).listItems(owner.id);
  const ingredientOptions = inventory
    .filter((item) => item.category === "INGREDIENT" && item.active)
    .map((item) => ({ id: item.id, name: item.name, baseUnit: item.baseUnit }));

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <Link className="text-sm font-semibold text-amber-800" href="/products">← สินค้าและสูตร</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">{product.name}</h1>
        <p className="mt-2 text-stone-600">฿{formatSatangAsBaht(product.defaultUnitPriceSatang)} ต่อ {product.sellingUnit}</p>
      </header>

      <RecipeVersionForm defaultYieldUnit={product.sellingUnit} ingredientOptions={ingredientOptions} productId={product.id} />

      <section className="grid gap-4">
        <div><h2 className="text-2xl font-bold text-stone-900">เวอร์ชันสูตร</h2><p className="mt-1 text-sm text-stone-600">เวอร์ชันที่บันทึกแล้วจะไม่ถูกแก้ทับ</p></div>
        {product.versions.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">ยังไม่มีเวอร์ชันสูตร</div>
        ) : (
          product.versions.map((version) => {
            const active = product.activeRecipeVersionId === version.id;
            return (
              <article className="grid gap-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm" key={version.id}>
                <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-bold text-stone-900">{version.versionCode}</h3>{active ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">สูตรที่ใช้งานอยู่</span> : null}</div><p className="mt-1 text-sm text-stone-600">ได้ {version.baseYieldQuantity} {version.yieldUnit} · แรงงาน {version.laborMinutesPerBatch} นาที · ค่าไฟ/แก๊ส ฿{formatSatangAsBaht(version.utilityCostSatangPerBatch)}</p></div>{!active ? <ActivateVersionButton productId={product.id} versionId={version.id} /> : null}</div>
                <div><h4 className="font-semibold text-stone-800">วัตถุดิบ</h4><ul className="mt-2 grid gap-2 text-sm text-stone-600">{version.ingredients.map((ingredient) => <li className="flex justify-between gap-4 rounded-xl bg-stone-50 px-4 py-3" key={ingredient.id}><span>{ingredient.inventoryItemName}</span><span className="font-medium text-stone-900">{ingredient.quantityInBaseUnit} {ingredient.baseUnit}</span></li>)}</ul></div>
                {version.instructions ? <div><h4 className="font-semibold text-stone-800">วิธีทำ</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-600">{version.instructions}</p></div> : null}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
