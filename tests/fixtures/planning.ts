import { eq } from "drizzle-orm";
import { customers } from "@/modules/customers/db/schema";
import {
  deliveryMethods,
  productPackagingRules,
} from "@/modules/delivery/db/schema";
import {
  inventoryItems,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import { bakeCycles, bakeCycleStatus } from "@/modules/cycles/db/schema";
import { shopSettings } from "@/modules/settings/db/schema";
import type { DatabaseClient } from "@/lib/db/types";
import { OWNER_ID } from "./owner";

const IDS = {
  ingredientItem: "10000000-0000-4000-8000-000000000001",
  packagingItem: "10000000-0000-4000-8000-000000000002",
  product: "10000000-0000-4000-8000-000000000003",
  recipe: "10000000-0000-4000-8000-000000000004",
  recipeVersion: "10000000-0000-4000-8000-000000000005",
  recipeIngredient: "10000000-0000-4000-8000-000000000006",
  deliveryMethod: "10000000-0000-4000-8000-000000000007",
  customer: "10000000-0000-4000-8000-000000000008",
  cycle: "10000000-0000-4000-8000-000000000009",
  productPackagingRule: "10000000-0000-4000-8000-00000000000a",
  deliveryPackagingRule: "10000000-0000-4000-8000-00000000000b",
  firstOrder: "10000000-0000-4000-8000-00000000000c",
  secondOrder: "10000000-0000-4000-8000-00000000000d",
  cancelledOrder: "10000000-0000-4000-8000-00000000000e",
  firstOrderItem: "10000000-0000-4000-8000-00000000000f",
  secondOrderItem: "10000000-0000-4000-8000-000000000010",
  cancelledOrderItem: "10000000-0000-4000-8000-000000000011",
  olderIngredientPrice: "20000000-0000-4000-8000-000000000001",
  latestIngredientPrice: "20000000-0000-4000-8000-000000000002",
  futureIngredientPrice: "20000000-0000-4000-8000-000000000003",
  packagingPrice: "20000000-0000-4000-8000-000000000004",
} as const;

type CycleStatus = (typeof bakeCycleStatus)[number];

export async function seedPlanningScenario(
  db: DatabaseClient,
  input: Readonly<{
    ownerId?: string;
    cycleStatus?: CycleStatus;
    includeIngredientPrice?: boolean;
    includePackagingPrice?: boolean;
    orderQuantity?: number;
  }> = {},
): Promise<Readonly<{
  cycleId: string;
  productId: string;
  ingredientItemId: string;
  packagingItemId: string;
  orderIds: ReadonlyArray<string>;
}>> {
  const ownerId = input.ownerId ?? OWNER_ID;
  const cycleStatus = input.cycleStatus ?? "OPEN";
  const includeIngredientPrice = input.includeIngredientPrice ?? true;
  const includePackagingPrice = input.includePackagingPrice ?? true;
  const orderQuantity = input.orderQuantity ?? 10;
  if (!Number.isSafeInteger(orderQuantity) || orderQuantity < 2) {
    throw new Error("Planning fixture orderQuantity must be an integer >= 2");
  }
  const firstQuantity = Math.floor(orderQuantity / 2);
  const secondQuantity = orderQuantity - firstQuantity;

  await db.insert(shopSettings).values({
    ownerId,
    laborRateSatangPerHour: 12_000,
    timezone: "Asia/Bangkok",
    currency: "THB",
    defaultWasteAllowancePercent: "3.0000",
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });

  await db.insert(inventoryItems).values([
    {
      id: IDS.ingredientItem,
      ownerId,
      name: "แป้งขนมปัง",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000.000000",
      minimumStockQuantity: "0.000000",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    {
      id: IDS.packagingItem,
      ownerId,
      name: "ถุงขนม",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก",
      baseQuantityPerPurchasePack: "100.000000",
      minimumStockQuantity: "0.000000",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  ]);

  if (includeIngredientPrice) {
    await db.insert(inventoryPrices).values([
      {
        id: IDS.olderIngredientPrice,
        ownerId,
        inventoryItemId: IDS.ingredientItem,
        packPriceSatang: 5_000,
        packBaseQuantity: "1000.000000",
        effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
      },
      {
        id: IDS.latestIngredientPrice,
        ownerId,
        inventoryItemId: IDS.ingredientItem,
        packPriceSatang: 5_500,
        packBaseQuantity: "1000.000000",
        effectiveAt: new Date("2026-08-20T00:00:00.000Z"),
        createdAt: new Date("2026-08-21T00:00:00.000Z"),
      },
      {
        id: IDS.futureIngredientPrice,
        ownerId,
        inventoryItemId: IDS.ingredientItem,
        packPriceSatang: 99_999,
        packBaseQuantity: "1000.000000",
        effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
        createdAt: new Date("2026-08-22T00:00:00.000Z"),
      },
    ]);
  }

  if (includePackagingPrice) {
    await db.insert(inventoryPrices).values({
      id: IDS.packagingPrice,
      ownerId,
      inventoryItemId: IDS.packagingItem,
      packPriceSatang: 1_000,
      packBaseQuantity: "100.000000",
      effectiveAt: new Date("2026-08-10T00:00:00.000Z"),
      createdAt: new Date("2026-08-11T00:00:00.000Z"),
    });
  }

  await db.insert(products).values({
    id: IDS.product,
    ownerId,
    name: "ฟอคคาเซีย",
    sellingUnit: "piece",
    defaultUnitPriceSatang: 12_000,
    activeRecipeVersionId: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(recipes).values({
    id: IDS.recipe,
    ownerId,
    productId: IDS.product,
    name: "สูตรฟอคคาเซียหลัก",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(recipeVersions).values({
    id: IDS.recipeVersion,
    ownerId,
    recipeId: IDS.recipe,
    versionCode: "v1",
    baseYieldQuantity: "6.000000",
    yieldUnit: "piece",
    laborMinutesPerBatch: 30,
    utilityCostSatangPerBatch: 2_000,
    wasteAllowancePercent: "10.0000",
    instructions: "ผสม พัก และอบ",
    activeFrom: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(recipeIngredients).values({
    id: IDS.recipeIngredient,
    ownerId,
    recipeVersionId: IDS.recipeVersion,
    inventoryItemId: IDS.ingredientItem,
    quantityInBaseUnit: "1000.000000",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db
    .update(products)
    .set({ activeRecipeVersionId: IDS.recipeVersion })
    .where(eq(products.id, IDS.product));

  await db.insert(deliveryMethods).values({
    id: IDS.deliveryMethod,
    ownerId,
    name: "ไรเดอร์",
    defaultCustomerFeeSatang: 5_000,
    defaultInternalCostSatang: 4_000,
    requiresDeliveryLocation: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(productPackagingRules).values([
    {
      id: IDS.productPackagingRule,
      ownerId,
      scope: "PRODUCT",
      productId: IDS.product,
      deliveryMethodId: null,
      inventoryItemId: IDS.packagingItem,
      consumptionBasis: "PER_PRODUCT_UNIT",
      quantityInBaseUnit: "1.000000",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    {
      id: IDS.deliveryPackagingRule,
      ownerId,
      scope: "DELIVERY_METHOD",
      productId: null,
      deliveryMethodId: IDS.deliveryMethod,
      inventoryItemId: IDS.packagingItem,
      consumptionBasis: "PER_DELIVERY",
      quantityInBaseUnit: "1.000000",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  ]);

  await db.insert(customers).values({
    id: IDS.customer,
    ownerId,
    name: "คุณเมย์",
    defaultDeliveryMethodId: IDS.deliveryMethod,
    defaultDeliveryLocation: "เชียงใหม่",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(bakeCycles).values({
    id: IDS.cycle,
    ownerId,
    name: "รอบส่ง 30 ส.ค.",
    status: cycleStatus,
    orderCutoffAt: new Date("2026-08-27T12:00:00.000Z"),
    targetProductionDate: "2026-08-29",
    primaryDeliveryDate: "2026-08-30",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });

  const orderRows = [
    {
      id: IDS.firstOrder,
      ownerId,
      customerId: IDS.customer,
      bakeCycleId: IDS.cycle,
      sourceChannel: "INSTAGRAM" as const,
      requestedDeliveryDate: "2026-08-30",
      confirmedDeliveryDate: "2026-08-30",
      deliveryMethodId: IDS.deliveryMethod,
      deliveryFeeChargedSatang: 5_000,
      deliveryCostSatang: 4_000,
      deliveryFeePayer: "CUSTOMER" as const,
      deliveryLocation: "เชียงใหม่",
      paymentStatus: "PAID" as const,
      fulfillmentStatus: "CONFIRMED" as const,
      amountPaidSatang: firstQuantity * 12_000 + 5_000,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    },
    {
      id: IDS.secondOrder,
      ownerId,
      customerId: IDS.customer,
      bakeCycleId: IDS.cycle,
      sourceChannel: "PHONE" as const,
      requestedDeliveryDate: "2026-08-30",
      confirmedDeliveryDate: "2026-08-30",
      deliveryMethodId: IDS.deliveryMethod,
      deliveryFeeChargedSatang: 5_000,
      deliveryCostSatang: 4_000,
      deliveryFeePayer: "CUSTOMER" as const,
      deliveryLocation: "เชียงใหม่",
      paymentStatus: "PAID" as const,
      fulfillmentStatus: "IN_PRODUCTION" as const,
      amountPaidSatang: secondQuantity * 12_000 + 5_000,
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    },
    {
      id: IDS.cancelledOrder,
      ownerId,
      customerId: IDS.customer,
      bakeCycleId: IDS.cycle,
      sourceChannel: "OTHER" as const,
      requestedDeliveryDate: "2026-08-30",
      confirmedDeliveryDate: "2026-08-30",
      deliveryMethodId: IDS.deliveryMethod,
      deliveryFeeChargedSatang: 5_000,
      deliveryCostSatang: 4_000,
      deliveryFeePayer: "CUSTOMER" as const,
      deliveryLocation: "เชียงใหม่",
      paymentStatus: "REFUNDED" as const,
      fulfillmentStatus: "CANCELLED" as const,
      amountPaidSatang: 0,
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      updatedAt: new Date("2026-08-04T00:00:00.000Z"),
    },
  ];
  await db.insert(orders).values(orderRows);
  await db.insert(orderItems).values([
    {
      id: IDS.firstOrderItem,
      ownerId,
      orderId: IDS.firstOrder,
      productId: IDS.product,
      quantity: firstQuantity,
      unitPriceSatang: 12_000,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    },
    {
      id: IDS.secondOrderItem,
      ownerId,
      orderId: IDS.secondOrder,
      productId: IDS.product,
      quantity: secondQuantity,
      unitPriceSatang: 12_000,
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    },
    {
      id: IDS.cancelledOrderItem,
      ownerId,
      orderId: IDS.cancelledOrder,
      productId: IDS.product,
      quantity: 50,
      unitPriceSatang: 12_000,
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      updatedAt: new Date("2026-08-04T00:00:00.000Z"),
    },
  ]);

  return {
    cycleId: IDS.cycle,
    productId: IDS.product,
    ingredientItemId: IDS.ingredientItem,
    packagingItemId: IDS.packagingItem,
    orderIds: [IDS.firstOrder, IDS.secondOrder, IDS.cancelledOrder],
  };
}
