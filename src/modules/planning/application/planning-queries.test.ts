import { count, eq } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
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
import {
  productionTemplateActivities,
  productionTemplates,
} from "@/modules/production/db/schema";
import { shopSettings } from "@/modules/settings/db/schema";
import { loadPlanningSource } from "./load-source";
import { createPlanningCommandService } from "./planning-commands";
import { createPlanningQueryService } from "./planning-queries";

const AS_OF = new Date("2026-08-29T00:00:00.000Z");
const MISSING_CYCLE_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";

type LoggedQuery = Readonly<{
  sql: string;
  params: ReadonlyArray<unknown>;
}>;

const ALLOWED_GENERATION_READ_TABLES = [
  "bake_cycles",
  "cycle_planning_snapshots",
  "cycle_planning_warnings",
  "cycle_order_snapshots",
  "cycle_order_item_snapshots",
  "cycle_recipe_plans",
  "cycle_product_plans",
  "cycle_material_requirements",
  "cycle_packaging_requirements",
  "cycle_product_cost_snapshots",
  "cycle_cost_snapshots",
] as const;

function referencedTables(sql: string): ReadonlyArray<string> {
  return Array.from(
    sql.matchAll(
      /\b(?:from|join)\s+(?:"[^"]+"\.)?"([^"]+)"/g,
    ),
    (match) => match[1]!,
  );
}

function selectQuery(
  queries: ReadonlyArray<LoggedQuery>,
  table: string,
): LoggedQuery {
  const matches = queries.filter(({ sql }) =>
    sql.includes(`from "${table}"`)
  );
  expect(matches, table).toHaveLength(1);
  return matches[0]!;
}

function whereClause(query: LoggedQuery): string {
  const where = query.sql.split(" where ")[1];
  expect(where, query.sql).toBeDefined();
  return where!.split(" order by ")[0]!.split(" limit ")[0]!;
}

function expectOwnedSelect(query: LoggedQuery, table: string): void {
  expect(whereClause(query), table).toContain(
    `"${table}"."owner_id" = $1`,
  );
  expect(query.params[0], table).toBe(OWNER_ID);
}

function expectOwnedSnapshotSelect(
  query: LoggedQuery,
  table: string,
  snapshotId: string,
): void {
  expect(whereClause(query), table).toContain(
    `"${table}"."owner_id" = $1`,
  );
  expect(whereClause(query), table).toContain(
    `"${table}"."planning_snapshot_id" = $2`,
  );
  expect(query.params.slice(0, 2), table).toEqual([OWNER_ID, snapshotId]);
}

function expectBatchedIds(
  query: LoggedQuery,
  table: string,
  column: string,
  expectedIds: ReadonlyArray<string>,
): void {
  const placeholders = expectedIds
    .map((_, index) => `$${index + 2}`)
    .join(", ");
  expect(whereClause(query), `${table}.${column}`).toContain(
    `"${table}"."${column}" in (${placeholders})`,
  );
  expect(query.params.slice(1, expectedIds.length + 1), `${table} params`)
    .toEqual(expectedIds);
}

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

  it.each([
    ["cross-owner", OTHER_OWNER_ID, "10000000-0000-4000-8000-000000000009"],
    ["missing", OWNER_ID, MISSING_CYCLE_ID],
  ])("does not reveal generation history for a %s cycle", async (_case, ownerId, cycleId) => {
    await seedPlanningScenario(context.db);
    const service = createPlanningQueryService(context.db, {
      now: () => AS_OF,
    });

    await expectExactError(
      service.listGenerations(ownerId, cycleId),
      "Planning generation not found",
    );
    await expectExactError(
      service.getGeneration(ownerId, cycleId),
      "Planning generation not found",
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

  it("loads only owned active production templates and active activities for ordered products", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const inactiveActivityId = "70000000-0000-4000-8000-000000000012";
    const inactiveTemplateId = "70000000-0000-4000-8000-000000000013";
    await context.db.insert(productionTemplates).values({
      id: inactiveTemplateId,
      ownerId: OWNER_ID,
      name: "เทมเพลตเก็บแล้ว",
      scope: "PRODUCT",
      productId: scenario.productId,
      active: false,
    });
    await context.db.insert(productionTemplateActivities).values([
      {
        id: inactiveActivityId,
        ownerId: OWNER_ID,
        productionTemplateId: "20000000-0000-4000-8000-000000000005",
        name: "กิจกรรมเก่า",
        offsetDaysFromDelivery: 1,
        defaultTime: "06:00",
        estimatedDurationMinutes: 30,
        sequence: 2,
        active: false,
      },
    ]);

    const source = await loadPlanningSource(context.db, OWNER_ID, scenario.cycleId, AS_OF);

    expect(source.productionTemplates).toEqual([
      {
        id: "20000000-0000-4000-8000-000000000005",
        name: "เทมเพลตฟอคคาเซียหลัก",
        scope: "PRODUCT",
        productId: scenario.productId,
        active: true,
        activities: [{
          id: "20000000-0000-4000-8000-000000000006",
          name: "เตรียมและอบ",
          offsetDaysFromDelivery: 1,
          defaultTime: "05:00",
          estimatedDurationMinutes: 30,
          sequence: 1,
          notes: "กิจกรรมจาก fixture",
        }],
      },
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
    const queries: LoggedQuery[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string, params: unknown[]) {
          queries.push({ sql: query.toLowerCase(), params: [...params] });
        },
      } satisfies Logger,
    });
    const scenario = await seedPlanningScenario(context.db);
    const secondDeliveryMethodId =
      "70000000-0000-4000-8000-000000000001";
    const secondCustomerId = "70000000-0000-4000-8000-000000000002";
    await context.db.insert(deliveryMethods).values({
      id: secondDeliveryMethodId,
      ownerId: OWNER_ID,
      name: "รับหน้าร้าน",
      defaultCustomerFeeSatang: 0,
      defaultInternalCostSatang: 0,
      requiresDeliveryLocation: false,
    });
    await context.db.insert(customers).values({
      id: secondCustomerId,
      ownerId: OWNER_ID,
      name: "คุณนิด",
      defaultDeliveryMethodId: secondDeliveryMethodId,
    });
    await context.db
      .update(orders)
      .set({
        customerId: secondCustomerId,
        deliveryMethodId: secondDeliveryMethodId,
        deliveryLocation: null,
      })
      .where(eq(orders.id, scenario.orderIds[1]!));
    await context.db.insert(productPackagingRules).values({
      id: "70000000-0000-4000-8000-000000000003",
      ownerId: OWNER_ID,
      scope: "DELIVERY_METHOD",
      productId: null,
      deliveryMethodId: secondDeliveryMethodId,
      inventoryItemId: scenario.packagingItemId,
      consumptionBasis: "PER_DELIVERY",
      quantityInBaseUnit: "1.000000",
    });
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
      position: 1,
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
      "production_templates",
      "production_template_activities",
      "inventory_items",
      "inventory_prices",
    ];
    for (const table of sourceTables) {
      expectOwnedSelect(selectQuery(queries, table), table);
    }

    const firstCustomerId = "10000000-0000-4000-8000-000000000008";
    const firstDeliveryMethodId =
      "10000000-0000-4000-8000-000000000007";
    const firstRecipeId = "10000000-0000-4000-8000-000000000004";
    const firstRecipeVersionId =
      "10000000-0000-4000-8000-000000000005";
    const productIds = [scenario.productId, secondProduct.productId];
    const recipeIds = [firstRecipeId, secondProduct.recipeId];
    const recipeVersionIds = [
      firstRecipeVersionId,
      secondProduct.versionId,
    ];
    const customerIds = [firstCustomerId, secondCustomerId];
    const deliveryMethodIds = [
      firstDeliveryMethodId,
      secondDeliveryMethodId,
    ];
    const inventoryItemIds = [
      scenario.ingredientItemId,
      scenario.packagingItemId,
    ];

    expectBatchedIds(
      selectQuery(queries, "order_items"),
      "order_items",
      "order_id",
      scenario.orderIds,
    );
    expectBatchedIds(
      selectQuery(queries, "customers"),
      "customers",
      "id",
      customerIds,
    );
    expectBatchedIds(
      selectQuery(queries, "delivery_methods"),
      "delivery_methods",
      "id",
      deliveryMethodIds,
    );
    expectBatchedIds(
      selectQuery(queries, "products"),
      "products",
      "id",
      productIds,
    );
    expectBatchedIds(
      selectQuery(queries, "recipe_versions"),
      "recipe_versions",
      "id",
      recipeVersionIds,
    );
    expectBatchedIds(
      selectQuery(queries, "recipes"),
      "recipes",
      "id",
      recipeIds,
    );
    expectBatchedIds(
      selectQuery(queries, "recipe_ingredients"),
      "recipe_ingredients",
      "recipe_version_id",
      recipeVersionIds,
    );
    expectBatchedIds(
      selectQuery(queries, "inventory_items"),
      "inventory_items",
      "id",
      inventoryItemIds,
    );
    expectBatchedIds(
      selectQuery(queries, "inventory_prices"),
      "inventory_prices",
      "inventory_item_id",
      inventoryItemIds,
    );

    const packagingQuery = selectQuery(
      queries,
      "product_packaging_rules",
    );
    expect(whereClause(packagingQuery)).toBe(
      '("product_packaging_rules"."owner_id" = $1 and (("product_packaging_rules"."scope" = $2 and "product_packaging_rules"."product_id" in ($3, $4)) or ("product_packaging_rules"."scope" = $5 and "product_packaging_rules"."delivery_method_id" in ($6, $7))))',
    );
    expect(packagingQuery.params.slice(0, 7)).toEqual([
      OWNER_ID,
      "PRODUCT",
      ...productIds,
      "DELIVERY_METHOD",
      ...deliveryMethodIds,
    ]);
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

  it("reads the active or explicit immutable generation without consulting changed master data", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(AS_OF) };
    const queries = createPlanningQueryService(context.db, clock);
    const preview = await queries.preview(OWNER_ID, scenario.cycleId);
    const locked = await createPlanningCommandService(context.db, clock).lock(
      OWNER_ID,
      {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "22222222-2222-4222-8222-222222222222",
        overrides: [],
      },
    );

    await context.db
      .update(bakeCycles)
      .set({
        cycleNumber: preview.cycle.cycleNumber + 100,
        name: "ชื่อและเลขรอบปัจจุบันหลังล็อก",
      })
      .where(eq(bakeCycles.id, scenario.cycleId));

    await context.db
      .update(products)
      .set({ name: "ชื่อสินค้าใหม่" })
      .where(eq(products.id, scenario.productId));
    await context.db
      .update(recipeIngredients)
      .set({ quantityInBaseUnit: "999.000000" })
      .where(
        eq(
          recipeIngredients.id,
          "10000000-0000-4000-8000-000000000006",
        ),
      );
    await context.db
      .update(inventoryPrices)
      .set({ packPriceSatang: 99_999 })
      .where(
        eq(
          inventoryPrices.id,
          "20000000-0000-4000-8000-000000000002",
        ),
      );
    await context.db
      .update(shopSettings)
      .set({
        laborRateSatangPerHour: 99_999,
        defaultWasteAllowancePercent: "99.0000",
      })
      .where(eq(shopSettings.ownerId, OWNER_ID));
    await context.db
      .update(productPackagingRules)
      .set({ quantityInBaseUnit: "99.000000" })
      .where(
        eq(
          productPackagingRules.id,
          "10000000-0000-4000-8000-00000000000a",
        ),
      );
    await context.db
      .update(deliveryMethods)
      .set({
        name: "ชื่อวิธีจัดส่งใหม่",
        requiresDeliveryLocation: false,
      })
      .where(eq(deliveryMethods.ownerId, OWNER_ID));
    await context.db.insert(recipeVersions).values({
      id: "80000000-0000-4000-8000-000000000002",
      ownerId: OWNER_ID,
      recipeId: "10000000-0000-4000-8000-000000000004",
      versionCode: "v2",
      baseYieldQuantity: "1.000000",
      yieldUnit: "piece",
      laborMinutesPerBatch: 999,
      utilityCostSatangPerBatch: 99_999,
      wasteAllowancePercent: null,
      instructions: "สูตรที่สร้างหลังล็อก",
    });
    await context.db
      .update(products)
      .set({
        activeRecipeVersionId:
          "80000000-0000-4000-8000-000000000002",
      })
      .where(eq(products.id, scenario.productId));

    const explicit = await queries.getGeneration(
      OWNER_ID,
      scenario.cycleId,
      1,
    );
    const active = await queries.getGeneration(OWNER_ID, scenario.cycleId);

    expect(explicit).toEqual(active);
    expect(explicit).toMatchObject({
      id: locked.id,
      cycleId: scenario.cycleId,
      generation: 1,
      status: "ACTIVE",
      cycleNumber: preview.cycle.cycleNumber,
      cycleName: "รอบส่ง 30 ส.ค.",
      warnings: [],
      orders: [
        expect.objectContaining({
          customerName: "คุณเมย์",
          deliveryMethodName: "ไรเดอร์",
          deliveryRequiresLocation: true,
          items: [expect.objectContaining({ productName: "ฟอคคาเซีย" })],
        }),
        expect.objectContaining({
          customerName: "คุณเมย์",
          deliveryRequiresLocation: true,
          items: [expect.objectContaining({ productName: "ฟอคคาเซีย" })],
        }),
      ],
      recipePlans: [
        expect.objectContaining({
          recipeName: "สูตรฟอคคาเซียหลัก",
          versionCode: "v1",
          baseYieldQuantity: "6.000000",
          laborMinutesPerBatch: 30,
        }),
      ],
      productPlans: [
        expect.objectContaining({
          productName: "ฟอคคาเซีย",
          selectedBatchCount: "2.000000",
          plannedOutput: "12.000000",
        }),
      ],
      materialRequirements: [
        expect.objectContaining({
          quantityPerBatch: "1000.000000",
          plannedRequirement: "2200.000000",
          baseCostSatang: 11_000,
          wasteCostSatang: 1_100,
        }),
      ],
      productCosts: [
        expect.objectContaining({
          laborCostSatang: 12_000,
          knownProductionCostSatang: 28_220,
        }),
      ],
      cycleCost: expect.objectContaining({
        knownProductionCostSatang: 28_240,
        completeProductionCostSatang: 28_240,
      }),
    });
    await expect(queries.listGenerations(OWNER_ID, scenario.cycleId)).resolves
      .toEqual([
        expect.objectContaining({ id: locked.id, generation: 1 }),
      ]);
  });

  it("owner-scopes every immutable child query and reads only immutable tables", async () => {
    const loggedQueries: LoggedQuery[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string, params: unknown[]) {
          loggedQueries.push({ sql: query.toLowerCase(), params: [...params] });
        },
      } satisfies Logger,
    });
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(AS_OF) };
    const service = createPlanningQueryService(context.db, clock);
    const preview = await service.preview(OWNER_ID, scenario.cycleId);
    const locked = await createPlanningCommandService(context.db, clock).lock(
      OWNER_ID,
      {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        overrides: [],
      },
    );
    loggedQueries.length = 0;

    await service.getGeneration(OWNER_ID, scenario.cycleId);

    for (const table of [
      "cycle_planning_warnings",
      "cycle_order_snapshots",
      "cycle_order_item_snapshots",
      "cycle_recipe_plans",
      "cycle_product_plans",
      "cycle_material_requirements",
      "cycle_packaging_requirements",
      "cycle_product_cost_snapshots",
      "cycle_cost_snapshots",
    ]) {
      expectOwnedSnapshotSelect(selectQuery(loggedQueries, table), table, locked.id);
    }

    for (const query of loggedQueries) {
      const tables = referencedTables(query.sql);
      expect(tables, query.sql).not.toHaveLength(0);
      for (const table of tables) {
        expect(
          ALLOWED_GENERATION_READ_TABLES,
          `${table} referenced by ${query.sql}`,
        ).toContain(table);
      }
    }
  });
});
