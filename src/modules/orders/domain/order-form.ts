import { z } from "zod";
import type { OrderInput } from "@/modules/orders/application/orders";
import {
  calculateOrderTotals,
  type OrderTotals,
} from "@/modules/orders/domain/totals";
import { parseBahtToSatang } from "@/modules/money/domain/money";

export type OrderFormValues = Readonly<{
  customerId: string;
  bakeCycleId: string;
  sourceChannel: "" | "INSTAGRAM" | "FACEBOOK" | "PHONE" | "OTHER";
  requestedDeliveryDate: string;
  confirmedDeliveryDate: string;
  deliveryMethodId: string;
  deliveryFeeChargedBaht: string;
  deliveryCostBaht: string;
  deliveryFeePayer: "CUSTOMER" | "BAKERY" | "SHARED";
  discountBaht: string;
  amountPaidBaht: string;
  deliveryLocation: string;
  deliveryNote: string;
  specialInstructions: string;
  items: ReadonlyArray<
    Readonly<{
      productId: string;
      quantity: string;
      unitPriceBaht: string;
      lineNote: string;
    }>
  >;
}>;

const uuidSchema = z.string().uuid("กรุณาเลือกรายการ");
const optionalUuidSchema = z.union([z.literal(""), uuidSchema]);
const optionalDateSchema = z.union([z.literal(""), z.iso.date()]);
const bahtSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/, "กรุณากรอกจำนวนเงินบาทไม่เกิน 2 ตำแหน่ง")
  .refine((value) => {
    try {
      parseBahtToSatang(value);
      return true;
    } catch {
      return false;
    }
  }, "จำนวนเงินไม่ถูกต้อง");
const quantitySchema = z
  .string()
  .regex(/^[1-9]\d*$/, "จำนวนต้องเป็นเลขจำนวนเต็มที่มากกว่า 0")
  .refine((value) => Number.isSafeInteger(Number(value)), "จำนวนมากเกินไป");

export const orderFormSchema = z.object({
  customerId: uuidSchema,
  bakeCycleId: uuidSchema,
  sourceChannel: z.enum(["", "INSTAGRAM", "FACEBOOK", "PHONE", "OTHER"]),
  requestedDeliveryDate: optionalDateSchema,
  confirmedDeliveryDate: optionalDateSchema,
  deliveryMethodId: optionalUuidSchema,
  deliveryFeeChargedBaht: bahtSchema,
  deliveryCostBaht: bahtSchema,
  deliveryFeePayer: z.enum(["CUSTOMER", "BAKERY", "SHARED"]),
  discountBaht: bahtSchema,
  amountPaidBaht: bahtSchema,
  deliveryLocation: z.string().trim().max(2000),
  deliveryNote: z.string().trim().max(2000),
  specialInstructions: z.string().trim().max(2000),
  items: z
    .array(
      z.object({
        productId: uuidSchema,
        quantity: quantitySchema,
        unitPriceBaht: bahtSchema,
        lineNote: z.string().trim().max(2000),
      }),
    )
    .min(1, "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ"),
}) satisfies z.ZodType<OrderFormValues>;

export function normalizeOrderForm(values: OrderFormValues): OrderInput {
  return {
    customerId: values.customerId,
    bakeCycleId: values.bakeCycleId,
    sourceChannel: values.sourceChannel === "" ? null : values.sourceChannel,
    requestedDeliveryDate:
      values.requestedDeliveryDate === "" ? null : values.requestedDeliveryDate,
    confirmedDeliveryDate:
      values.confirmedDeliveryDate === "" ? null : values.confirmedDeliveryDate,
    deliveryMethodId:
      values.deliveryMethodId === "" ? null : values.deliveryMethodId,
    deliveryFeeChargedSatang: parseBahtToSatang(
      values.deliveryFeeChargedBaht,
    ),
    deliveryCostSatang: parseBahtToSatang(values.deliveryCostBaht),
    deliveryFeePayer: values.deliveryFeePayer,
    discountSatang: parseBahtToSatang(values.discountBaht),
    amountPaidSatang: parseBahtToSatang(values.amountPaidBaht),
    deliveryLocation: values.deliveryLocation.trim(),
    deliveryNote: values.deliveryNote.trim(),
    specialInstructions: values.specialInstructions.trim(),
    items: values.items.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
      unitPriceSatang: parseBahtToSatang(item.unitPriceBaht),
      lineNote: item.lineNote.trim(),
    })),
  };
}

export function calculateOrderFormTotals(
  values: OrderFormValues,
): OrderTotals | null {
  const parsed = orderFormSchema.safeParse(values);
  if (!parsed.success) return null;

  try {
    return calculateOrderTotals(normalizeOrderForm(parsed.data));
  } catch {
    return null;
  }
}
