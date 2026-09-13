"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import { createProductService } from "@/modules/products/application/products";

export type ProductActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;

const productSchema = z.object({
  name: z.string().min(1),
  sellingUnit: z.enum(["mg", "g", "kg", "ml", "l", "piece"]),
  defaultUnitPriceBaht: z.string().min(1),
  notes: z.string(),
});

const versionSchema = z.object({
  productId: z.string().uuid(),
  versionCode: z.string().min(1),
  baseYieldQuantity: z.string().min(1),
  yieldUnit: z.enum(["mg", "g", "kg", "ml", "l", "piece"]),
  laborMinutesPerBatch: z.coerce.number().int().min(0),
  utilityCostBahtPerBatch: z.string().min(1),
  wasteAllowancePercent: z.string(),
  instructions: z.string(),
  ingredientCount: z.coerce.number().int().min(1).max(50),
});

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
    }),
  );
  const parsedIngredients = z
    .array(
      z.object({
        inventoryItemId: z.string().uuid(),
        quantityInBaseUnit: z.string().min(1),
      }),
    )
    .safeParse(ingredients);
  if (!parsedIngredients.success) {
    return { error: "กรุณาเลือกวัตถุดิบและกรอกปริมาณให้ครบ", saved: false };
  }

  try {
    await createProductService(db).createRecipeVersion(
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
    revalidatePath(`/products/${parsed.data.productId}`);
    revalidatePath("/products");
    return { error: null, saved: true };
  } catch (error) {
    const message =
      error instanceof Error && error.message === "Base yield must be greater than zero"
        ? "ผลผลิตต่อสูตรต้องมากกว่าศูนย์"
        : "บันทึกเวอร์ชันสูตรไม่สำเร็จ กรุณาตรวจสอบข้อมูล";
    return { error: message, saved: false };
  }
}

export async function activateRecipeVersionAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const parsed = z
    .object({ productId: z.string().uuid(), versionId: z.string().uuid() })
    .safeParse({
      productId: formData.get("productId"),
      versionId: formData.get("versionId"),
    });
  if (!parsed.success) throw new Error("Invalid recipe activation");
  await createProductService(db).activateRecipeVersion(
    owner.id,
    parsed.data.productId,
    parsed.data.versionId,
  );
  revalidatePath(`/products/${parsed.data.productId}`);
  revalidatePath("/products");
  revalidatePath("/dashboard");
}
