import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { createTestDatabase } from "@tests/helpers/test-db";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { confirmConsumptionStock } from "@tests/fixtures/consumption";
import { recordOperationsConsumption } from "@tests/fixtures/operations";
import type { DatabaseClient } from "@/lib/db/types";
import { inventoryLedgerStates, inventoryMovements, inventoryPrices } from "@/modules/inventory/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { orderItems } from "@/modules/orders/db/schema";
import { cycleInventoryPriceSnapshots } from "@/modules/planning/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { products, recipeIngredients, recipeVersions } from "@/modules/products/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import { createShoppingCommandService } from "@/modules/shopping/application/shopping-commands";
import { cyclePurchaseEntries, cycleShoppingItems } from "@/modules/shopping/db/schema";
import { createInventoryService } from "./inventory";

const flourDefaults = {
  name: "Flour",
  category: "INGREDIENT",
  baseUnit: "g",
  purchaseUnitLabel: "ถุง",
  baseQuantityPerPurchasePack: "1000",
  minimumStockQuantity: "0",
} as const;
const price = {
  packPriceSatang: 5000,
  packBaseQuantity: "1000",
  effectiveAt: new Date("2026-08-23T05:00:00Z"),
};

async function completeStartedCycle(
  db: DatabaseClient,
  { cycleId, orderIds, planningSnapshotId }: Awaited<ReturnType<typeof seedLockedPlanningScenario>>,
) {
  const orders = createOrderOperationsCommandService(db);
  const liveOrderIds = orderIds.slice(0, 2);
  await orders.startOrders(OWNER_ID, { cycleId, orderIds: liveOrderIds });
  for (const orderId of liveOrderIds) {
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    await orders.setPackedQuantity(OWNER_ID, {
      cycleId, orderItemId: item!.id,
      packedQuantity: item!.quantity, expectedPackedQuantity: 0,
    });
    await orders.confirmOrderPacked(OWNER_ID, { cycleId, orderId });
  }
  await orders.deliverOrders(OWNER_ID, { cycleId, orderIds: liveOrderIds });
  const [generation] = await db.select().from(cycleTaskGenerations)
    .where(eq(cycleTaskGenerations.planningSnapshotId, planningSnapshotId));
  await db.update(cycleTasks).set({ status: "DONE" })
    .where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
  await recordOperationsConsumption(db, OWNER_ID, cycleId, true);
  await createCycleOperationsCommandService(db).completeCycle(OWNER_ID, {
    cycleId, expectedTaskGenerationId: generation!.id, confirmation: true,
  });
}

describe("inventory service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createInventoryService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createInventoryService(context.db);
  });

  afterEach(async () => {
    await context.close();
  });

  it("updates defaults without rewriting prices, movements or purchases", async () => {
    const db = context.db;
    const fixture = await seedLockedPlanningScenario(db);
    const itemId = fixture.ingredientItemId;
    const { cycleId, planningSnapshotId } = fixture;
    const shopping = createShoppingCommandService(db, { now: () => price.effectiveAt });
    await shopping.confirmStock(OWNER_ID, {
      cycleId, planningSnapshotId, confirmationRequestId: randomUUID(),
      countedAt: new Date("2026-08-23T04:00:00Z"),
      counts: [
        { inventoryItemId: itemId, countedQuantity: "0" },
        { inventoryItemId: fixture.packagingItemId, countedQuantity: "0" },
      ],
    });
    const [shoppingItem] = await db.select().from(cycleShoppingItems)
      .where(eq(cycleShoppingItems.inventoryItemId, itemId));
    await shopping.recordPurchase(OWNER_ID, {
      cycleId, planningSnapshotId, shoppingItemId: shoppingItem!.id,
      purchaseRequestId: randomUUID(), packCount: 1, totalPriceSatang: 5000,
      occurredAt: price.effectiveAt, purchasedFrom: "Bakery supplier",
    });
    await expect(service.updateItem(OWNER_ID, itemId, {
      ...flourDefaults, baseQuantityPerPurchasePack: "1000.000000", notes: "new note",
    })).resolves.toMatchObject({ name: "Flour", baseQuantityPerPurchasePack: "1000", notes: "new note" });
    await createCycleOperationsCommandService(db).startCycle(OWNER_ID, { cycleId });
    await completeStartedCycle(db, fixture);
    const priceHistoryBefore = (await service.getItemDetail(OWNER_ID, itemId)).priceHistory;
    const movementsBefore = await db.select().from(inventoryMovements).orderBy(inventoryMovements.id);
    const purchasesBefore = await db.select().from(cyclePurchaseEntries);
    expect(purchasesBefore).toHaveLength(1);

    await expect(service.updateItem(OWNER_ID, itemId, {
      ...flourDefaults, purchaseUnitLabel: "กล่อง", baseQuantityPerPurchasePack: "2000", minimumStockQuantity: "150",
    })).resolves.toMatchObject({ purchaseUnitLabel: "กล่อง", baseQuantityPerPurchasePack: "2000", minimumStockQuantity: "150" });

    expect((await service.getItemDetail(OWNER_ID, itemId)).priceHistory).toEqual(priceHistoryBefore);
    expect(await db.select().from(inventoryMovements).orderBy(inventoryMovements.id)).toEqual(movementsBefore);
    expect(await db.select().from(cyclePurchaseEntries)).toEqual(purchasesBefore);
  });

  it("freezes used identity but not an inert ledger balance", async () => {
    const db = context.db;
    const fixture = await seedPlanningScenario(db, {
      includeIngredientPrice: false, includePackagingPrice: false,
    });
    const archivedLine = await db.select().from(recipeIngredients)
      .where(eq(recipeIngredients.inventoryItemId, fixture.ingredientItemId));
    await db.update(products).set({ activeRecipeVersionId: null }).where(eq(products.id, fixture.productId));
    await db.update(recipeVersions).set({ archivedAt: price.effectiveAt })
      .where(eq(recipeVersions.id, archivedLine[0]!.recipeVersionId));
    const priced = await service.createItem(OWNER_ID, { ...flourDefaults, name: "Priced" });
    const counted = await service.createItem(OWNER_ID, { ...flourDefaults, name: "Counted" });
    const inert = await service.createItem(OWNER_ID, { ...flourDefaults, name: "Inert" });
    await service.addPrice(OWNER_ID, priced.id, price);
    await service.recordCount(OWNER_ID, counted.id, "0", price.effectiveAt);
    const [ledger] = await db.select().from(inventoryLedgerStates)
      .where(eq(inventoryLedgerStates.inventoryItemId, inert.id));
    expect(ledger).toMatchObject({ ledgerRevision: 0n, latestCountMovementId: null });

    for (const [reference, itemId] of [
      ["archived recipe", fixture.ingredientItemId], ["rule", fixture.packagingItemId],
      ["price", priced.id], ["zero count movement", counted.id],
    ] as const) {
      await expect(service.updateItem(OWNER_ID, itemId, { ...flourDefaults, baseUnit: "kg" }), reference)
        .rejects.toMatchObject({ code: "IDENTITY_IN_USE" });
      expect(await service.getItemEditPolicy(OWNER_ID, itemId), reference)
        .toEqual({ canChangeIdentity: false, canChangePack: true });
    }
    expect(await service.getItemEditPolicy(OWNER_ID, inert.id))
      .toEqual({ canChangeIdentity: true, canChangePack: true });
    await expect(service.updateItem(OWNER_ID, inert.id, {
      name: "Inert", category: "INGREDIENT", baseUnit: "kg", ingredientKind: "ICE",
    })).resolves.toMatchObject({
      baseUnit: "kg", ingredientKind: "ICE", purchaseUnitLabel: "ไม่ต้องซื้อ",
      baseQuantityPerPurchasePack: "1", minimumStockQuantity: "0",
    });
  });

  it("guards both pack fields and archive while the current plan is in flight", async () => {
    const { db } = context;
    const fixture = await seedLockedPlanningScenario(db);
    const itemId = fixture.ingredientItemId;
    await expect(service.archiveItem(OWNER_ID, itemId)).rejects.toMatchObject({ code: "ACTIVE_RECIPE" });
    await expect(service.archiveItem(OWNER_ID, fixture.packagingItemId))
      .rejects.toMatchObject({ code: "PACKAGING_RULE" });
    await db.update(products).set({ activeRecipeVersionId: null }).where(eq(products.id, fixture.productId));
    const assertCurrentPlanBlocksChanges = async () => {
      expect(await service.getItemEditPolicy(OWNER_ID, itemId))
        .toEqual({ canChangeIdentity: false, canChangePack: false });
      await expect(service.archiveItem(OWNER_ID, itemId)).rejects.toMatchObject({ code: "ACTIVE_PLAN" });
      for (const edit of [{ purchaseUnitLabel: "กล่อง" }, { baseQuantityPerPurchasePack: "2000" }]) {
        await expect(service.updateItem(OWNER_ID, itemId, { ...flourDefaults, ...edit }))
          .rejects.toMatchObject({ code: "PACK_IN_USE" });
      }
      expect((await service.getItemEditPolicy(OWNER_ID, fixture.packagingItemId))?.canChangePack).toBe(false);
    };
    await assertCurrentPlanBlocksChanges();
    await confirmConsumptionStock(db, OWNER_ID, fixture.cycleId, fixture.planningSnapshotId);
    await createCycleOperationsCommandService(db).startCycle(OWNER_ID, { cycleId: fixture.cycleId });
    await assertCurrentPlanBlocksChanges();
    await completeStartedCycle(db, fixture);
    await expect(service.archiveItem(OWNER_ID, itemId)).resolves.toMatchObject({ active: false });
  });

  it("still protects recipe-only ingredients in current snapshot lineage, but not after superseding it", async () => {
    const { db } = context;
    const fixture = await seedLockedPlanningScenario(db);
    const [line] = await db.select().from(recipeIngredients)
      .where(eq(recipeIngredients.inventoryItemId, fixture.ingredientItemId));
    const water = await service.createItem(OWNER_ID, {
      name: "Water", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "ml",
    });
    await db.insert(recipeIngredients).values({
      ownerId: OWNER_ID, recipeVersionId: line!.recipeVersionId,
      inventoryItemId: water.id, quantityInBaseUnit: "250",
    });
    await db.update(products).set({ activeRecipeVersionId: null }).where(eq(products.id, fixture.productId));
    expect(await service.getItemEditPolicy(OWNER_ID, water.id))
      .toEqual({ canChangeIdentity: false, canChangePack: true });
    await expect(service.archiveItem(OWNER_ID, water.id)).rejects.toMatchObject({ code: "ACTIVE_PLAN" });
    await createPlanningCommandService(db).unlock(OWNER_ID, { cycleId: fixture.cycleId, reason: "Replan", confirmation: "ปลดล็อก" });
    await expect(service.archiveItem(OWNER_ID, water.id)).resolves.toMatchObject({ active: false });
  });

  it("freezes identity for a snapshot-only row but allows disabling after it is superseded", async () => {
    const { db } = context;
    const fixture = await seedLockedPlanningScenario(db);
    const item = await service.createItem(OWNER_ID, { ...flourDefaults, name: "Snapshot-only item" });
    await db.insert(cycleInventoryPriceSnapshots).values({
      ownerId: OWNER_ID, planningSnapshotId: fixture.planningSnapshotId,
      inventoryItemId: item.id, inventoryItemName: item.name, inventoryCategory: "INGREDIENT", baseUnit: "g",
    });
    await createPlanningCommandService(db).unlock(OWNER_ID, { cycleId: fixture.cycleId, reason: "Replan", confirmation: "ปลดล็อก" });
    await expect(service.updateItem(OWNER_ID, item.id, { ...flourDefaults, name: item.name, baseUnit: "kg" }))
      .rejects.toMatchObject({ code: "IDENTITY_IN_USE" });
    await expect(service.archiveItem(OWNER_ID, item.id)).resolves.toMatchObject({ active: false });
  });

  it("keeps disabled price history readable and refuses new prices and counts", async () => {
    const item = await service.createItem(OWNER_ID, flourDefaults);
    await service.addPrice(OWNER_ID, item.id, price);
    const { priceHistory } = await service.getItemDetail(OWNER_ID, item.id);
    await expect(service.archiveItem(OTHER_OWNER_ID, item.id)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Inventory item not found" });
    await expect(service.archiveItem(OWNER_ID, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND", message: "Inventory item not found" });
    await expect(service.updateItem(OTHER_OWNER_ID, item.id, flourDefaults)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.getItemEditPolicy(OTHER_OWNER_ID, item.id)).toBeNull();
    await expect(service.archiveItem(OWNER_ID, item.id)).resolves.toMatchObject({ active: false });
    expect(await service.getItemDetail(OWNER_ID, item.id)).toMatchObject({ active: false, priceHistory });
    await expect(service.addPrice(OWNER_ID, item.id, price)).rejects.toMatchObject({ code: "INACTIVE" });
    await expect(service.recordCount(OWNER_ID, item.id, "10", price.effectiveAt)).rejects.toMatchObject({ code: "INACTIVE" });
    await expect(service.updateItem(OWNER_ID, item.id, flourDefaults)).rejects.toMatchObject({ code: "INACTIVE" });
  });

  it("validates prepare-only units and refuses their new prices and counts", async () => {
    const water = { name: "Water", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "l" } as const;
    await expect(service.createItem(OWNER_ID, { ...water, baseUnit: "g" })).rejects.toThrow("Invalid inventory item");
    await expect(service.createItem(OWNER_ID, { ...water, category: "PACKAGING" })).rejects.toThrow("Invalid inventory item");
    await expect(service.createItem(OWNER_ID, { ...water, ingredientKind: "STANDARD" })).rejects.toThrow("Invalid inventory item");
    const item = await service.createItem(OWNER_ID, water);
    expect(item).toMatchObject({ ingredientKind: "WATER", purchaseUnitLabel: "ไม่ต้องซื้อ", baseQuantityPerPurchasePack: "1", minimumStockQuantity: "0" });
    await expect(service.addPrice(OWNER_ID, item.id, price)).rejects.toMatchObject({ code: "PREP_ONLY" });
    await expect(service.recordCount(OWNER_ID, item.id, "10", price.effectiveAt)).rejects.toMatchObject({ code: "PREP_ONLY" });
    expect(await context.db.select().from(inventoryMovements)).toEqual([]);
    expect(await context.db.select().from(inventoryPrices)).toEqual([]);
  });

  it("rejects stale price and count units without writing rows", async () => {
    const item = await service.createItem(OWNER_ID, flourDefaults);
    await service.updateItem(OWNER_ID, item.id, { ...flourDefaults, baseUnit: "kg" });
    await expect(service.addPrice(OWNER_ID, item.id, { ...price, expectedBaseUnit: "g" }))
      .rejects.toMatchObject({ code: "ITEM_CHANGED" });
    await expect(service.recordCount(OWNER_ID, item.id, "10", price.effectiveAt, "g"))
      .rejects.toMatchObject({ code: "ITEM_CHANGED" });
    expect(await context.db.select().from(inventoryMovements)).toEqual([]);
    expect(await context.db.select().from(inventoryPrices)).toEqual([]);
  });

  it("maps a COUNT guard lock conflict to safe STALE_DATA without writing", async () => {
    const item = await service.createItem(OWNER_ID, { name: "Flour", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000", minimumStockQuantity: "0" });
    await context.db.execute(sql`CREATE FUNCTION test_inventory_contention() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'private SQL detail' USING ERRCODE = '55P03'; END; $$ LANGUAGE plpgsql`);
    await context.db.execute(sql`CREATE TRIGGER test_inventory_contention BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION test_inventory_contention()`);
    await expect(service.recordCount(OWNER_ID, item.id, "25", new Date())).rejects.toMatchObject({ kind: "STALE_DATA", message: "Stock changed; refresh and try again" });
    expect((await service.getItemDetail(OWNER_ID, item.id)).stockBalance).toBe("0");
  });

  it("stores price history and returns the latest effective unit cost", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "NS Wonder",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "500",
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 5500,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-08-01T00:00:00+07:00"),
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 6000,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-09-01T00:00:00+07:00"),
    });

    const detail = await service.getItemDetail(
      OWNER_ID,
      item.id,
      new Date("2026-08-22T00:00:00+07:00"),
    );
    expect(detail.latestUnitCostSatang?.toString()).toBe("5.5");
    expect(detail.priceHistory).toHaveLength(2);
  });

  it("uses effective time before creation time for a purchase price with total money and quantity", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "Purchase-priced flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "bag",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 5_700,
      packBaseQuantity: "2000",
      effectiveAt: new Date("2026-08-24T00:00:00.000Z"),
      purchasedFrom: "ร้านวัตถุดิบ",
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 9_999,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    await context.db
      .update(inventoryPrices)
      .set({ createdAt: new Date("2026-08-26T00:00:00.000Z") })
      .where(
        and(
          eq(inventoryPrices.ownerId, OWNER_ID),
          eq(inventoryPrices.inventoryItemId, item.id),
          eq(inventoryPrices.packPriceSatang, 9_999),
        ),
      );

    const detail = await service.getItemDetail(
      OWNER_ID,
      item.id,
      new Date("2026-08-25T00:00:00.000Z"),
    );
    expect(detail.latestPrice).toMatchObject({
      packPriceSatang: 5_700,
      packBaseQuantity: "2000",
      purchasedFrom: "ร้านวัตถุดิบ",
    });
    expect(detail.latestUnitCostSatang?.toString()).toBe("2.85");
  });

  it("reconciles repeated physical counts without leaking another owner's stock", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "Bread bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 100 ใบ",
      baseQuantityPerPurchasePack: "100",
      minimumStockQuantity: "20",
    });
    await service.recordCount(OWNER_ID, item.id, "750", new Date("2026-08-21"));
    await service.recordCount(OWNER_ID, item.id, "700", new Date("2026-08-22"));

    expect((await service.getItemDetail(OWNER_ID, item.id)).stockBalance).toBe("700");
    await expect(service.getItemDetail(OTHER_OWNER_ID, item.id)).rejects.toThrow(
      "Inventory item not found",
    );
  });

  it("locks the owned item before reading its balance and reconciles to the latest count", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    service = createInventoryService(context.db);
    const item = await service.createItem(OWNER_ID, {
      name: "Lockable flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "bag",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await service.recordCount(OWNER_ID, item.id, "750", new Date("2026-08-21"));

    queries.length = 0;
    await service.recordCount(OWNER_ID, item.id, "700", new Date("2026-08-22"));

    const itemLockIndex = queries.findIndex(
      (query) =>
        query.includes('from "inventory_items"') && query.includes("for update"),
    );
    const balanceIndex = queries.findIndex((query) =>
      query.includes('from "inventory_movements"'),
    );
    expect(itemLockIndex).toBeGreaterThanOrEqual(0);
    expect(balanceIndex).toBeGreaterThan(itemLockIndex);
    expect((await service.getItemDetail(OWNER_ID, item.id)).stockBalance).toBe("700");
  });

  it("does not allow another owner to attach a price", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "Cream cheese",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ก้อน 250 g",
      baseQuantityPerPurchasePack: "250",
      minimumStockQuantity: "0",
    });

    await expect(
      service.addPrice(OTHER_OWNER_ID, item.id, {
        packPriceSatang: 12900,
        packBaseQuantity: "250",
        effectiveAt: new Date("2026-08-22"),
      }),
    ).rejects.toThrow("Inventory item not found");
  });

  it("rejects invalid pack and physical-count quantities", async () => {
    await expect(
      service.createItem(OWNER_ID, {
        name: "Invalid pack",
        category: "INGREDIENT",
        baseUnit: "g",
        purchaseUnitLabel: "ถุง",
        baseQuantityPerPurchasePack: "0",
        minimumStockQuantity: "0",
      }),
    ).rejects.toThrow("Invalid inventory item");

    const item = await service.createItem(OWNER_ID, {
      name: "Valid pack",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await expect(
      service.recordCount(OWNER_ID, item.id, "-1", new Date("2026-08-22")),
    ).rejects.toThrow("Invalid physical count");
  });

  it("loads inventory list details with one batched select per table", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    service = createInventoryService(context.db);

    const flour = await service.createItem(OWNER_ID, {
      name: "Flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "bag",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "100",
    });
    const box = await service.createItem(OWNER_ID, {
      name: "Box",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "pack",
      baseQuantityPerPurchasePack: "50",
      minimumStockQuantity: "10",
    });
    await service.addPrice(OWNER_ID, flour.id, {
      packPriceSatang: 5000,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2020-01-01T00:00:00Z"),
    });
    await service.addPrice(OWNER_ID, flour.id, {
      packPriceSatang: 7000,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2999-01-01T00:00:00Z"),
    });
    await service.recordCount(OWNER_ID, flour.id, "750", new Date("2020-01-02"));
    await service.recordCount(OWNER_ID, box.id, "20", new Date("2020-01-02"));

    queries.length = 0;
    const items = await service.listItems(OWNER_ID);

    expect(items.map((item) => item.name)).toEqual(["Box", "Flour"]);
    expect(items.find((item) => item.id === flour.id)).toMatchObject({
      stockBalance: "750",
      latestPrice: { packPriceSatang: 5000 },
    });
    expect(items.find((item) => item.id === flour.id)?.priceHistory).toHaveLength(2);
    expect(items.find((item) => item.id === box.id)).toMatchObject({
      stockBalance: "20",
      latestPrice: null,
      priceHistory: [],
    });

    const selects = queries.filter((query) => query.startsWith("select"));
    expect(selects).toHaveLength(3);
    expect(selects.filter((query) => query.includes('from "inventory_items"'))).toHaveLength(1);
    expect(selects.filter((query) => query.includes('from "inventory_movements"'))).toHaveLength(1);
    expect(selects.filter((query) => query.includes('from "inventory_prices"'))).toHaveLength(1);
  });

  it("loads catalog items with one select and no detail fan-out", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    service = createInventoryService(context.db);
    await service.createItem(OWNER_ID, {
      name: "Flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "bag",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await service.createItem(OWNER_ID, {
      name: "Box",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "pack",
      baseQuantityPerPurchasePack: "50",
      minimumStockQuantity: "0",
    });

    queries.length = 0;
    const items = await service.listCatalogItems(OWNER_ID);

    expect(items.map((item) => item.name)).toEqual(["Box", "Flour"]);
    const selects = queries.filter((query) => query.startsWith("select"));
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('from "inventory_items"');
  });
});
