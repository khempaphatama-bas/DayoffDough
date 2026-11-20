"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createInventoryService, InventoryMaintenanceError } from "@/modules/inventory/application/inventory";
import { ingredientKinds } from "@/modules/inventory/domain/ingredient-kind";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import { createConsumptionActionSupport } from "@/modules/consumption/application/action-support";
import { ConsumptionStateError, type ConsumptionBlocker } from "@/modules/consumption/domain/types";

export type InventoryActionState = Readonly<{
  error: string | null;
  saved: boolean;
  blockers?: readonly ConsumptionBlocker[];
}>;

const baseUnitSchema = z.enum(["mg", "g", "kg", "ml", "l", "piece"]);
const itemIdSchema = z.string().uuid();
const itemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["INGREDIENT", "PACKAGING", "CONSUMABLE"]),
  ingredientKind: z.enum(ingredientKinds).default("STANDARD"),
  baseUnit: baseUnitSchema,
  notes: z.string(),
});
const purchaseSchema = z.object({
  purchaseUnitLabel: z.string().min(1),
  baseQuantityPerPurchasePack: z.string().min(1),
  minimumStockQuantity: z.string().min(1),
});

const priceSchema = z.object({
  itemId: itemIdSchema,
  expectedBaseUnit: baseUnitSchema,
  packPriceBaht: z.string().min(1),
  packBaseQuantity: z.string().min(1),
  effectiveDate: z.iso.date(),
  purchasedFrom: z.string(),
  notes: z.string(),
});

const countSchema = z.object({
  itemId: itemIdSchema,
  expectedBaseUnit: baseUnitSchema,
  countedQuantity: z.string().min(1),
});

function readItemForm(formData: FormData) {
  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    ingredientKind: formData.get("ingredientKind") ?? undefined,
    baseUnit: formData.get("baseUnit"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return null;
  if (parsed.data.ingredientKind !== "STANDARD") return parsed.data;
  const purchase = purchaseSchema.safeParse({
    purchaseUnitLabel: formData.get("purchaseUnitLabel"),
    baseQuantityPerPurchasePack: formData.get("baseQuantityPerPurchasePack"),
    minimumStockQuantity: formData.get("minimumStockQuantity"),
  });
  return purchase.success ? { ...parsed.data, ...purchase.data } : null;
}

const maintenanceGuidance: Record<InventoryMaintenanceError["code"], string> = {
  NOT_FOUND: "ไม่พบรายการนี้ กรุณาเปิดรายการจากหน้าวัตถุดิบอีกครั้ง",
  INACTIVE: "รายการนี้ปิดใช้งานแล้ว กรุณาโหลดข้อมูลล่าสุด",
  IDENTITY_IN_USE: "รายการนี้เคยถูกใช้แล้ว หากต้องการเปลี่ยนหน่วยฐาน ประเภท หรือชนิด ให้เพิ่มรายการใหม่แทน",
  PACK_IN_USE: "รอบผลิตที่ยังไม่จบใช้ขนาดแพ็กนี้อยู่ กรุณาจบรอบนั้นก่อนเปลี่ยนชื่อหน่วยซื้อหรือปริมาณต่อแพ็ก",
  ACTIVE_RECIPE: "รายการนี้ยังอยู่ในสูตรที่ใช้งานอยู่ ให้เปลี่ยนวัตถุดิบในสูตรที่ใช้งานก่อนปิดใช้งาน",
  PACKAGING_RULE: "รายการนี้ยังอยู่ในกฎบรรจุภัณฑ์ จึงปิดใช้งานไม่ได้ ดูกฎที่อ้างถึงรายการนี้ได้ที่หน้าการจัดส่ง หากต้องการใช้วัสดุอื่น ให้เพิ่มเป็นรายการใหม่และคงรายการเดิมไว้สำหรับกฎนี้",
  ACTIVE_PLAN: "รายการนี้อยู่ในแผนของรอบผลิตที่ยังไม่จบ กรุณาจบรอบนั้นก่อนปิดใช้งาน",
  PREP_ONLY: "รายการนี้ใช้เตรียมสูตรเท่านั้น ไม่คิดต้นทุนและไม่ต้องนับสต๊อก",
  ITEM_CHANGED: "หน่วยฐานของรายการเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบจำนวนอีกครั้ง",
};

function rejected(error: unknown, fallback: string): InventoryActionState {
  return { error: error instanceof InventoryMaintenanceError ? maintenanceGuidance[error.code] : fallback, saved: false };
}

function revalidateInventoryCatalog(itemId?: string) {
  if (itemId) revalidatePath(`/inventory/${itemId}`);
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/products");
  revalidatePath("/products/[id]", "page");
  revalidatePath("/delivery");
}

export async function createInventoryItemAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const input = readItemForm(formData);
  if (!input) return { error: "กรุณาตรวจสอบข้อมูลรายการ", saved: false };
  try {
    await createInventoryService(db).createItem(owner.id, input);
    revalidateInventoryCatalog();
    return { error: null, saved: true };
  } catch (error) {
    return rejected(error, "บันทึกรายการไม่สำเร็จ ชื่อรายการอาจซ้ำหรือข้อมูลไม่ถูกต้อง");
  }
}

export async function updateInventoryItemAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const itemId = itemIdSchema.safeParse(formData.get("itemId"));
  const input = readItemForm(formData);
  if (!itemId.success || !input) return { error: "กรุณาตรวจสอบข้อมูลรายการ", saved: false };
  try {
    await createInventoryService(db).updateItem(owner.id, itemId.data, input);
    revalidateInventoryCatalog(itemId.data);
    return { error: null, saved: true };
  } catch (error) {
    return rejected(error, "บันทึกรายการไม่สำเร็จ ชื่อรายการอาจซ้ำหรือข้อมูลไม่ถูกต้อง");
  }
}

export async function archiveInventoryItemAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const itemId = itemIdSchema.safeParse(formData.get("itemId"));
  if (!itemId.success) return { error: maintenanceGuidance.NOT_FOUND, saved: false };
  try {
    await createInventoryService(db).archiveItem(owner.id, itemId.data);
    revalidateInventoryCatalog(itemId.data);
    return { error: null, saved: true };
  } catch (error) {
    return rejected(error, "ปิดใช้งานไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง");
  }
}

export async function addInventoryPriceAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const parsed = priceSchema.safeParse({
    itemId: formData.get("itemId"),
    expectedBaseUnit: formData.get("expectedBaseUnit"),
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
      expectedBaseUnit: parsed.data.expectedBaseUnit,
      effectiveAt: new Date(`${parsed.data.effectiveDate}T00:00:00+07:00`),
      purchasedFrom: parsed.data.purchasedFrom,
      notes: parsed.data.notes,
    });
    revalidatePath(`/inventory/${parsed.data.itemId}`);
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch (error) {
    return rejected(error, "บันทึกราคาไม่สำเร็จ กรุณาตรวจสอบจำนวนและราคา");
  }
}

export async function recordInventoryCountAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const owner = await requireOwner();
  const parsed = countSchema.safeParse({
    itemId: formData.get("itemId"),
    expectedBaseUnit: formData.get("expectedBaseUnit"),
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
      parsed.data.expectedBaseUnit,
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
    return rejected(error, "บันทึกยอดนับไม่สำเร็จ กรุณาตรวจสอบจำนวน");
  }
}
