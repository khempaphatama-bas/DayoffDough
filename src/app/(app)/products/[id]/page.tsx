import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { isPrepOnly } from "@/modules/inventory/domain/ingredient-kind";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { createProductService, type RecipeVersion } from "@/modules/products/application/products";
import { RecipeVersionControls, RecipeVersionForm } from "@/modules/products/ui/recipe-version-form";
import { formatUnitLabel } from "@/modules/units/domain/units";

export default async function ProductDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ template?: string | string[]; restartTemplate?: string | string[] }>;
}>) {
  const owner = await requireOwner();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const productService = createProductService(db);
  const [product, inventory] = await Promise.all([
    productService.getProductDetail(owner.id, id),
    createInventoryService(db).listCatalogItems(owner.id),
  ]).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Product not found") notFound();
    throw error;
  });
  const ingredientOptions = inventory
    .filter((item) => item.category === "INGREDIENT" && item.active)
    .map(({ id, name, baseUnit, ingredientKind }) => ({ id, name, baseUnit, ingredientKind }));
  const initialVersion = product.versions.find((version) => version.id === query?.template);
  const templateRestarted = query?.restartTemplate === "1";
  const selectable = product.versions.filter((version) => version.archivedAt === null);
  const history = product.versions.filter((version) => version.archivedAt !== null);

  function renderRecipeCard(version: RecipeVersion) {
    // A repeat click changes the draft key; refreshing the current URL does not.
    const restart = initialVersion?.id === version.id && !templateRestarted ? "&restartTemplate=1" : "";
    return (
      <RecipeCard
        active={version.archivedAt === null && product.activeRecipeVersionId === version.id}
        key={version.id}
        productId={product.id}
        templateHref={`?template=${version.id}${restart}#recipe-editor`}
        version={version}
      />
    );
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <Link className="text-sm font-semibold text-amber-800" href="/products">← สินค้าและสูตร</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">{product.name}</h1>
        <p className="mt-2 text-stone-600">฿{formatSatangAsBaht(product.defaultUnitPriceSatang)} ต่อ {product.sellingUnit}</p>
      </header>

      <RecipeVersionForm
        {...(initialVersion ? { initialVersion } : {})}
        defaultYieldUnit={product.sellingUnit}
        ingredientOptions={ingredientOptions}
        key={initialVersion ? `${initialVersion.id}:${templateRestarted}` : product.id}
        productId={product.id}
      />

      <section aria-labelledby="selectable-recipes" className="grid gap-4">
        <div>
          <h2 className="text-2xl font-bold text-stone-900" id="selectable-recipes">เวอร์ชันสูตร</h2>
          <p className="mt-1 text-sm text-stone-600">บันทึกสูตรใหม่ได้โดยไม่แก้ทับสูตรเดิม การบันทึกไม่สลับสูตรที่ใช้งานอยู่</p>
        </div>
        {selectable.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">ยังไม่มีเวอร์ชันสูตร</div>
        ) : (
          selectable.map(renderRecipeCard)
        )}
      </section>
      {history.length > 0 ? (
        <section aria-labelledby="recipe-history" className="grid gap-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-900" id="recipe-history">ประวัติสูตร</h2>
            <p className="mt-1 text-sm text-stone-600">สูตรที่เก็บเข้าประวัติยังเปิดอ่านหรือใช้เป็นต้นแบบได้ แต่เปิดใช้งานโดยตรงไม่ได้</p>
          </div>
          {history.map(renderRecipeCard)}
        </section>
      ) : null}
    </main>
  );
}

function RecipeCard({ active, productId, templateHref, version }: Readonly<{
  active: boolean;
  productId: string;
  templateHref: string;
  version: RecipeVersion;
}>) {
  const archived = version.archivedAt !== null;
  const headingId = `recipe-${version.id}`;
  const status = archived ? "เก็บเข้าประวัติแล้ว" : active ? "สูตรที่ใช้งานอยู่" : "บันทึกแล้ว ยังไม่ได้ใช้งาน";

  return (
    <article aria-labelledby={headingId} className="grid min-w-0 gap-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-xl font-bold text-stone-900" id={headingId}>{version.versionCode}</h3>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-700"}`}>{status}</span>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          ได้ {version.baseYieldQuantity} {formatUnitLabel(version.yieldUnit)} · แรงงาน {version.laborMinutesPerBatch} นาที · ค่าไฟ/แก๊ส ฿{formatSatangAsBaht(version.utilityCostSatangPerBatch)}
          {version.wasteAllowancePercent !== null ? ` · ค่าเผื่อสูญเสีย ${version.wasteAllowancePercent}%` : ""}
        </p>
      </div>
      <div>
        <h4 className="font-semibold text-stone-800">วัตถุดิบ</h4>
        <ul className="mt-2 grid gap-2 text-sm text-stone-600">
          {version.ingredients.map((ingredient) => (
            <li className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-xl bg-stone-50 px-4 py-3" key={ingredient.id}>
              <div className="min-w-0 break-words">
                <span>{ingredient.inventoryItemName}</span>
                {!ingredient.itemActive ? <span className="text-amber-900"> · ปิดใช้งานแล้ว</span> : null}
                {isPrepOnly(ingredient.ingredientKind) ? <p className="text-xs text-stone-600">ไม่คิดต้นทุนและไม่ต้องนับสต๊อก</p> : null}
              </div>
              <span className="font-medium text-stone-900">{ingredient.quantityInBaseUnit} {formatUnitLabel(ingredient.baseUnit)}</span>
            </li>
          ))}
        </ul>
      </div>
      {version.instructions ? (
        <div>
          <h4 className="font-semibold text-stone-800">วิธีทำ</h4>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-stone-600">{version.instructions}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        <Link className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4 text-sm font-semibold text-stone-800 hover:bg-stone-50" href={templateHref} prefetch={false}>ใช้สูตรนี้เป็นต้นแบบ</Link>
        {!active && !archived ? <RecipeVersionControls productId={productId} versionId={version.id} /> : null}
      </div>
    </article>
  );
}
