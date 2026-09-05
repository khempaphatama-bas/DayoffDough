import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
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
const PURCHASED_AT_1 = new Date("2026-08-29T02:00:00.000Z");
const PURCHASED_AT_2 = new Date("2026-08-29T03:00:00.000Z");
const LOCK_REQUEST_ID = "51000000-0000-4000-8000-000000000001";
const CONFIRMATION_REQUEST_ID = "51000000-0000-4000-8000-000000000002";
const PURCHASE_REQUEST_1 = "51000000-0000-4000-8000-000000000003";
const PURCHASE_REQUEST_2 = "51000000-0000-4000-8000-000000000004";

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

  const systemBalanceBeforeCount = (
    Number(quantities.countedQuantity) - Number(quantities.countDeltaQuantity)
  ).toString();
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
      systemBalanceBeforeCount,
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

  const occurredAt =
    purchase.purchaseRequestId === PURCHASE_REQUEST_1
      ? PURCHASED_AT_1
      : PURCHASED_AT_2;
  const [movement] = await db
    .insert(inventoryMovements)
    .values({
      ownerId: shopping.ownerId,
      inventoryItemId: shopping.inventoryItemId,
      type: "PURCHASE",
      quantityDeltaInBaseUnit: purchase.purchasedQuantity,
      referenceType: "CYCLE_PURCHASE_ENTRY",
      occurredAt,
    })
    .returning();
  const [price] = await db
    .insert(inventoryPrices)
    .values({
      ownerId: shopping.ownerId,
      inventoryItemId: shopping.inventoryItemId,
      packPriceSatang: purchase.totalPriceSatang,
      packBaseQuantity: purchase.purchasedQuantity,
      effectiveAt: occurredAt,
    })
    .returning();
  if (!movement || !price) throw new Error("Purchase source insert failed");

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
      occurredAt,
      inventoryMovementId: movement.id,
      inventoryPriceId: price.id,
    })
    .returning();
  if (!entry) throw new Error("Cycle purchase entry insert failed");
  return entry;
}

describe("Phase 3B shopping schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("stores one count and multiple purchases for the same shopping item", async () => {
    const fixture = await seedLockedPlanningFixture(context.db);
    const count = await insertCycleCount(context.db, fixture, {
      requiredQuantity: "2200",
      countedQuantity: "1000",
      countDeltaQuantity: "1000",
    });
    const shopping = await insertShoppingItem(context.db, count, {
      shortfallQuantity: "1200",
      suggestedPackCount: 2,
      suggestedPurchaseQuantity: "2000",
    });

    await insertPurchase(context.db, shopping, {
      purchaseRequestId: PURCHASE_REQUEST_1,
      packCount: 1,
      purchasedQuantity: "1000",
      totalPriceSatang: 5500,
    });
    await insertPurchase(context.db, shopping, {
      purchaseRequestId: PURCHASE_REQUEST_2,
      packCount: 1,
      purchasedQuantity: "1000",
      totalPriceSatang: 0,
    });

    const rows = await context.db
      .select()
      .from(cyclePurchaseEntries)
      .orderBy(asc(cyclePurchaseEntries.occurredAt));
    expect(rows).toHaveLength(2);
    expect(shopping.estimatedCostSatang).toBeNull();
    expect(rows[1]?.totalPriceSatang).toBe(0);
    expect(rows.reduce((total, row) => total + Number(row.purchasedQuantity), 0))
      .toBeGreaterThan(Number(shopping.shortfallQuantity));
  });
});
