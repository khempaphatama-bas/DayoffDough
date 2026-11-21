"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createDeliveryService } from "@/modules/delivery/application/delivery";
import { InventoryMaintenanceError } from "@/modules/inventory/application/inventory";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import { unitCodes } from "@/modules/units/domain/units";

export type DeliveryActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;

const methodSchema = z.object({
  name: z.string().min(1),
  customerFeeBaht: z.string().min(1),
  internalCostBaht: z.string().min(1),
  notes: z.string(),
});

const ruleSchema = z.object({
  scope: z.enum(["PRODUCT", "DELIVERY_METHOD"]),
  productId: z.string(),
  deliveryMethodId: z.string(),
  inventoryItemId: z.string().uuid(),
  expectedBaseUnit: z.enum(unitCodes),
  consumptionBasis: z.enum([
    "PER_PRODUCT_UNIT",
    "PER_ORDER",
    "PER_DELIVERY",
  ]),
  quantityInBaseUnit: z.string().min(1),
  notes: z.string(),
});

export async function createDeliveryMethodAction(
  _previousState: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const owner = await requireOwner();
  const parsed = methodSchema.safeParse({
    name: formData.get("name"),
    customerFeeBaht: formData.get("customerFeeBaht"),
    internalCostBaht: formData.get("internalCostBaht"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: "กรุณาตรวจสอบข้อมูลวิธีส่ง", saved: false };
  try {
    await createDeliveryService(db).createMethod(owner.id, {
      name: parsed.data.name,
      defaultCustomerFeeSatang: parseBahtToSatang(parsed.data.customerFeeBaht),
      defaultInternalCostSatang: parseBahtToSatang(parsed.data.internalCostBaht),
      requiresDeliveryLocation:
        formData.get("requiresDeliveryLocation") === "on",
      notes: parsed.data.notes,
    });
    revalidatePath("/delivery");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch {
    return { error: "บันทึกวิธีส่งไม่สำเร็จ ชื่ออาจซ้ำหรือราคาไม่ถูกต้อง", saved: false };
  }
}

export async function updateDeliveryMethodAction(
  _previousState: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const owner = await requireOwner();
  const methodId = z.string().uuid().safeParse(formData.get("methodId"));
  const parsed = methodSchema.safeParse({
    name: formData.get("name"),
    customerFeeBaht: formData.get("customerFeeBaht"),
    internalCostBaht: formData.get("internalCostBaht"),
    notes: formData.get("notes") ?? "",
  });
  if (!methodId.success || !parsed.success) {
    return { error: "กรุณาตรวจสอบข้อมูลวิธีส่ง", saved: false };
  }
  try {
    await createDeliveryService(db).updateMethod(owner.id, methodId.data, {
      name: parsed.data.name,
      defaultCustomerFeeSatang: parseBahtToSatang(parsed.data.customerFeeBaht),
      defaultInternalCostSatang: parseBahtToSatang(parsed.data.internalCostBaht),
      requiresDeliveryLocation:
        formData.get("requiresDeliveryLocation") === "on",
      active: formData.get("active") === "on",
      notes: parsed.data.notes,
    });
    revalidatePath("/delivery");
    return { error: null, saved: true };
  } catch {
    return { error: "แก้ไขวิธีส่งไม่สำเร็จ", saved: false };
  }
}

export async function createPackagingRuleAction(
  _previousState: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const owner = await requireOwner();
  const parsed = ruleSchema.safeParse({
    scope: formData.get("scope"),
    productId: formData.get("productId") ?? "",
    deliveryMethodId: formData.get("deliveryMethodId") ?? "",
    inventoryItemId: formData.get("inventoryItemId"),
    expectedBaseUnit: formData.get("expectedBaseUnit"),
    consumptionBasis: formData.get("consumptionBasis"),
    quantityInBaseUnit: formData.get("quantityInBaseUnit"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: "กรุณาตรวจสอบกฎบรรจุภัณฑ์", saved: false };
  try {
    await createDeliveryService(db).createPackagingRule(owner.id, {
      scope: parsed.data.scope,
      productId: parsed.data.scope === "PRODUCT" ? parsed.data.productId : null,
      deliveryMethodId:
        parsed.data.scope === "DELIVERY_METHOD"
          ? parsed.data.deliveryMethodId
          : null,
      inventoryItemId: parsed.data.inventoryItemId,
      expectedBaseUnit: parsed.data.expectedBaseUnit,
      consumptionBasis: parsed.data.consumptionBasis,
      quantityInBaseUnit: parsed.data.quantityInBaseUnit,
      notes: parsed.data.notes,
    });
    revalidatePath("/delivery");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch (error) {
    if (error instanceof InventoryMaintenanceError && error.code === "ITEM_CHANGED") {
      return { error: "หน่วยของบรรจุภัณฑ์เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ เลือกรายการและตรวจสอบจำนวนก่อนบันทึกอีกครั้ง", saved: false };
    }
    return { error: "บันทึกกฎไม่สำเร็จ กรุณาตรวจสอบขอบเขตและประเภทบรรจุภัณฑ์", saved: false };
  }
}
