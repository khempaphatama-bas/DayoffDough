"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { ingredientKinds } from "@/modules/inventory/domain/ingredient-kind";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import { createProductService, RecipeMaintenanceError } from "@/modules/products/application/products";

export type ProductActionState = Readonly<{
  error: string | null;
  saved: boolean;
  archivedVersionCodes?: readonly string[];
}>;

const unitCodes = ["mg", "g", "kg", "ml", "l", "piece"] as const;

const productSchema = z.object({
  name: z.string().min(1),
  sellingUnit: z.enum(unitCodes),
  defaultUnitPriceBaht: z.string().min(1),
  notes: z.string(),
});

const versionSchema = z.object({
  productId: z.string().uuid(),
  versionCode: z.string().trim().min(1).max(80),
  baseYieldQuantity: z.string().min(1),
  yieldUnit: z.enum(unitCodes),
  laborMinutesPerBatch: z.coerce.number().int().min(0),
  utilityCostBahtPerBatch: z.string().min(1),
  wasteAllowancePercent: z.string(),
  instructions: z.string(),
  ingredientCount: z.coerce.number().int().min(1).max(50),
});

const versionTargetSchema = z.object({ productId: z.string().uuid(), versionId: z.string().uuid() });
const ingredientRowsSchema = z.array(z.object({
  inventoryItemId: z.string().uuid(),
  quantityInBaseUnit: z.string().min(1),
  expectedIdentity: z.object({
    baseUnit: z.enum(unitCodes),
    ingredientKind: z.enum(ingredientKinds),
  }),
}));

const recipeMaintenanceMessages: Record<RecipeMaintenanceError["code"], string> = {
  NOT_FOUND: "ไม่พบสูตรสำหรับสินค้านี้ กรุณากลับไปที่หน้าสินค้าแล้วลองอีกครั้ง",
  ACTIVE_VERSION: "สูตรนี้กำลังใช้งานอยู่ กรุณาสลับไปใช้สูตรอื่นก่อนเก็บเข้าประวัติ",
  ARCHIVED_VERSION: "สูตรนี้ถูกเก็บเข้าประวัติแล้ว หากต้องการนำกลับมาใช้ ให้กดใช้สูตรนี้เป็นต้นแบบแล้วบันทึกเป็นเวอร์ชันใหม่",
  ITEM_UNAVAILABLE: "มีวัตถุดิบที่ใช้ไม่ได้แล้ว กรุณาเลือกวัตถุดิบอื่นแทนหรือลบรายการนั้นก่อนบันทึก",
  ITEM_CHANGED: "หน่วยหรือชนิดวัตถุดิบเปลี่ยนไป กรุณาโหลดหน้าใหม่ แล้วตรวจสอบปริมาณและหน่วยก่อนบันทึกอีกครั้ง",
  DUPLICATE_VERSION_CODE: "รหัสเวอร์ชันนี้ถูกใช้แล้ว กรุณาตั้งรหัสใหม่",
};

function recipeFailure(error: unknown, fallback: string): ProductActionState {
  return { error: error instanceof RecipeMaintenanceError ? recipeMaintenanceMessages[error.code] : fallback, saved: false };
}

function revalidateRecipeViews(productId: string) {
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}

export async function createProductAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const owner = await requireOwner();
  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    sellingUnit: formData.get("sellingUnit"),
    defaultUnitPriceBaht: formData.get("defaultUnitPriceBaht"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: "กรุณาตรวจสอบข้อมูลสินค้า", saved: false };
  try {
    await createProductService(db).createProduct(owner.id, {
      name: parsed.data.name,
      sellingUnit: parsed.data.sellingUnit,
      defaultUnitPriceSatang: parseBahtToSatang(
        parsed.data.defaultUnitPriceBaht,
      ),
      notes: parsed.data.notes,
    });
    revalidatePath("/products");
    revalidatePath("/production/templates/new");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch {
    return { error: "บันทึกสินค้าไม่สำเร็จ ชื่อสินค้าอาจซ้ำหรือราคาไม่ถูกต้อง", saved: false };
  }
}

export async function createRecipeVersionAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const owner = await requireOwner();
  const parsed = versionSchema.safeParse({
    productId: formData.get("productId"),
    versionCode: formData.get("versionCode"),
    baseYieldQuantity: formData.get("baseYieldQuantity"),
    yieldUnit: formData.get("yieldUnit"),
    laborMinutesPerBatch: formData.get("laborMinutesPerBatch"),
    utilityCostBahtPerBatch: formData.get("utilityCostBahtPerBatch"),
    wasteAllowancePercent: formData.get("wasteAllowancePercent") ?? "",
    instructions: formData.get("instructions") ?? "",
    ingredientCount: formData.get("ingredientCount"),
  });
  if (!parsed.success) return { error: "กรุณาตรวจสอบข้อมูลสูตร", saved: false };

  const ingredients = Array.from(
    { length: parsed.data.ingredientCount },
    (_, index) => ({
      inventoryItemId: formData.get(`ingredientId_${index}`),
      quantityInBaseUnit: formData.get(`ingredientQuantity_${index}`),
      expectedIdentity: {
        baseUnit: formData.get(`ingredientBaseUnit_${index}`),
        ingredientKind: formData.get(`ingredientKind_${index}`),
      },
    }),
  );
  const parsedIngredients = ingredientRowsSchema.safeParse(ingredients);
  if (!parsedIngredients.success) {
    const incompleteRow = parsedIngredients.error.issues.some(({ path }) => path[1] !== "expectedIdentity");
    return {
      error: incompleteRow
        ? "กรุณาเลือกวัตถุดิบและกรอกปริมาณให้ครบ"
        : "ข้อมูลหน่วยหรือชนิดวัตถุดิบไม่ครบ กรุณาโหลดหน้าใหม่แล้วเลือกวัตถุดิบอีกครั้ง",
      saved: false,
    };
  }

  try {
    const version = await createProductService(db).createRecipeVersion(
      owner.id,
      parsed.data.productId,
      {
        versionCode: parsed.data.versionCode,
        baseYieldQuantity: parsed.data.baseYieldQuantity,
        yieldUnit: parsed.data.yieldUnit,
        laborMinutesPerBatch: parsed.data.laborMinutesPerBatch,
        utilityCostSatangPerBatch: parseBahtToSatang(
          parsed.data.utilityCostBahtPerBatch,
        ),
        wasteAllowancePercent:
          parsed.data.wasteAllowancePercent.trim() === ""
            ? null
            : parsed.data.wasteAllowancePercent,
        ingredients: parsedIngredients.data,
        instructions: parsed.data.instructions,
      },
    );
    revalidateRecipeViews(parsed.data.productId);
    return {
      error: null,
      saved: true,
      archivedVersionCodes: version.archivedVersions.map(({ versionCode }) => versionCode),
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message === "Base yield must be greater than zero"
        ? "ผลผลิตต่อสูตรต้องมากกว่าศูนย์"
        : "บันทึกเวอร์ชันสูตรไม่สำเร็จ กรุณาตรวจสอบข้อมูล";
    return recipeFailure(error, message);
  }
}

export async function activateRecipeVersionAction(formData: FormData): Promise<void> {
  const result = await activateRecipeVersionWithFeedbackAction({ error: null, saved: false }, formData);
  if (result.error) throw new Error(result.error);
}

export async function activateRecipeVersionWithFeedbackAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const owner = await requireOwner();
  const parsed = versionTargetSchema.safeParse({
    productId: formData.get("productId"),
    versionId: formData.get("versionId"),
  });
  if (!parsed.success) return { error: recipeMaintenanceMessages.NOT_FOUND, saved: false };
  try {
    await createProductService(db).activateRecipeVersion(owner.id, parsed.data.productId, parsed.data.versionId);
  } catch (error) {
    if (error instanceof RecipeMaintenanceError && error.code === "ITEM_UNAVAILABLE") {
      return { error: "สูตรนี้มีวัตถุดิบที่ใช้ไม่ได้แล้ว ให้ใช้สูตรนี้เป็นต้นแบบแล้วเปลี่ยนหรือลบรายการนั้นก่อนบันทึกเวอร์ชันใหม่", saved: false };
    }
    return recipeFailure(error, "เปิดใช้สูตรไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง");
  }
  revalidateRecipeViews(parsed.data.productId);
  revalidatePath("/dashboard");
  revalidatePath("/cycles/[id]/planning", "page");
  return { error: null, saved: true };
}

export async function archiveRecipeVersionAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const owner = await requireOwner();
  const parsed = versionTargetSchema.safeParse({
    productId: formData.get("productId"),
    versionId: formData.get("versionId"),
  });
  if (!parsed.success) return { error: recipeMaintenanceMessages.NOT_FOUND, saved: false };
  try {
    await createProductService(db).archiveRecipeVersion(owner.id, parsed.data.productId, parsed.data.versionId);
  } catch (error) {
    return recipeFailure(error, "เก็บสูตรเข้าประวัติไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง");
  }
  revalidateRecipeViews(parsed.data.productId);
  return { error: null, saved: true };
}
