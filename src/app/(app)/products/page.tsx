import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { formatSatangAsBaht } from "@/modules/money/domain/money";
import { createProductService } from "@/modules/products/application/products";
import { ProductForm } from "@/modules/products/ui/product-form";

export default async function ProductsPage() {
  const owner = await requireOwner();
  const products = await createProductService(db).listProducts(owner.id);

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <p className="mb-2 text-sm font-semibold text-amber-800">เมนูและการผลิต</p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">สินค้าและสูตร</h1>
        <p className="mt-2 text-stone-600">เก็บราคาขาย ผลผลิต และสูตรแบบแยกเวอร์ชัน</p>
      </header>
      <ProductForm />
      {products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">ยังไม่มีสินค้า เริ่มจากเพิ่มสินค้ารายการแรก</div>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {products.map((product) => (
              <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" key={product.id}>
                <div className="flex items-start justify-between gap-4"><div><Link className="font-bold text-stone-900 underline decoration-amber-500 underline-offset-4" href={`/products/${product.id}`}>{product.name}</Link><p className="mt-1 text-sm text-stone-500">฿{formatSatangAsBaht(product.defaultUnitPriceSatang)} / {product.sellingUnit}</p></div>{product.activeRecipeVersionId ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">มีสูตรใช้งาน</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">ยังไม่มีสูตรใช้งาน</span>}</div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm md:block">
            <table className="w-full border-collapse text-left text-sm"><thead className="bg-stone-100 text-stone-600"><tr><th className="px-5 py-4">สินค้า</th><th className="px-5 py-4">หน่วยขาย</th><th className="px-5 py-4">ราคาขาย</th><th className="px-5 py-4">สูตร</th></tr></thead><tbody>{products.map((product) => <tr className="border-t border-stone-100" key={product.id}><td className="px-5 py-4"><Link className="font-semibold text-stone-900 underline decoration-amber-500 underline-offset-4" href={`/products/${product.id}`}>{product.name}</Link></td><td className="px-5 py-4">{product.sellingUnit}</td><td className="px-5 py-4">฿{formatSatangAsBaht(product.defaultUnitPriceSatang)}</td><td className="px-5 py-4">{product.activeRecipeVersionId ? "สูตรพร้อมใช้งาน" : "ยังไม่มีสูตรใช้งาน"}</td></tr>)}</tbody></table>
          </div>
        </>
      )}
    </main>
  );
}
