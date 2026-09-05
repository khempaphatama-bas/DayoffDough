import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import {
  cycleInventoryCounts,
  cycleShoppingItems,
} from "@/modules/shopping/db/schema";
import {
  createShoppingCommandService,
  ShoppingStateError,
  ShoppingValidationError,
} from "./shopping-commands";

const CLOCK = { now: () => new Date("2026-08-23T03:00:00.000Z") };
const COUNTED_AT = new Date("2026-08-23T04:00:00.000Z");
const CONFIRMATION_REQUEST_ID = "54000000-0000-4000-8000-000000000001";
const SECOND_CONFIRMATION_REQUEST_ID = "54000000-0000-4000-8000-000000000002";
const OTHER_ITEM_ID = "64000000-0000-4000-8000-000000000001";

type Context = Awaited<ReturnType<typeof createTestDatabase>>;
type Fixture = Awaited<ReturnType<typeof seedLockedPlanningScenario>>;

function confirmInput(fixture: Fixture, overrides: Partial<{
  confirmationRequestId: string;
  counts: Array<{ inventoryItemId: string; countedQuantity: string }>;
  cycleId: string;
  planningSnapshotId: string;
}> = {}) {
  return {
    cycleId: overrides.cycleId ?? fixture.cycleId,
    planningSnapshotId: overrides.planningSnapshotId ?? fixture.planningSnapshotId,
    confirmationRequestId:
      overrides.confirmationRequestId ?? CONFIRMATION_REQUEST_ID,
    countedAt: COUNTED_AT,
    counts: overrides.counts ?? [
      { inventoryItemId: fixture.ingredientItemId, countedQuantity: "1000" },
      { inventoryItemId: fixture.packagingItemId, countedQuantity: "14" },
    ],
  };
}

async function persistedRows(db: Context["db"]) {
  const countMovements = await db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.type, "COUNT"));
  const persistedCounts = await db.select().from(cycleInventoryCounts);
  const shoppingRows = await db.select().from(cycleShoppingItems);
  return { countMovements, persistedCounts, shoppingRows };
}

describe("shopping command service", () => {
  let context: Context;

  beforeEach(async () => {
    context = await createTestDatabase();
  }, 30_000);

  afterEach(async () => context.close(), 30_000);

  it("locks owned inventory items in deterministic ID order and omits another owner's item", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await context.db.insert(inventoryItems).values({
      id: OTHER_ITEM_ID,
      ownerId: OTHER_OWNER_ID,
      name: "ของร้านอื่น",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000",
    });

    const locked = await lockOwnedInventoryItems(context.db, OWNER_ID, [
      fixture.packagingItemId,
      OTHER_ITEM_ID,
      fixture.ingredientItemId,
      fixture.packagingItemId,
    ]);

    expect(locked.map((item) => item.id)).toEqual(
      [fixture.ingredientItemId, fixture.packagingItemId].sort(),
    );
  });

  it("creates count movements, immutable counts, and only recommendations with a shortfall", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);

    const view = await service.confirmStock(OWNER_ID, confirmInput(fixture));
    const { countMovements, persistedCounts, shoppingRows } = await persistedRows(context.db);

    expect(view.kind).toBe("SHOPPING");
    expect(countMovements).toHaveLength(2);
    expect(persistedCounts).toHaveLength(2);
    expect(shoppingRows).toHaveLength(1);
    expect(countMovements.map((row) => row.quantityDeltaInBaseUnit.toString()).sort()).toEqual([
      "1000.000000",
      "14.000000",
    ]);
    expect(shoppingRows[0]).toMatchObject({
      inventoryItemId: fixture.ingredientItemId,
      shortfallQuantity: "1200.000000",
      suggestedPackCount: 2,
      suggestedPurchaseQuantity: "2000.000000",
      estimatedCostSatang: 11000,
    });
  });

  it("uses the balance refreshed inside the transaction and ignores minimum stock", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await context.db.insert(inventoryMovements).values({
      ownerId: OWNER_ID,
      inventoryItemId: fixture.ingredientItemId,
      type: "CORRECTION",
      quantityDeltaInBaseUnit: "900",
      occurredAt: COUNTED_AT,
    });
    await context.db
      .update(inventoryItems)
      .set({ minimumStockQuantity: "999999" })
      .where(eq(inventoryItems.id, fixture.packagingItemId));

    await createShoppingCommandService(context.db, CLOCK).confirmStock(
      OWNER_ID,
      confirmInput(fixture),
    );
    const { countMovements, persistedCounts, shoppingRows } = await persistedRows(context.db);

    expect(countMovements.find((row) => row.inventoryItemId === fixture.ingredientItemId))
      .toMatchObject({ quantityDeltaInBaseUnit: "100.000000" });
    expect(persistedCounts.find((row) => row.inventoryItemId === fixture.ingredientItemId))
      .toMatchObject({ systemBalanceBeforeCount: "900.000000", countDeltaQuantity: "100.000000" });
    expect(shoppingRows).toHaveLength(1);
    expect(shoppingRows[0]).toMatchObject({ inventoryItemId: fixture.ingredientItemId });
  });

  it("returns the existing view for an identical retry and rejects a different canonical count set", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);
    const input = confirmInput(fixture);

    const first = await service.confirmStock(OWNER_ID, input);
    const repeated = await service.confirmStock(OWNER_ID, {
      ...input,
      confirmationRequestId: SECOND_CONFIRMATION_REQUEST_ID,
      counts: [...input.counts].reverse(),
    });

    expect(repeated).toEqual(first);
    await expect(
      service.confirmStock(OWNER_ID, confirmInput(fixture, {
        confirmationRequestId: SECOND_CONFIRMATION_REQUEST_ID,
        counts: [
          { inventoryItemId: fixture.ingredientItemId, countedQuantity: "1001" },
          { inventoryItemId: fixture.packagingItemId, countedQuantity: "4" },
        ],
      })),
    ).rejects.toBeInstanceOf(ShoppingValidationError);
    expect((await persistedRows(context.db)).countMovements).toHaveLength(2);
  });

  it("returns an identical retry before reading inventory profiles changed after confirmation", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);
    const input = confirmInput(fixture);
    const first = await service.confirmStock(OWNER_ID, input);
    await context.db.execute(sql`set session_replication_role = replica`);
    try {
      await context.db.delete(inventoryItems).where(
        and(
          eq(inventoryItems.ownerId, OWNER_ID),
          eq(inventoryItems.id, fixture.ingredientItemId),
        ),
      );
    } finally {
      await context.db.execute(sql`set session_replication_role = origin`);
    }

    await expect(
      service.confirmStock(OWNER_ID, {
        ...input,
        confirmationRequestId: SECOND_CONFIRMATION_REQUEST_ID,
      }),
    ).resolves.toEqual(first);
  });

  it("rejects missing, extra, and duplicate count IDs without writes", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);
    const invalidInputs = [
      confirmInput(fixture, {
        counts: [{ inventoryItemId: fixture.ingredientItemId, countedQuantity: "1000" }],
      }),
      confirmInput(fixture, {
        counts: [
          { inventoryItemId: fixture.ingredientItemId, countedQuantity: "1000" },
          { inventoryItemId: fixture.packagingItemId, countedQuantity: "4" },
          { inventoryItemId: OTHER_ITEM_ID, countedQuantity: "1" },
        ],
      }),
      confirmInput(fixture, {
        counts: [
          { inventoryItemId: fixture.ingredientItemId, countedQuantity: "1000" },
          { inventoryItemId: fixture.ingredientItemId, countedQuantity: "1000" },
          { inventoryItemId: fixture.packagingItemId, countedQuantity: "4" },
        ],
      }),
    ];

    for (const input of invalidInputs) {
      await expect(service.confirmStock(OWNER_ID, input)).rejects.toBeInstanceOf(
        ShoppingValidationError,
      );
      expect(await persistedRows(context.db)).toEqual({
        countMovements: [],
        persistedCounts: [],
        shoppingRows: [],
      });
    }
  });

  it("rejects ownership, snapshot, and non-writable cycle lifecycle mismatches", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);

    await expect(service.confirmStock(OTHER_OWNER_ID, confirmInput(fixture))).rejects.toBeInstanceOf(ShoppingStateError);
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture, {
      cycleId: "74000000-0000-4000-8000-000000000002",
    }))).rejects.toBeInstanceOf(ShoppingStateError);
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture, {
      planningSnapshotId: "74000000-0000-4000-8000-000000000001",
    }))).rejects.toBeInstanceOf(ShoppingStateError);

    for (const status of ["OPEN", "COMPLETED", "CANCELLED"] as const) {
      await context.db.update(bakeCycles).set({ status }).where(eq(bakeCycles.id, fixture.cycleId));
      await expect(service.confirmStock(OWNER_ID, confirmInput(fixture))).rejects.toBeInstanceOf(ShoppingStateError);
    }
    await context.db.update(bakeCycles).set({ status: "IN_PRODUCTION" }).where(eq(bakeCycles.id, fixture.cycleId));
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture))).resolves.toMatchObject({ kind: "SHOPPING" });
    await context.db.update(cyclePlanningSnapshots).set({
      status: "SUPERSEDED",
      unlockedAt: CLOCK.now(),
      unlockReason: "ปรับรอบ",
      unlockedFromStatus: "LOCKED",
    }).where(eq(cyclePlanningSnapshots.id, fixture.planningSnapshotId));
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture))).rejects.toBeInstanceOf(ShoppingStateError);
  });

  it("rolls back movements, counts, and shopping rows when a late insert fails", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await context.db.execute(sql`
      CREATE FUNCTION fail_cycle_shopping_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced shopping rollback'; END;
      $$ LANGUAGE plpgsql
    `);
    await context.db.execute(sql`
      CREATE TRIGGER force_cycle_shopping_failure
      BEFORE INSERT ON cycle_shopping_items
      FOR EACH ROW EXECUTE FUNCTION fail_cycle_shopping_insert()
    `);

    await expect(
      createShoppingCommandService(context.db, CLOCK).confirmStock(
        OWNER_ID,
        confirmInput(fixture),
      ),
    ).rejects.toThrow();
    expect(await persistedRows(context.db)).toEqual({
      countMovements: [],
      persistedCounts: [],
      shoppingRows: [],
    });
  });

  it("allows two concurrent confirmations to create exactly one count set", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);
    const [first, second] = await Promise.all([
      service.confirmStock(OWNER_ID, confirmInput(fixture)),
      service.confirmStock(OWNER_ID, confirmInput(fixture, {
        confirmationRequestId: SECOND_CONFIRMATION_REQUEST_ID,
      })),
    ]);

    expect(first).toEqual(second);
    const { countMovements, persistedCounts, shoppingRows } = await persistedRows(context.db);
    expect(countMovements).toHaveLength(2);
    expect(persistedCounts).toHaveLength(2);
    expect(shoppingRows).toHaveLength(1);
  });
});
