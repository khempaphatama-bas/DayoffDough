import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createProductionTemplateService, TemplateStateError } from "@/modules/production/application/template-service";
import { createProductService } from "@/modules/products/application/products";
import { TemplateForm } from "@/modules/production/ui/template-form";

export default async function ProductionTemplateDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  const [template, products] = await Promise.all([
    createProductionTemplateService(db).get(owner.id, id),
    createProductService(db).listProducts(owner.id),
  ]).catch((error: unknown) => {
    if (error instanceof TemplateStateError) notFound();
    throw error;
  });
  return <main className="mx-auto grid max-w-4xl gap-7 px-5 py-8"><header><Link className="inline-flex min-h-11 items-center text-sm font-semibold text-amber-800" href="/production/templates">← เทมเพลตการผลิต</Link><h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">{template.name}</h1><p className="mt-2 text-stone-600">แก้ไขกิจกรรมโดยไม่ลบประวัติเดิม</p></header><TemplateForm initialTemplate={template} products={products.filter((product) => product.active).map((product) => ({ id: product.id, name: product.name }))} /></main>;
}
