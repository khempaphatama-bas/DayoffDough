import { count, eq } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  deliveryMethods,
  productPackagingRules,
} from "@/modules/delivery/db/schema";
import {
  inventoryItems,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import { orderItems } from "@/modules/orders/db/schema";
import {
  cycleCostSnapshots,
  cycleInventoryPriceSnapshots,
  cycleMaterialRequirements,
  cycleOrderItemSnapshots,
  cycleOrderSnapshots,
  cyclePackagingRequirements,
  cyclePlanningSnapshots,
  cyclePlanningWarnings,
  cycleProductCostSnapshots,
  cycleProductPlans,
  cycleRecipePlans,
} from "@/modules/planning/db/schema";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import { shopSettings } from "@/modules/settings/db/schema";
import { loadPlanningSource } from "./load-source";
import { createPlanningQueryService } from "./planning-queries";

const AS_OF = new Date("2026-08-29T00:00:00.000Z");
const MISSING_CYCLE_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";

async function expectExactError(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(expectedMessage);
}

describe("planning query service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it.each([
    ["cross-owner", OTHER_OWNER_ID, "10000000-0000-4000-8000-000000000009"],
    ["missing", OWNER_ID, MISSING_CYCLE_ID],
    ["malformed cycle UUID", OWNER_ID, "not-a-cycle-uuid"],
    ["malformed owner UUID", "not-an-owner-uuid", "10000000-0000-4000-8000-000000000009"],
  ])("returns the same not-found error for a %s request", async (_case, ownerId, cycleId) => {
    await seedPlanningScenario(context.db);
    const service = createPlanningQueryService(context.db, {
      now: () => AS_OF,
    });

    await expectExactError(
      service.preview(ownerId, cycleId),
      "Cycle not found",
    );
  });

  it("captures the clock once and returns a read-only preview", async () => {
    const scenario = await seedPlanningScenario(context.db);
    let clockCalls = 0;
    const service = createPlanningQueryService(context.db, {
      now() {
        clockCalls += 1;
        return new Date(AS_OF);
      },
    });
    const preview = await service.preview(OWNER_ID, scenario.cycleId);

    const planningRowCounts = await Promise.all([
      context.db.select({ value: count() }).from(cyclePlanningSnapshots),
      context.db.select({ value: count() }).from(cyclePlanningWarnings),
      context.db.select({ value: count() }).from(cycleOrderSnapshots),
      context.db.select({ value: count() }).from(cycleOrderItemSnapshots),
      context.db.select({ value: count() }).from(cycleProductPlans),
      context.db.select({ value: count() }).from(cycleRecipePlans),
      context.db
        .select({ value: count() })
        .from(cycleInventoryPriceSnapshots),
      context.db.select({ value: count() }).from(cycleMaterialRequirements),
      context.db.select({ value: count() }).from(cyclePackagingRequirements),
      context.db.select({ value: count() }).from(cycleProductCostSnapshots),
      context.db.select({ value: count() }).from(cycleCostSnapshots),
    ]);
    expect(clockCalls).toBe(1);
    expect(preview.calculatedAt).toEqual(AS_OF);
    expect(preview.blockers).toEqual([]);
    expect(preview.productPlans).toHaveLength(1);
    expect(planningRowCounts.map(([row]) => row?.value)).toEqual(
      Array.from({ length: 11 }, () => 0),
    );
  });

  it("retains cancelled source rows but excludes their quantities from demand", async () => {
    const scenario = await seedPlanningScenario(context.db, {
      orderQuantity: 10,
    });
    const source = await loadPlanningSource(
      context.db,
      OWNER_ID,
      scenario.cycleId,
      AS_OF,
    );
    const preview = await createPlanningQueryService(context.db, {
      now: () => AS_OF,
    }).preview(OWNER_ID, scenario.cycleId);

    expect(source.orders).toHaveLength(3);
    expect(source.orders.find((order) => order.id === scenario.orderIds[2]))
      .toMatchObject({
        fulfillmentStatus: "CANCELLED",
        items: [expect.objectContaining({ quantity: 50 })],
      });
    expect(preview.orderSnapshots.map((order) => order.id)).toEqual(
      scenario.orderIds.slice(0, 2),
    );
    expect(preview.productPlans).toEqual([
      expect.objectContaining({
        productId: scenario.productId,
        orderedQuantity: "10",
      }),
    ]);
  });

  it("selects the deterministic latest eligible owned price", async () => {
    const scenario = await seedPlanningScenario(context.db);
    await context.db.insert(inventoryPrices).values([
      {
        id: "20000000-0000-4000-8000-000000000005",
        ownerId: OWNER_ID,
        inventoryItemId: scenario.ingredientItemId,
        packPriceSatang: 6_000,
        packBaseQuantity: "1000.000000",
        effectiveAt: new Date("2026-08-20T00:00:00.000Z"),
        createdAt: new Date("2026-08-22T00:00:00.000Z"),
      },
      {
        id: "20000000-0000-4000-8000-000000000006",
        ownerId: OWNER_ID,
        inventoryItemId: scenario.ingredientItemId,
        packPriceSatang: 6_500,
        packBaseQuantity: "1000.000000",
        effectiveAt: new Date("2026-08-20T00:00:00.000Z"),
        createdAt: new Date("2026-08-22T00:00:00.000Z"),
      },
    ]);
    await context.db.insert(inventoryItems).values({
      id: "40000000-0000-4000-8000-000000000001",
      ownerId: OTHER_OWNER_ID,
      name: "แป้งของร้านอื่น",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000.000000",
    });
    await context.db.insert(inventoryPrices).values({
      id: "40000000-0000-4000-8000-000000000002",
      ownerId: OTHER_OWNER_ID,
      inventoryItemId: "40000000-0000-4000-8000-000000000001",
      packPriceSatang: 1,
      packBaseQuantity: "1000.000000",
      effectiveAt: new Date("2026-08-28T00:00:00.000Z"),
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
    });

    const source = await loadPlanningSource(
      context.db,
      OWNER_ID,
      scenario.cycleId,
      AS_OF,
    );
    const ingredient = source.inventoryItems.find(
      (item) => item.id === scenario.ingredientItemId,
    );

    expect(ingredient?.price).toEqual({
      id: "20000000-0000-4000-8000-000000000006",
      packPriceSatang: 6_500,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    expect(source.inventoryItems.map((item) => item.id)).toEqual([
      scenario.ingredientItemId,
      scenario.packagingItemId,
    ]);
  });

  it("reports one missing packaging price and keeps costs incomplete", async () => {
    const scenario = await seedPlanningScenario(context.db, {
      includePackagingPrice: false,
    });

    const preview = await createPlanningQueryService(context.db, {
      now: () => AS_OF,
    }).preview(OWNER_ID, scenario.cycleId);

    expect(preview.warnings.filter((warning) =>
      warning.code === "MISSING_INVENTORY_PRICE"
    )).toEqual([
      expect.objectContaining({
        scope: "INVENTORY_ITEM",
        sourceEntityId: scenario.packagingItemId,
      }),
    ]);
    expect(preview.productCosts).toEqual([
      expect.objectContaining({ costComplete: false, missingPriceCount: 1 }),
    ]);
    expect(preview.cycleCost).toMatchObject({
      costComplete: false,
      missingPriceCount: 1,
      completeProductionCostSatang: null,
    });
  });

  it("throws the exact settings error when the owned cycle has no settings", async () => {
    const scenario = await seedPlanningScenario(context.db);
    await context.db
      .delete(shopSettings)
      .where(eq(shopSettings.ownerId, OWNER_ID));

    await expectExactError(
      createPlanningQueryService(context.db, { now: () => AS_OF }).preview(
        OWNER_ID,
        scenario.cycleId,
      ),
      "Shop settings not found",
    );
  });

  it("returns canonical decimals and excludes unrelated master data from the source fingerprint", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const service = createPlanningQueryService(context.db, { now: () => AS_OF });
    const before = await service.preview(OWNER_ID, scenario.cycleId);

    const unrelated = {
      itemId: "30000000-0000-4000-8000-000000000001",
      productId: "30000000-0000-4000-8000-000000000002",
      recipeId: "30000000-0000-4000-8000-000000000003",
      versionId: "30000000-0000-4000-8000-000000000004",
      ingredientId: "30000000-0000-4000-8000-000000000005",
      deliveryMethodId: "30000000-0000-4000-8000-000000000006",
      productRuleId: "30000000-0000-4000-8000-000000000007",
      deliveryRuleId: "30000000-0000-4000-8000-000000000008",
      priceId: "30000000-0000-4000-8000-000000000009",
    } as const;
    await context.db.insert(inventoryItems).values({
      id: unrelated.itemId,
      ownerId: OWNER_ID,
      name: "ของที่ไม่เกี่ยว",
      category: "CONSUMABLE",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก",
      baseQuantityPerPurchasePack: "999.000000",
    });
    await context.db.insert(inventoryPrices).values({
      id: unrelated.priceId,
      ownerId: OWNER_ID,
      inventoryItemId: unrelated.itemId,
      packPriceSatang: 99_999,
      packBaseQuantity: "999.000000",
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    await context.db.insert(products).values({
      id: unrelated.productId,
      ownerId: OWNER_ID,
      name: "สินค้าไม่ถูกสั่ง",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 99_999,
    });
    await context.db.insert(recipes).values({
      id: unrelated.recipeId,
      ownerId: OWNER_ID,
      productId: unrelated.productId,
      name: "สูตรที่ไม่เกี่ยว",
    });
    await context.db.insert(recipeVersions).values({
      id: unrelated.versionId,
      ownerId: OWNER_ID,
      recipeId: unrelated.recipeId,
      versionCode: "unused",
      baseYieldQuantity: "999.000000",
      yieldUnit: "piece",
      laborMinutesPerBatch: 999,
      utilityCostSatangPerBatch: 99_999,
      wasteAllowancePercent: "99.0000",
      instructions: "ไม่เกี่ยว",
    });
    await context.db.insert(recipeIngredients).values({
      id: unrelated.ingredientId,
      ownerId: OWNER_ID,
      recipeVersionId: unrelated.versionId,
      inventoryItemId: unrelated.itemId,
      quantityInBaseUnit: "999.000000",
    });
    await context.db
      .update(products)
      .set({ activeRecipeVersionId: unrelated.versionId })
      .where(eq(products.id, unrelated.productId));
    await context.db.insert(deliveryMethods).values({
      id: unrelated.deliveryMethodId,
      ownerId: OWNER_ID,
      name: "วิธีส่งที่ไม่ใช้",
      defaultCustomerFeeSatang: 0,
      defaultInternalCostSatang: 0,
      requiresDeliveryLocation: false,
    });
    await context.db.insert(productPackagingRules).values([
      {
        id: unrelated.productRuleId,
        ownerId: OWNER_ID,
        scope: "PRODUCT",
        productId: unrelated.productId,
        deliveryMethodId: null,
        inventoryItemId: unrelated.itemId,
        consumptionBasis: "PER_ORDER",
        quantityInBaseUnit: "999.000000",
      },
      {
        id: unrelated.deliveryRuleId,
        ownerId: OWNER_ID,
        scope: "DELIVERY_METHOD",
        productId: null,
        deliveryMethodId: unrelated.deliveryMethodId,
        inventoryItemId: unrelated.itemId,
        consumptionBasis: "PER_DELIVERY",
        quantityInBaseUnit: "999.000000",
      },
    ]);

    const afterSource = await loadPlanningSource(
      context.db,
      OWNER_ID,
      scenario.cycleId,
      AS_OF,
    );
    const after = await service.preview(OWNER_ID, scenario.cycleId);

    expect(afterSource.settings.defaultWasteAllowancePercent).toBe("3");
    expect(afterSource.products[0]?.activeRecipe).toMatchObject({
      baseYieldQuantity: "6",
      wasteAllowancePercent: "10",
      ingredients: [
        expect.objectContaining({ quantityInBaseUnit: "1000" }),
      ],
    });
    expect(afterSource.packagingRules.map((rule) => rule.quantityInBaseUnit))
      .toEqual(["1", "1"]);
    expect(afterSource.products.map((product) => product.id)).toEqual([
      scenario.productId,
    ]);
    expect(afterSource.inventoryItems.map((item) => item.id)).toEqual([
      scenario.ingredientItemId,
      scenario.packagingItemId,
    ]);
    expect(afterSource.packagingRules.map((rule) => rule.id)).not.toContain(
      unrelated.productRuleId,
    );
    expect(after.inputFingerprint).toBe(before.inputFingerprint);
  });

  it("uses one batched select per dependent table", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    const scenario = await seedPlanningScenario(context.db);
    const secondProduct = {
      productId: "60000000-0000-4000-8000-000000000001",
      recipeId: "60000000-0000-4000-8000-000000000002",
      versionId: "60000000-0000-4000-8000-000000000003",
      ingredientId: "60000000-0000-4000-8000-000000000004",
      orderItemId: "60000000-0000-4000-8000-000000000005",
    } as const;
    await context.db.insert(products).values({
      id: secondProduct.productId,
      ownerId: OWNER_ID,
      name: "โชกุปัง",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 10_000,
    });
    await context.db.insert(recipes).values({
      id: secondProduct.recipeId,
      ownerId: OWNER_ID,
      productId: secondProduct.productId,
      name: "สูตรโชกุปัง",
    });
    await context.db.insert(recipeVersions).values({
      id: secondProduct.versionId,
      ownerId: OWNER_ID,
      recipeId: secondProduct.recipeId,
      versionCode: "v1",
      baseYieldQuantity: "4.000000",
      yieldUnit: "piece",
      laborMinutesPerBatch: 20,
      utilityCostSatangPerBatch: 1_000,
      wasteAllowancePercent: null,
      instructions: "ผสมและอบ",
    });
    await context.db.insert(recipeIngredients).values({
      id: secondProduct.ingredientId,
      ownerId: OWNER_ID,
      recipeVersionId: secondProduct.versionId,
      inventoryItemId: scenario.ingredientItemId,
      quantityInBaseUnit: "500.000000",
    });
    await context.db
      .update(products)
      .set({ activeRecipeVersionId: secondProduct.versionId })
      .where(eq(products.id, secondProduct.productId));
    await context.db.insert(orderItems).values({
      id: secondProduct.orderItemId,
      ownerId: OWNER_ID,
      orderId: scenario.orderIds[0]!,
      productId: secondProduct.productId,
      quantity: 1,
      unitPriceSatang: 10_000,
    });
    queries.length = 0;

    await loadPlanningSource(
      context.db,
      OWNER_ID,
      scenario.cycleId,
      AS_OF,
    );

    const sourceTables = [
      "bake_cycles",
      "shop_settings",
      "orders",
      "order_items",
      "customers",
      "delivery_methods",
      "products",
      "recipe_versions",
      "recipes",
      "recipe_ingredients",
      "product_packaging_rules",
      "inventory_items",
      "inventory_prices",
    ];
    for (const table of sourceTables) {
      const matchingQueries = queries.filter((query) =>
        query.includes(`from "${table}"`)
      );
      expect(matchingQueries, table).toHaveLength(1);
      expect(matchingQueries[0]?.split(" where ")[1], table).toContain(
        "owner_id",
      );
    }
    expect(
      queries.find((query) => query.includes('from "order_items"')),
    ).toContain(" in (");
    expect(
      queries.find((query) => query.includes('from "inventory_prices"')),
    ).toContain(" in (");
  });

  it("does not reveal settings while rejecting an unowned cycle", async () => {
    const scenario = await seedPlanningScenario(context.db);
    await context.db.insert(shopSettings).values({
      ownerId: OTHER_OWNER_ID,
      laborRateSatangPerHour: 1,
      defaultWasteAllowancePercent: "1.0000",
    });

    await expectExactError(
      createPlanningQueryService(context.db, { now: () => AS_OF }).preview(
        OTHER_OWNER_ID,
        scenario.cycleId,
      ),
      "Cycle not found",
    );
  });

  it("does not load a different cycle owned by the same owner", async () => {
    const scenario = await seedPlanningScenario(context.db);
    await context.db.insert(bakeCycles).values({
      id: "50000000-0000-4000-8000-000000000001",
      ownerId: OWNER_ID,
      name: "รอบที่ไม่เกี่ยว",
      status: "OPEN",
      targetProductionDate: "2026-09-05",
      primaryDeliveryDate: "2026-09-06",
    });

    const source = await loadPlanningSource(
      context.db,
      OWNER_ID,
      scenario.cycleId,
      AS_OF,
    );

    expect(source.cycle.id).toBe(scenario.cycleId);
    expect(source.cycle.name).toBe("รอบส่ง 30 ส.ค.");
  });
});
