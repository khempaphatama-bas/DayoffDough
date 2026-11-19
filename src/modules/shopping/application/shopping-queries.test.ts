import { and, asc, eq } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareConsumptionFixture } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import {
  seedLockedPlanningScenario,
  seedPlanningScenario,
} from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createConsumptionCommandService } from "@/modules/consumption/application/consumption-commands";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { inventoryItems, inventoryMovements, inventoryPrices } from "@/modules/inventory/db/schema";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { cycleInventoryPriceSnapshots } from "@/modules/planning/db/schema";
import { createProductService } from "@/modules/products/application/products";
import {
  cycleInventoryCounts,
  cyclePurchaseEntries,
  cycleShoppingItems,
} from "@/modules/shopping/db/schema";
import { createShoppingQueryService } from "./shopping-queries";

const CLOCK = { now: () => new Date("2026-08-23T03:00:00.000Z") };
const COUNTED_AT = new Date("2026-08-23T04:00:00.000Z");
const PURCHASED_AT = new Date("2026-08-23T05:00:00.000Z");
const CONFIRMATION_REQUEST_ID = "54000000-0000-4000-8000-000000000001";
const PURCHASE_REQUEST_IDS = [
  "54000000-0000-4000-8000-000000000002",
  "54000000-0000-4000-8000-000000000003",
] as const;

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type LockedFixture = Awaited<ReturnType<typeof seedLockedPlanningScenario>>;

async function persistShopping(db: TestDatabase["db"], fixture: LockedFixture) {
  const priceRows = await db
    .select()
    .from(cycleInventoryPriceSnapshots)
    .where(
      and(
        eq(cycleInventoryPriceSnapshots.ownerId, OWNER_ID),
        eq(cycleInventoryPriceSnapshots.planningSnapshotId, fixture.planningSnapshotId),
      ),
    )
    .orderBy(asc(cycleInventoryPriceSnapshots.inventoryItemName));
  const priceByItemId = new Map(priceRows.map((row) => [row.inventoryItemId, row]));

  const seeds = [
    {
      inventoryItemId: fixture.packagingItemId,
      requiredQuantity: "12",
      countedQuantity: "4",
      shortfallQuantity: "8",
      suggestedPackCount: 1,
      suggestedPurchaseQuantity: "100",
      purchasedQuantity: "100",
    },
    {
      inventoryItemId: fixture.ingredientItemId,
      requiredQuantity: "2200",
      countedQuantity: "1000",
      shortfallQuantity: "1200",
      suggestedPackCount: 2,
      suggestedPurchaseQuantity: "2000",
      purchasedQuantity: "1000",
    },
  ] as const;

  for (const [index, seed] of seeds.entries()) {
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.ownerId, OWNER_ID),
          eq(inventoryItems.id, seed.inventoryItemId),
        ),
      )
      .limit(1);
    const priceSnapshot = priceByItemId.get(seed.inventoryItemId);
    if (!item || !priceSnapshot) throw new Error("Shopping fixture source missing");

    const [countMovement] = await db
      .insert(inventoryMovements)
      .values({
        ownerId: OWNER_ID,
        inventoryItemId: seed.inventoryItemId,
        type: "COUNT",
        quantityDeltaInBaseUnit: seed.countedQuantity,
        countedQuantityInBaseUnit: seed.countedQuantity,
        referenceType: "CYCLE_INVENTORY_COUNT",
        occurredAt: COUNTED_AT,
      })
      .returning();
    if (!countMovement) throw new Error("Shopping fixture count movement missing");

    const [count] = await db
      .insert(cycleInventoryCounts)
      .values({
        ownerId: OWNER_ID,
        bakeCycleId: fixture.cycleId,
        planningSnapshotId: fixture.planningSnapshotId,
        inventoryItemId: seed.inventoryItemId,
        priceSnapshotId: priceSnapshot.id,
        inventoryItemName: item.name,
        inventoryCategory: item.category,
        baseUnit: item.baseUnit,
        requiredQuantity: seed.requiredQuantity,
        systemBalanceBeforeCount: "0",
        countedQuantity: seed.countedQuantity,
        countDeltaQuantity: seed.countedQuantity,
        purchaseUnitLabel: item.purchaseUnitLabel,
        baseQuantityPerPurchasePack: item.baseQuantityPerPurchasePack,
        countMovementId: countMovement.id,
        countedAt: COUNTED_AT,
        confirmationRequestId: CONFIRMATION_REQUEST_ID,
      })
      .returning();
    if (!count) throw new Error("Shopping fixture count missing");

    const [shopping] = await db
      .insert(cycleShoppingItems)
      .values({
        ownerId: OWNER_ID,
        bakeCycleId: fixture.cycleId,
        planningSnapshotId: fixture.planningSnapshotId,
        inventoryCountId: count.id,
        inventoryItemId: seed.inventoryItemId,
        shortfallQuantity: seed.shortfallQuantity,
        suggestedPackCount: seed.suggestedPackCount,
        suggestedPurchaseQuantity: seed.suggestedPurchaseQuantity,
        estimatedCostSatang: null,
      })
      .returning();
    if (!shopping) throw new Error("Shopping fixture shopping item missing");

    const [purchaseMovement] = await db
      .insert(inventoryMovements)
      .values({
        ownerId: OWNER_ID,
        inventoryItemId: seed.inventoryItemId,
        type: "PURCHASE",
        quantityDeltaInBaseUnit: seed.purchasedQuantity,
        referenceType: "CYCLE_PURCHASE_ENTRY",
        occurredAt: PURCHASED_AT,
      })
      .returning();
    const [purchasePrice] = await db
      .insert(inventoryPrices)
      .values({
        ownerId: OWNER_ID,
        inventoryItemId: seed.inventoryItemId,
        packPriceSatang: 5_500,
        packBaseQuantity: seed.purchasedQuantity,
        effectiveAt: PURCHASED_AT,
      })
      .returning();
    if (!purchaseMovement || !purchasePrice) {
      throw new Error("Shopping fixture purchase source missing");
    }
    await db.insert(cyclePurchaseEntries).values({
      ownerId: OWNER_ID,
      bakeCycleId: fixture.cycleId,
      planningSnapshotId: fixture.planningSnapshotId,
      shoppingItemId: shopping.id,
      inventoryItemId: seed.inventoryItemId,
      purchaseRequestId: PURCHASE_REQUEST_IDS[index]!,
      packCount: 1,
      packBaseQuantity: item.baseQuantityPerPurchasePack,
      purchasedQuantity: seed.purchasedQuantity,
      totalPriceSatang: 5_500,
      occurredAt: PURCHASED_AT,
      inventoryMovementId: purchaseMovement.id,
      inventoryPriceId: purchasePrice.id,
    });
  }
}

describe("shopping query service", () => {
  let context: TestDatabase;
  let service: ReturnType<typeof createShoppingQueryService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createShoppingQueryService(context.db);
  }, 30_000);

  afterEach(async () => context.close(), 30_000);

  it("shows_no_count_needed_for_empty_generation only while writable", async () => {
    const fixture = await seedPlanningScenario(context.db);
    const water = await createInventoryService(context.db).createItem(OWNER_ID, {
      name: "น้ำ", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "ml",
    });
    const products = createProductService(context.db);
    const recipe = await products.createRecipeVersion(OWNER_ID, fixture.productId, {
      versionCode: "v2", baseYieldQuantity: "6", yieldUnit: "piece", laborMinutesPerBatch: 30,
      utilityCostSatangPerBatch: 2000, wasteAllowancePercent: "10", instructions: "เตรียมน้ำ",
      ingredients: [{ inventoryItemId: water.id, quantityInBaseUnit: "500" }],
    });
    await products.activateRecipeVersion(OWNER_ID, fixture.productId, recipe.id);
    await context.db.delete(productPackagingRules).where(eq(productPackagingRules.ownerId, OWNER_ID));
    const preview = await createPlanningQueryService(context.db, CLOCK).preview(OWNER_ID, fixture.cycleId);
    const commands = createPlanningCommandService(context.db, CLOCK);
    const generation = await commands.lock(OWNER_ID, {
      cycleId: fixture.cycleId, inputFingerprint: preview.inputFingerprint,
      lockRequestId: "54000000-0000-4000-8000-000000000009", overrides: [],
    });
    expect(await service.getCycleStockCheck(OWNER_ID, fixture.cycleId)).toMatchObject({ kind: "NO_STOCK_REQUIRED", writable: false });
    await expect(createCycleOperationsCommandService(context.db, CLOCK).startCycle(OWNER_ID, { cycleId: fixture.cycleId }))
      .resolves.toMatchObject({ status: "IN_PRODUCTION" });
    const { input } = await prepareConsumptionFixture(context.db, OWNER_ID, fixture.cycleId);
    expect(input.items).toEqual([]);
    const consumption = createConsumptionCommandService(context.db, CLOCK);
    await expect(consumption.confirmUse(OWNER_ID, { ...input, confirmEmpty: false }))
      .rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await consumption.confirmUse(OWNER_ID, input);
    await commands.unlock(OWNER_ID, { cycleId: fixture.cycleId, reason: "เปลี่ยนแผน", confirmation: "ปลดล็อก" });
    expect(await service.getCycleStockCheck(OWNER_ID, fixture.cycleId, generation.generation)).toMatchObject({ kind: "HISTORY", writable: false });
  });

  it("returns COUNT_REQUIRED for an active locked generation without counts", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);

    const view = await service.getCycleStockCheck(OWNER_ID, fixture.cycleId);

    expect(view.kind).toBe("COUNT_REQUIRED");
    if (view.kind !== "COUNT_REQUIRED") throw new Error("Expected count view");
    expect(view.writable).toBe(true);
    expect(view.items.map((item) => item.inventoryItemName)).toEqual([
      "ถุงขนม",
      "แป้งขนมปัง",
    ]);
  });

  it("returns NO_PLAN without an active or selected generation", async () => {
    const fixture = await seedPlanningScenario(context.db, { cycleStatus: "DRAFT" });

    await expect(service.getCycleStockCheck(OWNER_ID, fixture.cycleId)).resolves.toMatchObject({
      kind: "NO_PLAN",
      writable: false,
    });
  });

  it("rejects invalid and missing selected generations", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);

    await expect(
      service.getCycleStockCheck(OWNER_ID, fixture.cycleId, 0),
    ).rejects.toThrow("Shopping generation not found");
    await expect(
      service.getCycleStockCheck(OWNER_ID, fixture.cycleId, 2),
    ).rejects.toThrow("Shopping generation not found");
  });

  it("returns unconfirmed HISTORY for a superseded generation", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await createPlanningCommandService(context.db, CLOCK).unlock(OWNER_ID, {
      cycleId: fixture.cycleId,
      reason: "ปรับรอบ",
      confirmation: "ปลดล็อก",
    });

    const view = await service.getCycleStockCheck(
      OWNER_ID,
      fixture.cycleId,
      fixture.generation,
    );

    expect(view).toMatchObject({
      kind: "HISTORY",
      confirmedAt: null,
      counts: [],
      items: [],
      writable: false,
    });
  });

  it("returns active SHOPPING and superseded HISTORY from persisted shopping data", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await persistShopping(context.db, fixture);

    const active = await service.getCycleStockCheck(OWNER_ID, fixture.cycleId);
    expect(active.kind).toBe("SHOPPING");
    if (active.kind !== "SHOPPING") throw new Error("Expected shopping view");
    expect(active.writable).toBe(true);
    expect(active.confirmedAt).toEqual(COUNTED_AT);
    expect(active.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryItemName: "แป้งขนมปัง",
          progress: {
            status: "PARTIAL",
            purchasedQuantity: "1000",
            remainingQuantity: "200",
            overageQuantity: "0",
          },
        }),
        expect.objectContaining({
          inventoryItemName: "ถุงขนม",
          progress: {
            status: "COMPLETE",
            purchasedQuantity: "100",
            remainingQuantity: "0",
            overageQuantity: "92",
          },
        }),
      ]),
    );

    await createPlanningCommandService(context.db, CLOCK).unlock(OWNER_ID, {
      cycleId: fixture.cycleId,
      reason: "ปรับรอบ",
      confirmation: "ปลดล็อก",
    });
    const history = await service.getCycleStockCheck(
      OWNER_ID,
      fixture.cycleId,
      fixture.generation,
    );
    expect(history).toMatchObject({ kind: "HISTORY", writable: false });
  });

  it("reads historical shopping without current inventory data and batches purchases", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    service = createShoppingQueryService(context.db);
    const fixture = await seedLockedPlanningScenario(context.db);
    await persistShopping(context.db, fixture);
    await createPlanningCommandService(context.db, CLOCK).unlock(OWNER_ID, {
      cycleId: fixture.cycleId,
      reason: "ปรับรอบ",
      confirmation: "ปลดล็อก",
    });
    queries.length = 0;

    const view = await service.getCycleStockCheck(
      OWNER_ID,
      fixture.cycleId,
      fixture.generation,
    );

    expect(view.kind).toBe("HISTORY");
    const selects = queries.filter((query) => query.startsWith("select"));
    expect(
      selects.some((query) => query.includes('from "inventory_items"')),
    ).toBe(false);
    expect(
      selects.some((query) => query.includes('from "inventory_movements"')),
    ).toBe(false);
    expect(
      selects.filter((query) => query.includes('from "cycle_purchase_entries"')),
    ).toHaveLength(1);
  });
});
