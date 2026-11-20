import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { InventoryForm } from "@/modules/inventory/ui/inventory-form";
import { InventoryList } from "@/modules/inventory/ui/inventory-list";
import { createInventoryItemAction } from "./actions";

export default async function InventoryPage() {
  const owner = await requireOwner();
  const items = await createInventoryService(db).listItems(owner.id);
  const listItems = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    ingredientKind: item.ingredientKind,
    stockBalance: item.stockBalance,
    baseUnit: item.baseUnit,
    latestPackPriceSatang: item.latestPrice?.packPriceSatang ?? null,
    active: item.active,
  }));

  return (
    <main className="mx-auto grid max-w-6xl gap-7 px-5 py-8">
      <header>
        <p className="mb-2 text-sm font-semibold text-amber-800">ต้นทุนและสต๊อก</p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">วัตถุดิบและบรรจุภัณฑ์</h1>
        <p className="mt-2 text-stone-600">เก็บขนาดแพ็ก ประวัติราคา และยอดที่นับได้จริง</p>
      </header>
      <InventoryForm action={createInventoryItemAction} />
      <InventoryList items={listItems} />
    </main>
  );
}
