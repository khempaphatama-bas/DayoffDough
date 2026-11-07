"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import { createConsumptionActionSupport } from "@/modules/consumption/application/action-support";
import { ConsumptionStateError, type ConsumptionBlocker } from "@/modules/consumption/domain/types";

export type InventoryActionState = Readonly<{
  error: string | null;
  saved: boolean;
  blockers?: readonly ConsumptionBlocker[];
}>;

const itemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["INGREDIENT", "PACKAGING", "CONSUMABLE"]),
  baseUnit: z.enum(["mg", "g", "kg", "ml", "l", "piece"]),
  purchaseUnitLabel: z.string().min(1),
  baseQuantityPerPurchasePack: z.string().min(1),
  minimumStockQuantity: z.string().min(1),
  notes: z.string(),
});

const priceSchema = z.object({
  itemId: z.string().uuid(),
  packPriceBaht: z.string().min(1),
  packBaseQuantity: z.string().min(1),
  effectiveDate: z.iso.date(),
  purchasedFrom: z.string(),
  notes: z.string(),
});

const countSchema = z.object({
  itemId: z.string().uuid(),
  countedQuantity: z.string().min(1),
});

export async function createInventoryItemAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    baseUnit: formData.get("baseUnit"),
    purchaseUnitLabel: formData.get("purchaseUnitLabel"),
    baseQuantityPerPurchasePack: formData.get("baseQuantityPerPurchasePack"),
    minimumStockQuantity: formData.get("minimumStockQuantity"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบข้อมูลรายการ", saved: false };
  }
  try {
    await createInventoryService(db).createItem(owner.id, parsed.data);
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch {
    return { error: "บันทึกรายการไม่สำเร็จ ชื่อรายการอาจซ้ำหรือข้อมูลไม่ถูกต้อง", saved: false };
  }
}

export async function addInventoryPriceAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const parsed = priceSchema.safeParse({
    itemId: formData.get("itemId"),
    packPriceBaht: formData.get("packPriceBaht"),
    packBaseQuantity: formData.get("packBaseQuantity"),
    effectiveDate: formData.get("effectiveDate"),
    purchasedFrom: formData.get("purchasedFrom") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบข้อมูลราคา", saved: false };
  }
  try {
    await createInventoryService(db).addPrice(owner.id, parsed.data.itemId, {
      packPriceSatang: parseBahtToSatang(parsed.data.packPriceBaht),
      packBaseQuantity: parsed.data.packBaseQuantity,
      effectiveAt: new Date(`${parsed.data.effectiveDate}T00:00:00+07:00`),
      purchasedFrom: parsed.data.purchasedFrom,
      notes: parsed.data.notes,
    });
    revalidatePath(`/inventory/${parsed.data.itemId}`);
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch {
    return { error: "บันทึกราคาไม่สำเร็จ กรุณาตรวจสอบจำนวนและราคา", saved: false };
  }
}

export async function recordInventoryCountAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const parsed = countSchema.safeParse({
    itemId: formData.get("itemId"),
    countedQuantity: formData.get("countedQuantity"),
  });
  if (!parsed.success) {
    return { error: "กรุณากรอกจำนวนที่นับได้", saved: false };
  }
  try {
    await createInventoryService(db).recordCount(
      owner.id,
      parsed.data.itemId,
      parsed.data.countedQuantity,
      new Date(),
    );
    revalidatePath(`/inventory/${parsed.data.itemId}`);
    revalidatePath("/inventory");
    return { error: null, saved: true };
  } catch (error) {
    if (error instanceof ConsumptionStateError) {
      try {
        const safe = await createConsumptionActionSupport(db).mapError(owner.id, error);
        if (safe) return { error: safe.error, saved: false, blockers: safe.blockers };
      } catch { /* Keep database errors private. */ }
    }
    return { error: "บันทึกยอดนับไม่สำเร็จ กรุณาตรวจสอบจำนวน", saved: false };
  }
}
