import { describe, expect, it } from "vitest";
import { buildPlanningPreview } from "./build-preview";
import {
  type BatchOverride,
  type PlanningSourceData,
} from "./types";
import type { ProductionTemplateSource } from "@/modules/production/domain/types";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_A_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_B_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_A_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_B_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "66666666-6666-4666-8666-666666666666";
const FOCACCIA_ID = "77777777-7777-4777-8777-777777777777";
const RECIPE_ID = "88888888-8888-4888-8888-888888888888";
const VERSION_ID = "99999999-9999-4999-8999-999999999999";
const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNIT_PACKAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_PACKAGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DELIVERY_PACKAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INGREDIENT_LINE_A_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const ITEM_A_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const ITEM_B_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const ITEM_C_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4";
const PRODUCT_UNIT_RULE_ID = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const PRODUCT_ORDER_RULE_ID = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const DELIVERY_RULE_ID = "ffffffff-ffff-4fff-8fff-fffffffffff3";
const TEMPLATE_ID = "12121212-1212-4212-8212-121212121213";
const ACTIVITY_ID = "13131313-1313-4313-8313-131313131314";

const EXPECTED_ISSUE_MESSAGES = {
  CYCLE_NOT_OPEN: "รอบผลิตต้องอยู่ในสถานะเปิดก่อนล็อก",
  MISSING_PRIMARY_DELIVERY_DATE: "รอบผลิตยังไม่มีวันส่งหลัก",
  NO_ACTIVE_ORDERS: "ยังไม่มีออเดอร์ที่ใช้คำนวณ",
  ORDER_WITHOUT_ITEMS: "มีออเดอร์ที่ไม่มีรายการสินค้า",
  MISSING_ACTIVE_RECIPE: "สินค้ายังไม่มีสูตรที่เปิดใช้งาน",
  INVALID_RECIPE_YIELD: "ผลผลิตของสูตรต้องมากกว่า 0",
  INCOMPATIBLE_YIELD_UNIT: "หน่วยผลผลิตของสูตรแปลงเป็นหน่วยขายไม่ได้",
  INVALID_INGREDIENT_QUANTITY: "ปริมาณวัตถุดิบในสูตรต้องมากกว่า 0",
  INVALID_BATCH_OVERRIDE: "จำนวนแบตช์ที่เลือกต้องมากกว่า 0",
  MISSING_OVERRIDE_REASON: "กรุณาระบุเหตุผลที่เปลี่ยนจำนวนแบตช์",
  MISSING_INVENTORY_PRICE: "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
  ORDER_UNPAID: "มีออเดอร์ที่ยังไม่ชำระเงิน",
  ORDER_PARTIAL: "มีออเดอร์ที่ชำระเงินบางส่วน",
  MISSING_DELIVERY_LOCATION: "ออเดอร์ยังไม่มีสถานที่จัดส่ง",
  DELIVERY_DATE_MISMATCH: "วันส่งของออเดอร์ไม่ตรงกับวันส่งหลักของรอบ",
  PLANNED_SHORTFALL: "แผนนี้ผลิตได้น้อยกว่ายอดสั่ง",
} as const;

function makeSource(): PlanningSourceData {
  return {
    calculatedAt: new Date("2026-08-23T03:00:00.000Z"),
    cycle: {
      id: CYCLE_ID,
      cycleNumber: 12,
      name: "รอบฟอคคาเซีย",
      status: "OPEN",
      orderCutoffAt: new Date("2026-08-28T10:00:00.000Z"),
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
        id: ORDER_B_ID,
        customerId: CUSTOMER_B_ID,
        customerName: "ลูกค้า ข",
        deliveryMethodId: DELIVERY_ID,
        deliveryMethodName: "ส่งถึงบ้าน",
        deliveryRequiresLocation: true,
        requestedDeliveryDate: "2026-08-30",
        confirmedDeliveryDate: "2026-08-30",
        confirmedDeliveryTime: null,
        deliveryLocation: "กรุงเทพฯ",
        deliveryNote: null,
        specialInstructions: null,
        sourceChannel: "PHONE",
        paymentStatus: "PAID",
        fulfillmentStatus: "CONFIRMED",
        deliveryFeePayer: "CUSTOMER",
        deliveryFeeChargedSatang: 0,
        deliveryCostSatang: 2_000,
        discountSatang: 0,
        amountPaidSatang: 150_000,
        items: [
          {
            id: ITEM_C_ID,
            productId: FOCACCIA_ID,
            productName: "Focaccia",
            sellingUnit: "piece",
            quantity: 6,
            unitPriceSatang: 25_000,
            lineNote: null,
          },
        ],
      },
      {
        id: ORDER_A_ID,
        customerId: CUSTOMER_A_ID,
        customerName: "ลูกค้า ก",
        deliveryMethodId: DELIVERY_ID,
        deliveryMethodName: "ส่งถึงบ้าน",
        deliveryRequiresLocation: true,
        requestedDeliveryDate: "2026-08-30",
        confirmedDeliveryDate: "2026-08-30",
        confirmedDeliveryTime: null,
        deliveryLocation: "นนทบุรี",
        deliveryNote: "โทรก่อนส่ง",
        specialInstructions: "ไม่โรยเกลือ",
        sourceChannel: "INSTAGRAM",
        paymentStatus: "PAID",
        fulfillmentStatus: "NEW",
        deliveryFeePayer: "CUSTOMER",
        deliveryFeeChargedSatang: 3_000,
        deliveryCostSatang: 2_500,
        discountSatang: 1_000,
        amountPaidSatang: 102_000,
        items: [
          {
            id: ITEM_B_ID,
            productId: FOCACCIA_ID,
            productName: "Focaccia",
            sellingUnit: "piece",
            quantity: 2,
            unitPriceSatang: 25_000,
            lineNote: "ชิ้นที่สอง",
          },
          {
            id: ITEM_A_ID,
            productId: FOCACCIA_ID,
            productName: "Focaccia",
            sellingUnit: "piece",
            quantity: 2,
            unitPriceSatang: 25_000,
            lineNote: null,
          },
        ],
      },
    ],
    products: [
      {
        id: FOCACCIA_ID,
        name: "Focaccia",
        sellingUnit: "piece",
        activeRecipe: {
          recipeId: RECIPE_ID,
          recipeName: "Focaccia dough",
          recipeVersionId: VERSION_ID,
          versionCode: "v1",
          baseYieldQuantity: "6",
          yieldUnit: "piece",
          laborMinutesPerBatch: 30,
          utilityCostSatangPerBatch: 2_000,
          wasteAllowancePercent: "10",
          instructions: "ผสมและอบ",
          ingredients: [
            {
              recipeIngredientId: INGREDIENT_LINE_A_ID,
              inventoryItemId: INGREDIENT_ID,
              quantityInBaseUnit: "1000",
            },
          ],
        },
      },
    ],
    packagingRules: [
      {
        id: DELIVERY_RULE_ID,
        scope: "DELIVERY_METHOD",
        productId: null,
        deliveryMethodId: DELIVERY_ID,
        targetName: "ส่งถึงบ้าน",
        inventoryItemId: DELIVERY_PACKAGE_ID,
        consumptionBasis: "PER_DELIVERY",
        quantityInBaseUnit: "2",
      },
      {
        id: PRODUCT_ORDER_RULE_ID,
        scope: "PRODUCT",
        productId: FOCACCIA_ID,
        deliveryMethodId: null,
        targetName: "Focaccia",
        inventoryItemId: ORDER_PACKAGE_ID,
        consumptionBasis: "PER_ORDER",
        quantityInBaseUnit: "1",
      },
      {
        id: PRODUCT_UNIT_RULE_ID,
        scope: "PRODUCT",
        productId: FOCACCIA_ID,
        deliveryMethodId: null,
        targetName: "Focaccia",
        inventoryItemId: UNIT_PACKAGE_ID,
        consumptionBasis: "PER_PRODUCT_UNIT",
        quantityInBaseUnit: "0.5",
      },
    ],
    inventoryItems: [
      {
        id: ORDER_PACKAGE_ID,
        name: "กล่อง",
        category: "PACKAGING",
        baseUnit: "piece",
        price: {
          id: "10000000-0000-4000-8000-000000000003",
          packPriceSatang: 300,
          packBaseQuantity: "10",
          effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
      {
        id: INGREDIENT_ID,
        name: "แป้ง",
        category: "INGREDIENT",
        baseUnit: "g",
        price: {
          id: "10000000-0000-4000-8000-000000000001",
          packPriceSatang: 5_500,
          packBaseQuantity: "1000",
          effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
      {
        id: DELIVERY_PACKAGE_ID,
        name: "ถุงส่งของ",
        category: "PACKAGING",
        baseUnit: "piece",
        price: {
          id: "10000000-0000-4000-8000-000000000004",
          packPriceSatang: 200,
          packBaseQuantity: "20",
          effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
      {
        id: UNIT_PACKAGE_ID,
        name: "ซอง",
        category: "PACKAGING",
        baseUnit: "piece",
        price: {
          id: "10000000-0000-4000-8000-000000000002",
          packPriceSatang: 1_000,
          packBaseQuantity: "100",
          effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
    ],
    productionTemplates: [
      {
        id: TEMPLATE_ID,
        name: "เทมเพลตฟอคคาเซีย",
        scope: "PRODUCT",
        productId: FOCACCIA_ID,
        active: true,
        activities: [
          {
            id: ACTIVITY_ID,
            name: "เตรียมแป้ง",
            offsetDaysFromDelivery: 1,
            defaultTime: "05:00",
            estimatedDurationMinutes: 30,
            sequence: 1,
            notes: null,
          },
        ],
      } satisfies ProductionTemplateSource,
    ],
  };
}

function withRecipe(
  source: PlanningSourceData,
  change: Partial<NonNullable<PlanningSourceData["products"][number]["activeRecipe"]>>,
): PlanningSourceData {
  const product = source.products[0];
  if (!product?.activeRecipe) throw new Error("fixture recipe missing");
  return {
    ...source,
    products: [
      { ...product, activeRecipe: { ...product.activeRecipe, ...change } },
    ],
  };
}

function issueCodes(preview: ReturnType<typeof buildPlanningPreview>) {
  return {
    blockers: preview.blockers.map((issue) => issue.code),
    warnings: preview.warnings.map((issue) => issue.code),
  };
}

describe("planning preview orchestration", () => {
  it("blocks every planned product without a ready Product Template", () => {
    const preview = buildPlanningPreview({ ...makeSource(), productionTemplates: [] }, []);

    expect(preview.blockers).toContainEqual(expect.objectContaining({
      code: "MISSING_PRODUCT_TEMPLATE",
      scope: "PRODUCT",
      sourceEntityId: FOCACCIA_ID,
      context: expect.objectContaining({
        productName: "Focaccia",
        templateHref: "/production/templates",
      }),
    }));
  });

  it("blocks an active Product Template with no active activities", () => {
    const source = makeSource();
    const template = source.productionTemplates[0]!;
    const preview = buildPlanningPreview({
      ...source,
      productionTemplates: [{ ...template, activities: [] }],
    });

    expect(preview.blockers.filter((issue) => issue.code === "MISSING_PRODUCT_TEMPLATE"))
      .toHaveLength(1);
  });

  it("does not block an optional Cycle Template", () => {
    const source = makeSource();
    const productTemplate = source.productionTemplates[0]!;
    const cycleTemplate: ProductionTemplateSource = {
      ...productTemplate,
      id: "14141414-1414-4414-8414-141414141415",
      scope: "CYCLE",
      productId: null,
    };

    const preview = buildPlanningPreview({
      ...source,
      productionTemplates: [productTemplate, cycleTemplate],
    });

    expect(preview.blockers.filter((issue) => issue.code === "MISSING_PRODUCT_TEMPLATE"))
      .toEqual([]);
  });

  it("applies an override before all downstream requirement and cost calculations", () => {
    const defaultPreview = buildPlanningPreview(makeSource());
    expect(defaultPreview.productPlans[0]?.suggestedBatchCount).toBe(2);

    const preview = buildPlanningPreview(makeSource(), [
      {
        productId: FOCACCIA_ID,
        selectedBatchCount: "1.5",
        reason: "ทดลองผลิตน้อยกว่ายอดสั่ง",
      },
    ]);

    expect(preview.blockers).toEqual([]);
    expect(preview.productPlans[0]).toMatchObject({
      orderedQuantity: "10",
      suggestedBatchCount: 2,
      selectedBatchCount: "1.5",
      plannedOutput: "9",
      outputDifference: "-1",
      overrideReason: "ทดลองผลิตน้อยกว่ายอดสั่ง",
    });
    expect(preview.recipePlans[0]).toMatchObject({
      yieldInSellingUnit: "6",
      wasteAllowancePercent: "10",
      wasteAllowanceSource: "RECIPE",
    });
    expect(preview.materialRequirements[0]).toMatchObject({
      baseRequirement: "1500",
      wasteQuantity: "150",
      plannedRequirement: "1650",
      baseCostSatang: 8_250,
      wasteCostSatang: 825,
    });
    expect(preview.packagingRequirements).toMatchObject([
      { packagingRuleId: PRODUCT_UNIT_RULE_ID, multiplier: "9", plannedRequirement: "4.5", costSatang: 45 },
      { packagingRuleId: PRODUCT_ORDER_RULE_ID, multiplier: "2", plannedRequirement: "2", costSatang: 60 },
      { packagingRuleId: DELIVERY_RULE_ID, multiplier: "2", plannedRequirement: "4", costSatang: 40 },
    ]);
    expect(preview.productCosts[0]).toEqual({
      productId: FOCACCIA_ID,
      knownBaseIngredientCostSatang: 8_250,
      knownWasteCostSatang: 825,
      knownProductPackagingCostSatang: 105,
      laborCostSatang: 9_000,
      utilityCostSatang: 3_000,
      knownProductionCostSatang: 21_180,
      completeProductionCostSatang: 21_180,
      costComplete: true,
      missingPriceCount: 0,
    });
    expect(preview.cycleCost).toMatchObject({
      knownDeliveryPackagingCostSatang: 40,
      knownProductionCostSatang: 21_220,
      completeProductionCostSatang: 21_220,
      costComplete: true,
      missingPriceCount: 0,
    });
    expect(preview.warnings).toContainEqual(
      expect.objectContaining({
        code: "PLANNED_SHORTFALL",
        scope: "PRODUCT",
        sourceEntityId: FOCACCIA_ID,
        message: "แผนนี้ผลิตได้น้อยกว่ายอดสั่ง",
      }),
    );
  });

  it("filters cancelled orders and counts distinct included orders for packaging", () => {
    const source = makeSource();
    const cancelled = {
      ...source.orders[0]!,
      id: "01010101-0101-4101-8101-010101010101",
      fulfillmentStatus: "CANCELLED" as const,
      paymentStatus: "UNPAID" as const,
      deliveryLocation: null,
      items: [{ ...source.orders[0]!.items[0]!, id: "02020202-0202-4202-8202-020202020202", quantity: 100 }],
    };
    const preview = buildPlanningPreview({
      ...source,
      orders: [cancelled, ...source.orders],
    });

    expect(preview.orderSnapshots.map((order) => order.id)).toEqual([
      ORDER_A_ID,
      ORDER_B_ID,
    ]);
    expect(preview.orderSnapshots[0]?.items.map((item) => item.id)).toEqual([
      ITEM_A_ID,
      ITEM_B_ID,
    ]);
    expect(preview.productPlans[0]?.orderedQuantity).toBe("10");
    expect(
      preview.packagingRequirements.find(
        (requirement) => requirement.packagingRuleId === PRODUCT_ORDER_RULE_ID,
      )?.multiplier,
    ).toBe("2");
    expect(
      preview.packagingRequirements.find(
        (requirement) => requirement.packagingRuleId === DELIVERY_RULE_ID,
      )?.multiplier,
    ).toBe("2");
    expect(preview.warnings).toEqual([]);
  });

  it("propagates the canonical confirmed delivery time into order snapshots", () => {
    const source = makeSource();
    const timed: PlanningSourceData = {
      ...source,
      orders: source.orders.map((order, index) =>
        index === 0 ? { ...order, confirmedDeliveryTime: "14:30" } : order
      ),
    };

    expect(buildPlanningPreview(timed).orderSnapshots[1]?.confirmedDeliveryTime)
      .toBe("14:30");
  });

  it("orders same-product same-code ingredient blockers by immutable context", () => {
    const source = makeSource();
    const recipe = source.products[0]!.activeRecipe!;
    const invalidIngredients = [
      {
        ...recipe.ingredients[0]!,
        recipeIngredientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
        quantityInBaseUnit: "-1",
      },
      {
        ...recipe.ingredients[0]!,
        recipeIngredientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
        quantityInBaseUnit: "0",
      },
    ];
    const withIngredients = (
      ingredients: typeof invalidIngredients,
    ): PlanningSourceData => ({
      ...source,
      products: [
        {
          ...source.products[0]!,
          activeRecipe: { ...recipe, ingredients },
        },
      ],
    });

    const first = buildPlanningPreview(withIngredients(invalidIngredients));
    const reordered = buildPlanningPreview(
      withIngredients([...invalidIngredients].reverse()),
    );

    expect(
      first.blockers.map((issue) => issue.context.recipeIngredientId),
    ).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
    ]);
    expect(reordered.blockers).toEqual(first.blockers);
  });

  it("keeps every issue and output collection stable when sources are reordered", () => {
    const source = makeSource();
    const focacciaRecipe = source.products[0]!.activeRecipe!;
    const secondProductId = "07070707-0707-4707-8707-070707070707";
    const secondIngredientId = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
    const secondRuleId = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
    const secondOrderItemId = "06060606-0606-4606-8606-060606060606";
    const extraIngredientId = "05050505-0505-4505-8505-050505050505";
    const emptyOrderLowId = "12121212-1212-4212-8212-121212121212";
    const emptyOrderHighId = "13131313-1313-4313-8313-131313131313";
    const secondProduct = {
      id: secondProductId,
      name: "Brioche",
      sellingUnit: "piece" as const,
      activeRecipe: {
        ...focacciaRecipe,
        recipeId: "08080808-0808-4808-8808-080808080808",
        recipeName: "Brioche dough",
        recipeVersionId: "09090909-0909-4909-8909-090909090909",
        baseYieldQuantity: "4",
        wasteAllowancePercent: null,
        ingredients: [
          {
            recipeIngredientId: secondIngredientId,
            inventoryItemId: INGREDIENT_ID,
            quantityInBaseUnit: "250",
          },
        ],
      },
    };
    const enriched: PlanningSourceData = {
      ...source,
      orders: [
        ...source.orders.map((order) =>
          order.id === ORDER_A_ID
          ? {
              ...order,
              paymentStatus: "PARTIAL" as const,
              items: [
                ...order.items,
                {
                  id: secondOrderItemId,
                  productId: secondProductId,
                  productName: secondProduct.name,
                  sellingUnit: "piece" as const,
                  quantity: 2,
                  unitPriceSatang: 15_000,
                  lineNote: null,
                },
              ],
            }
            : { ...order, paymentStatus: "UNPAID" as const },
        ),
        {
          ...source.orders[0]!,
          id: emptyOrderHighId,
          customerId: "14141414-1414-4414-8414-141414141414",
          customerName: "ออเดอร์ว่าง ข",
          deliveryMethodId: null,
          deliveryMethodName: null,
          deliveryRequiresLocation: false,
          deliveryLocation: null,
          paymentStatus: "PAID" as const,
          deliveryFeeChargedSatang: 0,
          deliveryCostSatang: 0,
          amountPaidSatang: 0,
          items: [],
        },
        {
          ...source.orders[0]!,
          id: emptyOrderLowId,
          customerId: "15151515-1515-4515-8515-151515151515",
          customerName: "ออเดอร์ว่าง ก",
          deliveryMethodId: null,
          deliveryMethodName: null,
          deliveryRequiresLocation: false,
          deliveryLocation: null,
          paymentStatus: "PAID" as const,
          deliveryFeeChargedSatang: 0,
          deliveryCostSatang: 0,
          amountPaidSatang: 0,
          items: [],
        },
      ],
      products: [
        {
          ...source.products[0]!,
          activeRecipe: {
            ...focacciaRecipe,
            ingredients: [
              focacciaRecipe.ingredients[0]!,
              {
                ...focacciaRecipe.ingredients[0]!,
                recipeIngredientId: extraIngredientId,
                quantityInBaseUnit: "100",
              },
            ],
          },
        },
        secondProduct,
      ],
      packagingRules: [
        ...source.packagingRules,
        {
          id: secondRuleId,
          scope: "PRODUCT",
          productId: secondProductId,
          deliveryMethodId: null,
          targetName: secondProduct.name,
          inventoryItemId: UNIT_PACKAGE_ID,
          consumptionBasis: "PER_PRODUCT_UNIT",
          quantityInBaseUnit: "1",
        },
      ],
      productionTemplates: [
        ...source.productionTemplates,
        {
          id: "16161616-1616-4616-8616-161616161617",
          name: "เทมเพลตสินค้า 2",
          scope: "PRODUCT",
          productId: secondProductId,
          active: true,
          activities: [
            {
              id: "17171717-1717-4717-8717-171717171718",
              name: "อบ",
              offsetDaysFromDelivery: 1,
              defaultTime: "05:00",
              estimatedDurationMinutes: 20,
              sequence: 1,
              notes: null,
            },
          ],
        },
      ],
    };
    const overrides: ReadonlyArray<BatchOverride> = [
      {
        productId: FOCACCIA_ID,
        selectedBatchCount: "1.5",
        reason: " ",
      },
      {
        productId: secondProductId,
        selectedBatchCount: "0",
        reason: "ทดสอบค่าผิด",
      },
    ];
    const reordered: PlanningSourceData = {
      ...enriched,
      orders: [...enriched.orders].reverse().map((order) => ({
        ...order,
        items: [...order.items].reverse(),
      })),
      products: [...enriched.products].reverse().map((product) => ({
        ...product,
        activeRecipe: product.activeRecipe
          ? {
              ...product.activeRecipe,
              ingredients: [...product.activeRecipe.ingredients].reverse(),
            }
          : null,
      })),
      packagingRules: [...enriched.packagingRules].reverse(),
      inventoryItems: [...enriched.inventoryItems].reverse(),
    };

    const first = buildPlanningPreview(enriched, overrides);
    const second = buildPlanningPreview(reordered, [...overrides].reverse());

    expect(
      enriched.orders.flatMap((order) => order.items)[0]?.productId,
    ).toBe(FOCACCIA_ID);
    expect(
      reordered.orders.flatMap((order) => order.items)[0]?.productId,
    ).toBe(secondProductId);
    expect(first.orderSnapshots.map((order) => order.id)).toEqual([
      emptyOrderLowId,
      emptyOrderHighId,
      ORDER_A_ID,
      ORDER_B_ID,
    ]);
    expect(
      first.orderSnapshots.map((order) =>
        order.items.map((item) => item.id),
      ),
    ).toEqual([
      [],
      [],
      [secondOrderItemId, ITEM_A_ID, ITEM_B_ID],
      [ITEM_C_ID],
    ]);
    expect.soft(first.productPlans.map((plan) => plan.productId)).toEqual([
      secondProductId,
      FOCACCIA_ID,
    ]);
    expect.soft(first.recipePlans.map((plan) => plan.productId)).toEqual([
      secondProductId,
      FOCACCIA_ID,
    ]);
    expect(
      first.inventoryPrices.map((price) => price.inventoryItemId),
    ).toEqual([
      INGREDIENT_ID,
      UNIT_PACKAGE_ID,
      ORDER_PACKAGE_ID,
      DELIVERY_PACKAGE_ID,
    ]);
    expect(
      first.materialRequirements.map(
        (requirement) =>
          `${requirement.productId}:${requirement.recipeIngredientId}`,
      ),
    ).toEqual([
      `${secondProductId}:${secondIngredientId}`,
      `${FOCACCIA_ID}:${extraIngredientId}`,
      `${FOCACCIA_ID}:${INGREDIENT_LINE_A_ID}`,
    ]);
    expect(
      first.packagingRequirements.map(
        (requirement) => requirement.packagingRuleId,
      ),
    ).toEqual([
      secondRuleId,
      PRODUCT_UNIT_RULE_ID,
      PRODUCT_ORDER_RULE_ID,
      DELIVERY_RULE_ID,
    ]);
    expect.soft(first.productCosts.map((cost) => cost.productId)).toEqual([
      secondProductId,
      FOCACCIA_ID,
    ]);
    expect(
      first.blockers.map(
        (issue) => `${issue.sourceEntityId}:${issue.code}`,
      ),
    ).toEqual([
      `${secondProductId}:INVALID_BATCH_OVERRIDE`,
      `${emptyOrderLowId}:ORDER_WITHOUT_ITEMS`,
      `${emptyOrderHighId}:ORDER_WITHOUT_ITEMS`,
      `${FOCACCIA_ID}:MISSING_OVERRIDE_REASON`,
    ]);
    expect(
      first.warnings.map(
        (issue) => `${issue.sourceEntityId}:${issue.code}`,
      ),
    ).toEqual([
      `${ORDER_A_ID}:ORDER_PARTIAL`,
      `${ORDER_B_ID}:ORDER_UNPAID`,
      `${FOCACCIA_ID}:PLANNED_SHORTFALL`,
    ]);
    expect(second).toEqual(first);
  });

  it.each([
    ["CYCLE_NOT_OPEN", (source: PlanningSourceData) => ({ ...source, cycle: { ...source.cycle, status: "DRAFT" as const } }), undefined],
    ["MISSING_PRIMARY_DELIVERY_DATE", (source: PlanningSourceData) => ({ ...source, cycle: { ...source.cycle, primaryDeliveryDate: null } }), undefined],
    ["NO_ACTIVE_ORDERS", (source: PlanningSourceData) => ({ ...source, orders: source.orders.map((order) => ({ ...order, fulfillmentStatus: "CANCELLED" as const })) }), undefined],
    ["ORDER_WITHOUT_ITEMS", (source: PlanningSourceData) => ({ ...source, orders: [{ ...source.orders[0]!, items: [] }] }), undefined],
    ["MISSING_ACTIVE_RECIPE", (source: PlanningSourceData) => ({ ...source, products: [{ ...source.products[0]!, activeRecipe: null }] }), undefined],
    ["INVALID_RECIPE_YIELD", (source: PlanningSourceData) => withRecipe(source, { baseYieldQuantity: "0" }), undefined],
    ["INCOMPATIBLE_YIELD_UNIT", (source: PlanningSourceData) => withRecipe(source, { yieldUnit: "kg" }), undefined],
    ["INVALID_INGREDIENT_QUANTITY", (source: PlanningSourceData) => withRecipe(source, { ingredients: [{ ...source.products[0]!.activeRecipe!.ingredients[0]!, quantityInBaseUnit: "0" }] }), undefined],
    ["INVALID_BATCH_OVERRIDE", (source: PlanningSourceData) => source, [{ productId: FOCACCIA_ID, selectedBatchCount: "0", reason: "ลด" }]],
    ["MISSING_OVERRIDE_REASON", (source: PlanningSourceData) => source, [{ productId: FOCACCIA_ID, selectedBatchCount: "1.5", reason: "  " }]],
  ] as const)("returns the %s source problem as an exact blocker", (code, change, overrides) => {
    const preview = buildPlanningPreview(change(makeSource()), overrides as ReadonlyArray<BatchOverride> | undefined);
    const issue = preview.blockers.find((candidate) => candidate.code === code);

    expect(issue?.message).toBe(EXPECTED_ISSUE_MESSAGES[code]);
    expect(issueCodes(preview).blockers).toContain(code);
  });

  it.each([
    ["ORDER_UNPAID", (source: PlanningSourceData) => ({ ...source, orders: [{ ...source.orders[0]!, paymentStatus: "UNPAID" as const }, source.orders[1]!] }), undefined],
    ["ORDER_PARTIAL", (source: PlanningSourceData) => ({ ...source, orders: [{ ...source.orders[0]!, paymentStatus: "PARTIAL" as const }, source.orders[1]!] }), undefined],
    ["MISSING_DELIVERY_LOCATION", (source: PlanningSourceData) => ({ ...source, orders: [{ ...source.orders[0]!, deliveryLocation: "  " }, source.orders[1]!] }), undefined],
    ["DELIVERY_DATE_MISMATCH", (source: PlanningSourceData) => ({ ...source, orders: [{ ...source.orders[0]!, confirmedDeliveryDate: "2026-08-31" }, source.orders[1]!] }), undefined],
    ["PLANNED_SHORTFALL", (source: PlanningSourceData) => source, [{ productId: FOCACCIA_ID, selectedBatchCount: "1.5", reason: "ตั้งใจลด" }]],
  ] as const)("returns the %s condition as an exact warning", (code, change, overrides) => {
    const preview = buildPlanningPreview(change(makeSource()), overrides as ReadonlyArray<BatchOverride> | undefined);
    const issue = preview.warnings.find((candidate) => candidate.code === code);

    expect(issue?.message).toBe(EXPECTED_ISSUE_MESSAGES[code]);
    expect(issueCodes(preview).warnings).toContain(code);
  });

  it("deduplicates missing-price warnings while preserving known costs", () => {
    const source = makeSource();
    const recipe = source.products[0]!.activeRecipe!;
    const preview = buildPlanningPreview({
      ...source,
      products: [{
        ...source.products[0]!,
        activeRecipe: {
          ...recipe,
          ingredients: [
            recipe.ingredients[0]!,
            { ...recipe.ingredients[0]!, recipeIngredientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5", quantityInBaseUnit: "500" },
          ],
        },
      }],
      inventoryItems: source.inventoryItems.map((item) =>
        item.id === INGREDIENT_ID ? { ...item, price: null } : item,
      ),
    });

    const missingPriceWarnings = preview.warnings.filter(
      (issue) => issue.code === "MISSING_INVENTORY_PRICE",
    );
    expect(missingPriceWarnings).toHaveLength(1);
    expect(missingPriceWarnings[0]?.message).toBe(
      "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
    );
    expect(preview.inventoryPrices.filter((price) => price.inventoryItemId === INGREDIENT_ID)).toEqual([
      expect.objectContaining({ sourcePriceId: null, packPriceSatang: null, packBaseQuantity: null, effectiveAt: null, unitCostSatang: null }),
    ]);
    expect(preview.materialRequirements).toHaveLength(2);
    expect(preview.materialRequirements.every((requirement) => requirement.baseCostSatang === null && requirement.wasteCostSatang === null)).toBe(true);
    expect(preview.productCosts[0]).toMatchObject({
      knownBaseIngredientCostSatang: 0,
      knownWasteCostSatang: 0,
      knownProductPackagingCostSatang: 120,
      laborCostSatang: 12_000,
      utilityCostSatang: 4_000,
      knownProductionCostSatang: 16_120,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 1,
    });
    expect(preview.cycleCost).toMatchObject({
      knownProductionCostSatang: 16_160,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 1,
    });
  });

  it("treats a recorded zero price as complete", () => {
    const source = makeSource();
    const preview = buildPlanningPreview({
      ...source,
      inventoryItems: source.inventoryItems.map((item) =>
        item.id === INGREDIENT_ID && item.price
          ? { ...item, price: { ...item.price, packPriceSatang: 0 } }
          : item,
      ),
    });

    expect(preview.inventoryPrices.find((price) => price.inventoryItemId === INGREDIENT_ID)?.unitCostSatang).toBe("0");
    expect(preview.materialRequirements[0]).toMatchObject({ baseCostSatang: 0, wasteCostSatang: 0 });
    expect(preview.productCosts[0]).toMatchObject({ costComplete: true, completeProductionCostSatang: 16_120, missingPriceCount: 0 });
    expect(preview.cycleCost).toMatchObject({ costComplete: true, completeProductionCostSatang: 16_160, missingPriceCount: 0 });
  });
});
