"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatSatangAsBaht } from "@/modules/money/domain/money";

type InventoryListItem = Readonly<{
  id: string;
  name: string;
  category: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
  stockBalance: string;
  baseUnit: string;
  latestPackPriceSatang: number | null;
  active: boolean;
}>;

const CATEGORY_LABELS: Record<InventoryListItem["category"], string> = {
  INGREDIENT: "วัตถุดิบ",
  PACKAGING: "บรรจุภัณฑ์",
  CONSUMABLE: "วัสดุสิ้นเปลือง",
};

function Price({ satang }: Readonly<{ satang: number | null }>) {
  return satang === null ? (
    <span className="font-medium text-amber-800">ยังไม่มีราคา</span>
  ) : (
    <span>฿{formatSatangAsBaht(satang)}</span>
  );
}

export function InventoryList({ items }: Readonly<{ items: ReadonlyArray<InventoryListItem> }>) {
  const [query, setQuery] = useState("");
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th");
    if (!normalized) return items;
    return items.filter((item) => item.name.toLocaleLowerCase("th").includes(normalized));
  }, [items, query]);

  return (
    <section className="grid gap-4">
      <label className="grid max-w-md gap-2 text-sm font-semibold text-stone-700">
        ค้นหารายการ
        <input
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ชื่อวัตถุดิบหรือบรรจุภัณฑ์"
          type="search"
          value={query}
        />
      </label>

      {visibleItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-stone-600">
          ยังไม่พบรายการที่ค้นหา
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {visibleItems.map((item) => (
              <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" key={item.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link className="font-bold text-stone-900 underline decoration-amber-500 underline-offset-4" href={`/inventory/${item.id}`}>
                      {item.name}
                    </Link>
                    <p className="mt-1 text-sm text-stone-500">{CATEGORY_LABELS[item.category]}</p>
                  </div>
                  {!item.active ? <span className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-500">ปิดใช้งาน</span> : null}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-stone-500">คงเหลือ</dt><dd className="mt-1 font-semibold">{item.stockBalance} {item.baseUnit}</dd></div>
                  <div><dt className="text-stone-500">ราคาล่าสุด</dt><dd className="mt-1"><Price satang={item.latestPackPriceSatang} /></dd></div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm md:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-100 text-stone-600">
                <tr><th className="px-5 py-4">รายการ</th><th className="px-5 py-4">ประเภท</th><th className="px-5 py-4">คงเหลือ</th><th className="px-5 py-4">ราคาต่อแพ็กล่าสุด</th></tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr className="border-t border-stone-100" key={item.id}>
                    <td className="px-5 py-4"><Link className="font-semibold text-stone-900 underline decoration-amber-500 underline-offset-4" href={`/inventory/${item.id}`}>{item.name}</Link></td>
                    <td className="px-5 py-4 text-stone-600">{CATEGORY_LABELS[item.category]}</td>
                    <td className="px-5 py-4">{item.stockBalance} {item.baseUnit}</td>
                    <td className="px-5 py-4"><Price satang={item.latestPackPriceSatang} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
