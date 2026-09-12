import Link from "next/link";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createProductionTemplateService } from "@/modules/production/application/template-service";
import { TemplateList } from "@/modules/production/ui/template-list";

export default async function TemplatePage() {
  const owner = await requireOwner();
  const view = await createProductionTemplateService(db).list(owner.id);
  return <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8"><header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-sm font-semibold text-amber-800">เตรียมงานล่วงหน้าก่อนวันส่ง</p><h1 className="text-3xl font-bold tracking-tight text-stone-900">เทมเพลตการผลิต</h1><p className="mt-2 text-stone-600">ตั้งกิจกรรมประจำรอบหรือสินค้า เพื่อสร้างตารางผลิตที่สม่ำเสมอ</p></div><Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-800 px-5 font-semibold text-white" href="/production/templates/new">สร้างเทมเพลต</Link></header><TemplateList view={view} /></main>;
}
