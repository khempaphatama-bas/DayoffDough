import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createProductService } from "@/modules/products/application/products";
import { TemplateForm } from "@/modules/production/ui/template-form";

export default async function NewProductionTemplatePage() {
  const owner = await requireOwner();
  const products = (await createProductService(db).listProducts(owner.id)).filter((product) => product.active).map((product) => ({ id: product.id, name: product.name }));
  return <main className="mx-auto grid max-w-4xl gap-7 px-5 py-8"><header><Link className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800" href="/production/templates">← เทมเพลตการผลิต</Link><h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">สร้างเทมเพลตการผลิต</h1><p className="mt-2 text-stone-600">เพิ่มกิจกรรมและกำหนดเวลาย้อนจากวันส่งสินค้า</p></header><TemplateForm products={products} /></main>;
}
