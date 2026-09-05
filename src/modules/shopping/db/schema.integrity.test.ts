import { and, eq, sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";
import {
  inventoryItems,
  inventoryMovements,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import {
  createPlanningCommandService,
} from "@/modules/planning/application/planning-commands";
import {
  createPlanningQueryService,
} from "@/modules/planning/application/planning-queries";
import { cycleInventoryPriceSnapshots } from "@/modules/planning/db/schema";
import {
  cycleInventoryCounts,
  cyclePurchaseEntries,
  cycleShoppingItems,
} from "./schema";

const LOCKED_AT = new Date("2026-08-29T00:00:00.000Z");
const COUNTED_AT = new Date("2026-08-29T01:00:00.000Z");
const PURCHASED_AT = new Date("2026-08-29T02:00:00.000Z");
const LOCK_REQUEST_ID = "52000000-0000-4000-8000-000000000001";
const RELOCK_REQUEST_ID = "52000000-0000-4000-8000-000000000002";
const CONFIRMATION_REQUEST_ID = "52000000-0000-4000-8000-000000000003";
const PURCHASE_REQUEST_ID = "52000000-0000-4000-8000-000000000004";
const OTHER_PURCHASE_REQUEST_ID = "52000000-0000-4000-8000-000000000005";

type SchemaFixture = Readonly<{
  cycleId: string;
  planningSnapshotId: string;
  inventoryItemId: string;
  priceSnapshotId: string;
}>;

async function seedLockedPlanningFixture(
  db: DatabaseClient,
): Promise<SchemaFixture> {
  const scenario = await seedPlanningScenario(db);
  const clock = { now: () => new Date(LOCKED_AT) };
  const preview = await createPlanningQueryService(db, clock).preview(
    OWNER_ID,
    scenario.cycleId,
  );
  const locked = await createPlanningCommandService(db, clock).lock(OWNER_ID, {
    cycleId: scenario.cycleId,
    inputFingerprint: preview.inputFingerprint,
    lockRequestId: LOCK_REQUEST_ID,
    overrides: [],
  });
  const [priceSnapshot] = await db
    .select({ id: cycleInventoryPriceSnapshots.id })
    .from(cycleInventoryPriceSnapshots)
    .where(
      and(
        eq(cycleInventoryPriceSnapshots.ownerId, OWNER_ID),
        eq(cycleInventoryPriceSnapshots.planningSnapshotId, locked.id),
        eq(
          cycleInventoryPriceSnapshots.inventoryItemId,
          scenario.ingredientItemId,
        ),
      ),
    )
    .limit(1);
  if (!priceSnapshot) throw new Error("Locked planning price snapshot missing");

  return {
    cycleId: scenario.cycleId,
    planningSnapshotId: locked.id,
    inventoryItemId: scenario.ingredientItemId,
    priceSnapshotId: priceSnapshot.id,
  };
}

async function insertCycleCount(
  db: DatabaseClient,
  fixture: SchemaFixture,
  quantities: Readonly<{
    requiredQuantity: string;
    countedQuantity: string;
    countDeltaQuantity: string;
  }>,
): Promise<typeof cycleInventoryCounts.$inferSelect> {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.ownerId, OWNER_ID),
        eq(inventoryItems.id, fixture.inventoryItemId),
      ),
    )
    .limit(1);
  if (!item) throw new Error("Inventory item missing");

  const [movement] = await db
    .insert(inventoryMovements)
    .values({
      ownerId: OWNER_ID,
      inventoryItemId: fixture.inventoryItemId,
      type: "COUNT",
      quantityDeltaInBaseUnit: quantities.countDeltaQuantity,
      countedQuantityInBaseUnit: quantities.countedQuantity,
      referenceType: "CYCLE_INVENTORY_COUNT",
      occurredAt: COUNTED_AT,
    })
    .returning();
  if (!movement) throw new Error("Count movement insert failed");

  const [count] = await db
    .insert(cycleInventoryCounts)
    .values({
      ownerId: OWNER_ID,
      bakeCycleId: fixture.cycleId,
      planningSnapshotId: fixture.planningSnapshotId,
      inventoryItemId: fixture.inventoryItemId,
      priceSnapshotId: fixture.priceSnapshotId,
      inventoryItemName: item.name,
      inventoryCategory: item.category,
      baseUnit: item.baseUnit,
      requiredQuantity: quantities.requiredQuantity,
      systemBalanceBeforeCount: (
        Number(quantities.countedQuantity) -
        Number(quantities.countDeltaQuantity)
      ).toString(),
      countedQuantity: quantities.countedQuantity,
      countDeltaQuantity: quantities.countDeltaQuantity,
      purchaseUnitLabel: item.purchaseUnitLabel,
      baseQuantityPerPurchasePack: item.baseQuantityPerPurchasePack,
      countMovementId: movement.id,
      countedAt: COUNTED_AT,
      confirmationRequestId: CONFIRMATION_REQUEST_ID,
    })
    .returning();
  if (!count) throw new Error("Cycle inventory count insert failed");
  return count;
}

async function insertShoppingItem(
  db: DatabaseClient,
  count: typeof cycleInventoryCounts.$inferSelect,
  recommendation: Readonly<{
    shortfallQuantity: string;
    suggestedPackCount: number;
    suggestedPurchaseQuantity: string;
  }>,
): Promise<typeof cycleShoppingItems.$inferSelect> {
  const [shopping] = await db
    .insert(cycleShoppingItems)
    .values({
      ownerId: count.ownerId,
      bakeCycleId: count.bakeCycleId,
      planningSnapshotId: count.planningSnapshotId,
      inventoryCountId: count.id,
      inventoryItemId: count.inventoryItemId,
      shortfallQuantity: recommendation.shortfallQuantity,
      suggestedPackCount: recommendation.suggestedPackCount,
      suggestedPurchaseQuantity: recommendation.suggestedPurchaseQuantity,
      estimatedCostSatang: null,
    })
    .returning();
  if (!shopping) throw new Error("Cycle shopping item insert failed");
  return shopping;
}

async function createPurchaseSources(
  db: DatabaseClient,
  shopping: typeof cycleShoppingItems.$inferSelect,
  purchasedQuantity: string,
  totalPriceSatang: number,
  occurredAt: Date,
) {
  const [movement] = await db
    .insert(inventoryMovements)
    .values({
      ownerId: shopping.ownerId,
      inventoryItemId: shopping.inventoryItemId,
      type: "PURCHASE",
      quantityDeltaInBaseUnit: purchasedQuantity,
      referenceType: "CYCLE_PURCHASE_ENTRY",
      occurredAt,
    })
    .returning();
  const [price] = await db
    .insert(inventoryPrices)
    .values({
      ownerId: shopping.ownerId,
      inventoryItemId: shopping.inventoryItemId,
      packPriceSatang: totalPriceSatang,
      packBaseQuantity: purchasedQuantity,
      effectiveAt: occurredAt,
    })
    .returning();
  if (!movement || !price) throw new Error("Purchase source insert failed");
  return { movementId: movement.id, priceId: price.id };
}

async function insertPurchase(
  db: DatabaseClient,
  shopping: typeof cycleShoppingItems.$inferSelect,
  purchase: Readonly<{
    purchaseRequestId: string;
    packCount: number;
    purchasedQuantity: string;
    totalPriceSatang: number;
  }>,
): Promise<typeof cyclePurchaseEntries.$inferSelect> {
  const [count] = await db
    .select()
    .from(cycleInventoryCounts)
    .where(
      and(
        eq(cycleInventoryCounts.ownerId, shopping.ownerId),
        eq(cycleInventoryCounts.id, shopping.inventoryCountId),
      ),
    )
    .limit(1);
  if (!count) throw new Error("Cycle inventory count missing");
  const sources = await createPurchaseSources(
    db,
    shopping,
    purchase.purchasedQuantity,
    purchase.totalPriceSatang,
    PURCHASED_AT,
  );

  const [entry] = await db
    .insert(cyclePurchaseEntries)
    .values({
      ownerId: shopping.ownerId,
      bakeCycleId: shopping.bakeCycleId,
      planningSnapshotId: shopping.planningSnapshotId,
      shoppingItemId: shopping.id,
      inventoryItemId: shopping.inventoryItemId,
      purchaseRequestId: purchase.purchaseRequestId,
      packCount: purchase.packCount,
      packBaseQuantity: count.baseQuantityPerPurchasePack,
      purchasedQuantity: purchase.purchasedQuantity,
      totalPriceSatang: purchase.totalPriceSatang,
      occurredAt: PURCHASED_AT,
      inventoryMovementId: sources.movementId,
      inventoryPriceId: sources.priceId,
    })
    .returning();
  if (!entry) throw new Error("Cycle purchase entry insert failed");
  return entry;
}

async function seedValidRows(db: DatabaseClient) {
  const fixture = await seedLockedPlanningFixture(db);
  const count = await insertCycleCount(db, fixture, {
    requiredQuantity: "2200",
    countedQuantity: "1000",
    countDeltaQuantity: "1000",
  });
  const shopping = await insertShoppingItem(db, count, {
    shortfallQuantity: "1200",
    suggestedPackCount: 2,
    suggestedPurchaseQuantity: "2000",
  });
  const purchase = await insertPurchase(db, shopping, {
    purchaseRequestId: PURCHASE_REQUEST_ID,
    packCount: 1,
    purchasedQuantity: "1000",
    totalPriceSatang: 5500,
  });
  return { fixture, count, shopping, purchase };
}

async function queryRows<T>(db: DatabaseClient, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraint: string,
) {
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(Error);
  expect(
    (rejection as Error & { cause?: { constraint?: string } }).cause,
  ).toMatchObject({ constraint });
}

describe("Phase 3B shopping schema integrity", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("rejects a cycle count that crosses the owner boundary", async () => {
    const { count } = await seedValidRows(context.db);
    const { id: _id, createdAt: _createdAt, ...validCount } = count;

    await expect(
      context.db.insert(cycleInventoryCounts).values({
        ...validCount,
        ownerId: OTHER_OWNER_ID,
      }),
    ).rejects.toThrow();
  });

  it("rejects a purchase whose snapshot differs from its shopping item", async () => {
    const { fixture, shopping, purchase } = await seedValidRows(context.db);
    const commands = createPlanningCommandService(context.db, {
      now: () => new Date("2026-08-29T03:00:00.000Z"),
    });
    await commands.unlock(OWNER_ID, {
      cycleId: fixture.cycleId,
      reason: "สร้าง generation สำหรับทดสอบขอบเขต",
      confirmation: "ปลดล็อก",
    });
    const preview = await createPlanningQueryService(context.db, {
      now: () => new Date("2026-08-29T04:00:00.000Z"),
    }).preview(OWNER_ID, fixture.cycleId);
    const otherSnapshot = await createPlanningCommandService(context.db, {
      now: () => new Date("2026-08-29T04:00:00.000Z"),
    }).lock(OWNER_ID, {
      cycleId: fixture.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId: RELOCK_REQUEST_ID,
      overrides: [],
    });
    const sources = await createPurchaseSources(
      context.db,
      shopping,
      purchase.purchasedQuantity,
      purchase.totalPriceSatang,
      new Date("2026-08-29T05:00:00.000Z"),
    );
    const { id: _id, createdAt: _createdAt, ...validPurchase } = purchase;

    await expectConstraintViolation(
      () =>
        context.db.insert(cyclePurchaseEntries).values({
          ...validPurchase,
          planningSnapshotId: otherSnapshot.id,
          purchaseRequestId: OTHER_PURCHASE_REQUEST_ID,
          occurredAt: new Date("2026-08-29T05:00:00.000Z"),
          inventoryMovementId: sources.movementId,
          inventoryPriceId: sources.priceId,
        }),
      "cycle_purchase_entries_owned_shopping_item_fk",
    );
  });

  it("rejects a repeated owner-scoped purchase request", async () => {
    const { shopping, purchase } = await seedValidRows(context.db);
    const sources = await createPurchaseSources(
      context.db,
      shopping,
      purchase.purchasedQuantity,
      purchase.totalPriceSatang,
      new Date("2026-08-29T03:00:00.000Z"),
    );
    const { id: _id, createdAt: _createdAt, ...validPurchase } = purchase;

    await expectConstraintViolation(
      () =>
        context.db.insert(cyclePurchaseEntries).values({
          ...validPurchase,
          purchaseRequestId: validPurchase.purchaseRequestId,
          occurredAt: new Date("2026-08-29T03:00:00.000Z"),
          inventoryMovementId: sources.movementId,
          inventoryPriceId: sources.priceId,
        }),
      "cycle_purchase_entries_owner_request_unique",
    );
  });

  it("registers every named quantity and money check", async () => {
    const constraints = await queryRows<{ constraintName: string }>(
      context.db,
      sql`
        SELECT conname AS "constraintName"
        FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid IN (
            'cycle_inventory_counts'::regclass,
            'cycle_shopping_items'::regclass,
            'cycle_purchase_entries'::regclass
          )
        ORDER BY conname
      `,
    );

    expect(constraints.map((row) => row.constraintName)).toEqual([
      "cycle_inventory_counts_delta_matches",
      "cycle_inventory_counts_quantities_valid",
      "cycle_inventory_counts_required_category",
      "cycle_purchase_entries_quantities_valid",
      "cycle_purchase_entries_total_price_non_negative",
      "cycle_shopping_items_estimated_cost_non_negative",
      "cycle_shopping_items_quantities_valid",
    ]);
  });

  it("registers indexes for every owner-scoped list path", async () => {
    const indexes = await queryRows<{ indexName: string }>(
      context.db,
      sql`
        SELECT indexname AS "indexName"
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'cycle_inventory_counts_owner_cycle_snapshot_idx',
            'cycle_inventory_counts_owner_snapshot_item_unique',
            'cycle_shopping_items_owner_cycle_snapshot_idx',
            'cycle_shopping_items_owner_snapshot_item_unique',
            'cycle_purchase_entries_owner_cycle_snapshot_idx',
            'cycle_purchase_entries_owner_shopping_occurred_idx'
          )
        ORDER BY indexname
      `,
    );

    expect(indexes.map((row) => row.indexName)).toEqual([
      "cycle_inventory_counts_owner_cycle_snapshot_idx",
      "cycle_inventory_counts_owner_snapshot_item_unique",
      "cycle_purchase_entries_owner_cycle_snapshot_idx",
      "cycle_purchase_entries_owner_shopping_occurred_idx",
      "cycle_shopping_items_owner_cycle_snapshot_idx",
      "cycle_shopping_items_owner_snapshot_item_unique",
    ]);
  });

  it("enables RLS without Data API policies on all three tables", async () => {
    const classRows = await queryRows<{
      tableName: string;
      rowSecurity: boolean;
    }>(
      context.db,
      sql`
        SELECT relname AS "tableName", relrowsecurity AS "rowSecurity"
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN (
            'cycle_inventory_counts',
            'cycle_shopping_items',
            'cycle_purchase_entries'
          )
        ORDER BY relname
      `,
    );
    const tableRows = await queryRows<{
      tableName: string;
      rowSecurity: boolean;
    }>(
      context.db,
      sql`
        SELECT tablename AS "tableName", rowsecurity AS "rowSecurity"
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'cycle_inventory_counts',
            'cycle_shopping_items',
            'cycle_purchase_entries'
          )
        ORDER BY tablename
      `,
    );
    const policies = await queryRows<{ policyName: string }>(
      context.db,
      sql`
        SELECT policyname AS "policyName"
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'cycle_inventory_counts',
            'cycle_shopping_items',
            'cycle_purchase_entries'
          )
      `,
    );

    expect(classRows).toEqual([
      { tableName: "cycle_inventory_counts", rowSecurity: true },
      { tableName: "cycle_purchase_entries", rowSecurity: true },
      { tableName: "cycle_shopping_items", rowSecurity: true },
    ]);
    expect(tableRows).toEqual(classRows);
    expect(policies).toEqual([]);
  });
});
