import { describe, expect, it } from "vitest";
import { buildPlanningPreview } from "./build-preview";
import { createPlanningFingerprint } from "./fingerprint";
import type { PlanningSourceData } from "./types";

const PRODUCT_A_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B_ID = "22222222-2222-4222-8222-222222222222";

function sourceFixture(): PlanningSourceData {
  return {
    calculatedAt: new Date("2026-08-23T01:00:00.000Z"),
    cycle: {
      id: "33333333-3333-4333-8333-333333333333",
      cycleNumber: 7,
      name: "รอบทดสอบ",
      status: "OPEN",
      orderCutoffAt: new Date("2026-08-28T17:00:00+07:00"),
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    },
    settings: {
      laborRateSatangPerHour: 12_000,
      defaultWasteAllowancePercent: "3",
      timezone: "Asia/Bangkok",
      currency: "THB",
    },
    orders: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        customerId: "66666666-6666-4666-8666-666666666666",
        customerName: "ข",
        deliveryMethodId: "77777777-7777-4777-8777-777777777777",
        deliveryMethodName: "ส่ง",
        deliveryRequiresLocation: true,
        requestedDeliveryDate: "2026-08-30",
        confirmedDeliveryDate: null,
        deliveryLocation: "กรุงเทพฯ",
        deliveryNote: null,
        specialInstructions: null,
        sourceChannel: "PHONE",
        paymentStatus: "PAID",
        fulfillmentStatus: "CONFIRMED",
        deliveryFeePayer: "CUSTOMER",
        deliveryFeeChargedSatang: 0,
        deliveryCostSatang: 100,
        discountSatang: 0,
        amountPaidSatang: 200,
        items: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            productId: PRODUCT_B_ID,
            productName: "B",
            sellingUnit: "piece",
            quantity: 1,
            unitPriceSatang: 100,
            lineNote: null,
          },
          {
            id: "88888888-8888-4888-8888-888888888888",
            productId: PRODUCT_A_ID,
            productName: "A",
            sellingUnit: "piece",
            quantity: 1,
            unitPriceSatang: 100,
            lineNote: null,
          },
        ],
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        customerName: "ก",
        deliveryMethodId: null,
        deliveryMethodName: null,
        deliveryRequiresLocation: false,
        requestedDeliveryDate: null,
        confirmedDeliveryDate: "2026-08-30",
        deliveryLocation: null,
        deliveryNote: null,
        specialInstructions: null,
        sourceChannel: null,
        paymentStatus: "UNPAID",
        fulfillmentStatus: "NEW",
        deliveryFeePayer: "BAKERY",
        deliveryFeeChargedSatang: 0,
        deliveryCostSatang: 0,
        discountSatang: 0,
        amountPaidSatang: 0,
        items: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            productId: PRODUCT_A_ID,
            productName: "A",
            sellingUnit: "piece",
            quantity: 2,
            unitPriceSatang: 100,
            lineNote: null,
          },
        ],
      },
    ],
    products: [
      {
        id: PRODUCT_B_ID,
        name: "B",
        sellingUnit: "piece",
        activeRecipe: null,
      },
      {
        id: PRODUCT_A_ID,
        name: "A",
        sellingUnit: "piece",
        activeRecipe: {
          recipeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          recipeName: "สูตร A",
          recipeVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          versionCode: "v1",
          baseYieldQuantity: "6",
          yieldUnit: "piece",
          laborMinutesPerBatch: 30,
          utilityCostSatangPerBatch: 2_000,
          wasteAllowancePercent: "10",
          instructions: "อบ",
          ingredients: [
            {
              recipeIngredientId: "ffffffff-ffff-4fff-8fff-fffffffffff2",
              inventoryItemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              quantityInBaseUnit: "500",
            },
            {
              recipeIngredientId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
              inventoryItemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              quantityInBaseUnit: "1000",
            },
          ],
        },
      },
    ],
    packagingRules: [
      {
        id: "12121212-1212-4212-8212-121212121212",
        scope: "PRODUCT",
        productId: PRODUCT_A_ID,
        deliveryMethodId: null,
        targetName: "A",
        inventoryItemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        consumptionBasis: "PER_PRODUCT_UNIT",
        quantityInBaseUnit: "1",
      },
      {
        id: "10101010-1010-4010-8010-101010101010",
        scope: "DELIVERY_METHOD",
        productId: null,
        deliveryMethodId: "77777777-7777-4777-8777-777777777777",
        targetName: "ส่ง",
        inventoryItemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        consumptionBasis: "PER_DELIVERY",
        quantityInBaseUnit: "2",
      },
    ],
    inventoryItems: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "รายการ",
        category: "CONSUMABLE",
        baseUnit: "piece",
        price: {
          id: "13131313-1313-4313-8313-131313131313",
          packPriceSatang: 5_500,
          packBaseQuantity: "1000",
          effectiveAt: new Date("2026-08-22T17:00:00+07:00"),
        },
      },
    ],
  };
}

describe("planning source fingerprint", () => {
  it("is stable across entity ordering and changes for a relevant value", () => {
    const source = sourceFixture();
    const first = createPlanningFingerprint(source);
    const reordered = {
      ...source,
      orders: [...source.orders]
        .reverse()
        .map((order) => ({ ...order, items: [...order.items].reverse() })),
      products: [...source.products].reverse().map((product) => ({
        ...product,
        activeRecipe: product.activeRecipe
          ? { ...product.activeRecipe, ingredients: [...product.activeRecipe.ingredients].reverse() }
          : null,
      })),
      packagingRules: [...source.packagingRules].reverse(),
      inventoryItems: [...source.inventoryItems].reverse(),
    };

    expect(createPlanningFingerprint(reordered)).toBe(first);
    expect(createPlanningFingerprint({
      ...source,
      orders: source.orders.map((order, index) =>
        index === 0 ? { ...order, amountPaidSatang: order.amountPaidSatang + 1 } : order,
      ),
    })).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("canonicalizes numeric strings and Date instants and omits calculatedAt", () => {
    const source = sourceFixture();
    const recipe = source.products[1]!.activeRecipe!;
    const equivalent: PlanningSourceData = {
      ...source,
      calculatedAt: new Date("2030-01-01T00:00:00.000Z"),
      cycle: {
        ...source.cycle,
        orderCutoffAt: new Date("2026-08-28T10:00:00.000Z"),
      },
      settings: { ...source.settings, defaultWasteAllowancePercent: "3.0000" },
      products: [
        source.products[0]!,
        {
          ...source.products[1]!,
          activeRecipe: {
            ...recipe,
            baseYieldQuantity: "6.000000",
            wasteAllowancePercent: "10.0000",
            ingredients: recipe.ingredients.map((ingredient) => ({
              ...ingredient,
              quantityInBaseUnit: `${ingredient.quantityInBaseUnit}.000`,
            })),
          },
        },
      ],
      packagingRules: source.packagingRules.map((rule) => ({
        ...rule,
        quantityInBaseUnit: `${rule.quantityInBaseUnit}.00`,
      })),
      inventoryItems: source.inventoryItems.map((item) => ({
        ...item,
        price: item.price
          ? {
              ...item.price,
              packBaseQuantity: "1000.0",
              effectiveAt: new Date("2026-08-22T10:00:00.000Z"),
            }
          : null,
      })),
    };

    expect(createPlanningFingerprint(equivalent)).toBe(
      createPlanningFingerprint(source),
    );
  });

  it("preserves numeric-looking semantic text exactly", () => {
    const source = sourceFixture();
    const withNumericText: PlanningSourceData = {
      ...source,
      orders: source.orders.map((order, index) =>
        index === 0
          ? {
              ...order,
              specialInstructions: "01",
              items: order.items.map((item, itemIndex) =>
                itemIndex === 0 ? { ...item, lineNote: "001" } : item,
              ),
            }
          : order,
      ),
    };
    const changedInstructions: PlanningSourceData = {
      ...withNumericText,
      orders: withNumericText.orders.map((order, index) =>
        index === 0 ? { ...order, specialInstructions: "1" } : order,
      ),
    };
    const changedLineNote: PlanningSourceData = {
      ...withNumericText,
      orders: withNumericText.orders.map((order, index) =>
        index === 0
          ? {
              ...order,
              items: order.items.map((item, itemIndex) =>
                itemIndex === 0 ? { ...item, lineNote: "1" } : item,
              ),
            }
          : order,
      ),
    };

    expect(createPlanningFingerprint(changedInstructions)).not.toBe(
      createPlanningFingerprint(withNumericText),
    );
    expect(createPlanningFingerprint(changedLineNote)).not.toBe(
      createPlanningFingerprint(withNumericText),
    );
  });

  it("ignores values belonging only to already-cancelled orders", () => {
    const source = sourceFixture();
    const cancelled = {
      ...source.orders[0]!,
      id: "14141414-1414-4414-8414-141414141414",
      fulfillmentStatus: "CANCELLED" as const,
    };
    const withCancelled = { ...source, orders: [...source.orders, cancelled] };
    const changedCancelled = {
      ...withCancelled,
      orders: withCancelled.orders.map((order) =>
        order.id === cancelled.id
          ? { ...order, customerName: "เปลี่ยนแต่ไม่เกี่ยว", amountPaidSatang: 999_999 }
          : order,
      ),
    };

    expect(createPlanningFingerprint(changedCancelled)).toBe(
      createPlanningFingerprint(withCancelled),
    );
    expect(createPlanningFingerprint(withCancelled)).toBe(
      createPlanningFingerprint(source),
    );
  });

  it("excludes unrelated products, rules, and inventory items", () => {
    const source = sourceFixture();
    const unrelatedProductId = "15151515-1515-4515-8515-151515151515";
    const unrelatedInventoryId = "16161616-1616-4616-8616-161616161616";
    const withUnrelatedSource: PlanningSourceData = {
      ...source,
      products: [
        ...source.products,
        {
          id: unrelatedProductId,
          name: "ไม่ถูกสั่ง",
          sellingUnit: "piece",
          activeRecipe: {
            recipeId: "17171717-1717-4717-8717-171717171717",
            recipeName: "สูตรที่ไม่เกี่ยว",
            recipeVersionId: "18181818-1818-4818-8818-181818181818",
            versionCode: "v99",
            baseYieldQuantity: "9",
            yieldUnit: "piece",
            laborMinutesPerBatch: 999,
            utilityCostSatangPerBatch: 999,
            wasteAllowancePercent: "99",
            instructions: "ไม่เกี่ยว",
            ingredients: [
              {
                recipeIngredientId:
                  "19191919-1919-4919-8919-191919191919",
                inventoryItemId: unrelatedInventoryId,
                quantityInBaseUnit: "999",
              },
            ],
          },
        },
      ],
      packagingRules: [
        ...source.packagingRules,
        {
          id: "20202020-2020-4020-8020-202020202020",
          scope: "PRODUCT",
          productId: unrelatedProductId,
          deliveryMethodId: null,
          targetName: "ไม่ถูกสั่ง",
          inventoryItemId: unrelatedInventoryId,
          consumptionBasis: "PER_ORDER",
          quantityInBaseUnit: "999",
        },
        {
          id: "21212121-2121-4121-8121-212121212121",
          scope: "DELIVERY_METHOD",
          productId: null,
          deliveryMethodId: "22222222-2222-4222-8222-222222222223",
          targetName: "วิธีส่งที่ไม่ใช้",
          inventoryItemId: unrelatedInventoryId,
          consumptionBasis: "PER_DELIVERY",
          quantityInBaseUnit: "999",
        },
      ],
      inventoryItems: [
        ...source.inventoryItems,
        {
          id: unrelatedInventoryId,
          name: "ของที่ไม่เกี่ยว",
          category: "CONSUMABLE",
          baseUnit: "piece",
          price: null,
        },
      ],
    };

    expect(createPlanningFingerprint(withUnrelatedSource)).toBe(
      createPlanningFingerprint(source),
    );
  });

  it("keeps the source fingerprint independent of batch overrides", () => {
    const source = sourceFixture();
    const defaultPreview = buildPlanningPreview(source);
    const overriddenPreview = buildPlanningPreview(source, [
      {
        productId: PRODUCT_A_ID,
        selectedBatchCount: "0.5",
        reason: "ตั้งใจลด",
      },
    ]);

    expect(overriddenPreview.inputFingerprint).toBe(
      defaultPreview.inputFingerprint,
    );
  });
});
