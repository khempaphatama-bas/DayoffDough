import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import {
  seedLockedPlanningScenario,
  seedPlanningScenario,
} from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import {
  inventoryItems,
  inventoryMovements,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import { orderItems } from "@/modules/orders/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import { loadShoppingSource } from "./load-shopping-source";

const LOCKED_AT = new Date("2026-08-23T03:00:00.000Z");
const LOCK_REQUEST_ID = "53000000-0000-4000-8000-000000000001";
const EMPTY_SNAPSHOT_ID = "53000000-0000-4000-8000-000000000002";
const SECOND_PRODUCT = {
  productId: "53000000-0000-4000-8000-000000000003",
  recipeId: "53000000-0000-4000-8000-000000000004",
  recipeVersionId: "53000000-0000-4000-8000-000000000005",
  recipeIngredientId: "53000000-0000-4000-8000-000000000006",
  orderItemId: "53000000-0000-4000-8000-000000000007",
} as const;
const OTHER_ITEM_ID = "53000000-0000-4000-8000-000000000008";

type LoggedQuery = Readonly<{
  sql: string;
  params: ReadonlyArray<unknown>;
}>;

async function seedPlanWithRepeatedFlour(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
) {
  const scenario = await seedPlanningScenario(db);
  await db.insert(products).values({
    id: SECOND_PRODUCT.productId,
    ownerId: OWNER_ID,
    name: "ขนมปังนม",
    sellingUnit: "piece",
    defaultUnitPriceSatang: 8_000,
  });
  await db.insert(recipes).values({
    id: SECOND_PRODUCT.recipeId,
    ownerId: OWNER_ID,
    productId: SECOND_PRODUCT.productId,
    name: "สูตรขนมปังนม",
  });
  await db.insert(recipeVersions).values({
    id: SECOND_PRODUCT.recipeVersionId,
    ownerId: OWNER_ID,
    recipeId: SECOND_PRODUCT.recipeId,
    versionCode: "v1",
    baseYieldQuantity: "2",
    yieldUnit: "piece",
    laborMinutesPerBatch: 10,
    utilityCostSatangPerBatch: 500,
    wasteAllowancePercent: "0",
    instructions: "ผสมและอบ",
    activeFrom: new Date("2026-08-01T00:00:00.000Z"),
  });
  await db.insert(recipeIngredients).values({
    id: SECOND_PRODUCT.recipeIngredientId,
    ownerId: OWNER_ID,
    recipeVersionId: SECOND_PRODUCT.recipeVersionId,
    inventoryItemId: scenario.ingredientItemId,
    quantityInBaseUnit: "100",
  });
  await db
    .update(products)
    .set({ activeRecipeVersionId: SECOND_PRODUCT.recipeVersionId })
    .where(eq(products.id, SECOND_PRODUCT.productId));
  await db.insert(orderItems).values({
    id: SECOND_PRODUCT.orderItemId,
    ownerId: OWNER_ID,
    orderId: scenario.orderIds[0]!,
    productId: SECOND_PRODUCT.productId,
    quantity: 3,
    unitPriceSatang: 8_000,
    position: 1,
  });

  const clock = { now: () => new Date(LOCKED_AT) };
  const preview = await createPlanningQueryService(db, clock).preview(
    OWNER_ID,
    scenario.cycleId,
  );
  const generation = await createPlanningCommandService(db, clock).lock(
    OWNER_ID,
    {
      cycleId: scenario.cycleId,
      lockRequestId: LOCK_REQUEST_ID,
      inputFingerprint: preview.inputFingerprint,
      overrides: [],
    },
  );
  return { ...scenario, planningSnapshotId: generation.id };
}

describe("shopping source loader", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  }, 30_000);

  afterEach(async () => context.close(), 30_000);

  it("aggregates immutable requirements and batches owned operational reads", async () => {
    const queries: LoggedQuery[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string, params: unknown[]) {
          queries.push({ sql: query.toLowerCase(), params: [...params] });
        },
      } satisfies Logger,
    });
    const fixture = await seedPlanWithRepeatedFlour(context.db);

    await context.db
      .update(inventoryItems)
      .set({
        name: "ชื่อแป้งปัจจุบัน",
        category: "PACKAGING",
        baseUnit: "kg",
        purchaseUnitLabel: "กระสอบปัจจุบัน",
        baseQuantityPerPurchasePack: "2000",
        active: false,
      })
      .where(eq(inventoryItems.id, fixture.ingredientItemId));
    await context.db
      .update(inventoryItems)
      .set({
        name: "ชื่อถุงปัจจุบัน",
        purchaseUnitLabel: "ลังปัจจุบัน",
        baseQuantityPerPurchasePack: "250",
      })
      .where(eq(inventoryItems.id, fixture.packagingItemId));
    await context.db.insert(inventoryPrices).values({
      ownerId: OWNER_ID,
      inventoryItemId: fixture.ingredientItemId,
      packPriceSatang: 1,
      packBaseQuantity: "2000",
      effectiveAt: new Date("2026-08-23T04:00:00.000Z"),
    });
    await context.db
      .update(recipeIngredients)
      .set({ quantityInBaseUnit: "999999" })
      .where(eq(recipeIngredients.inventoryItemId, fixture.ingredientItemId));
    await context.db
      .update(productPackagingRules)
      .set({ quantityInBaseUnit: "999999" })
      .where(eq(productPackagingRules.inventoryItemId, fixture.packagingItemId));
    await context.db
      .update(orderItems)
      .set({ quantity: 99 })
      .where(eq(orderItems.orderId, fixture.orderIds[0]!));
    await context.db.insert(inventoryMovements).values([
      {
        ownerId: OWNER_ID,
        inventoryItemId: fixture.ingredientItemId,
        type: "CORRECTION",
        quantityDeltaInBaseUnit: "100",
        occurredAt: new Date("2026-08-23T04:00:00.000Z"),
      },
      {
        ownerId: OWNER_ID,
        inventoryItemId: fixture.ingredientItemId,
        type: "CORRECTION",
        quantityDeltaInBaseUnit: "25",
        occurredAt: new Date("2026-08-23T05:00:00.000Z"),
      },
      {
        ownerId: OWNER_ID,
        inventoryItemId: fixture.packagingItemId,
        type: "CORRECTION",
        quantityDeltaInBaseUnit: "4",
        occurredAt: new Date("2026-08-23T04:00:00.000Z"),
      },
    ]);
    await context.db.insert(inventoryItems).values({
      id: OTHER_ITEM_ID,
      ownerId: OTHER_OWNER_ID,
      name: "ของร้านอื่น",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000",
    });
    await context.db.insert(inventoryMovements).values({
      ownerId: OTHER_OWNER_ID,
      inventoryItemId: OTHER_ITEM_ID,
      type: "CORRECTION",
      quantityDeltaInBaseUnit: "999999",
      occurredAt: new Date("2026-08-23T04:00:00.000Z"),
    });
    queries.length = 0;

    const source = await loadShoppingSource(
      context.db,
      OWNER_ID,
      fixture.planningSnapshotId,
    );

    expect(source).toEqual([
      expect.objectContaining({
        inventoryItemId: fixture.packagingItemId,
        inventoryItemName: "ถุงขนม",
        inventoryCategory: "PACKAGING",
        baseUnit: "piece",
        unitCostSatang: "10",
        requiredQuantity: "14",
        purchaseUnitLabel: "ลังปัจจุบัน",
        baseQuantityPerPurchasePack: "250",
        systemBalance: "4",
      }),
      expect.objectContaining({
        inventoryItemId: fixture.ingredientItemId,
        inventoryItemName: "แป้งขนมปัง",
        inventoryCategory: "INGREDIENT",
        baseUnit: "g",
        unitCostSatang: "5.5",
        requiredQuantity: "2400",
        purchaseUnitLabel: "กระสอบปัจจุบัน",
        baseQuantityPerPurchasePack: "2000",
        systemBalance: "125",
      }),
    ]);

    const selects = queries.filter(({ sql: query }) =>
      query.startsWith("select"),
    );
    for (const table of [
      "cycle_material_requirements",
      "cycle_packaging_requirements",
      "cycle_inventory_price_snapshots",
      "inventory_items",
      "inventory_movements",
    ]) {
      const matches = selects.filter(({ sql: query }) =>
        query.includes(`from "${table}"`),
      );
      expect(matches, table).toHaveLength(1);
      expect(matches[0]!.params[0], `${table} owner`).toBe(OWNER_ID);
    }
    for (const table of [
      "orders",
      "order_items",
      "recipe_ingredients",
      "product_packaging_rules",
      "inventory_prices",
    ]) {
      expect(
        selects.some(({ sql: query }) => query.includes(`from "${table}"`)),
        table,
      ).toBe(false);
    }
    expect(
      selects.find(({ sql: query }) =>
        query.includes('from "inventory_items"'),
      )!.sql,
    ).not.toContain('"inventory_items"."active" =');
  });

  it("fails when an immutable requirement has no current inventory profile", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await context.db.execute(sql`set session_replication_role = replica`);
    try {
      await context.db
        .delete(inventoryItems)
        .where(
          and(
            eq(inventoryItems.ownerId, OWNER_ID),
            eq(inventoryItems.id, fixture.ingredientItemId),
          ),
        );
    } finally {
      await context.db.execute(sql`set session_replication_role = origin`);
    }

    await expect(
      loadShoppingSource(context.db, OWNER_ID, fixture.planningSnapshotId),
    ).rejects.toThrow("Shopping inventory profile missing");
  });

  it("avoids operational reads when a snapshot has no requirements", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });

    await expect(
      loadShoppingSource(context.db, OWNER_ID, EMPTY_SNAPSHOT_ID),
    ).resolves.toEqual([]);

    const selects = queries.filter((query) => query.startsWith("select"));
    for (const table of [
      "cycle_material_requirements",
      "cycle_packaging_requirements",
      "cycle_inventory_price_snapshots",
    ]) {
      expect(
        selects.filter((query) => query.includes(`from "${table}"`)),
        table,
      ).toHaveLength(1);
    }
    expect(selects.some((query) => query.includes('from "inventory_items"')))
      .toBe(false);
    expect(
      selects.some((query) => query.includes('from "inventory_movements"')),
    ).toBe(false);
  });
});
