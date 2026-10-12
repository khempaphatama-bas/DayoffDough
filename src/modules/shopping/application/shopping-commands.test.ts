import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { orderItems } from "@/modules/orders/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import {
  inventoryItems,
  inventoryMovements,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import {
  cycleMaterialRequirements,
  cyclePlanningSnapshots,
} from "@/modules/planning/db/schema";
import {
  cycleInventoryCounts,
  cyclePurchaseEntries,
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
const PURCHASE_1 = "55000000-0000-4000-8000-000000000001";
const PURCHASE_2 = "55000000-0000-4000-8000-000000000002";
const PURCHASE_3 = "55000000-0000-4000-8000-000000000003";
const PURCHASE_4 = "55000000-0000-4000-8000-000000000004";
const PURCHASE_5 = "55000000-0000-4000-8000-000000000005";
const POSTGRESQL_INTEGER_MAX = 2_147_483_647;
const PURCHASED_AT = new Date("2026-08-23T05:00:00.000Z");
const LATER_PURCHASED_AT = new Date("2026-08-23T06:00:00.000Z");

type Context = Awaited<ReturnType<typeof createTestDatabase>>;
type Fixture = Awaited<ReturnType<typeof seedLockedPlanningScenario>>;

async function completeOperations(db: Context["db"], fixture: Fixture) {
  const cycles = createCycleOperationsCommandService(db, CLOCK);
  const orders = createOrderOperationsCommandService(db, CLOCK);
  await cycles.startCycle(OWNER_ID, { cycleId: fixture.cycleId });
  await orders.startOrders(OWNER_ID, { cycleId: fixture.cycleId, orderIds: fixture.orderIds.slice(0, 2) });
  for (const orderId of fixture.orderIds.slice(0, 2)) {
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId!));
    await orders.setPackedQuantity(OWNER_ID, {
      cycleId: fixture.cycleId, orderItemId: item!.id,
      packedQuantity: item!.quantity, expectedPackedQuantity: 0,
    });
    await orders.confirmOrderPacked(OWNER_ID, { cycleId: fixture.cycleId, orderId: orderId! });
  }
  await orders.deliverOrders(OWNER_ID, { cycleId: fixture.cycleId, orderIds: fixture.orderIds.slice(0, 2) });
  const [generation] = await db.select().from(cycleTaskGenerations)
    .where(eq(cycleTaskGenerations.planningSnapshotId, fixture.planningSnapshotId));
  await db.update(cycleTasks).set({ status: "DONE" })
    .where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
  await cycles.completeCycle(OWNER_ID, {
    cycleId: fixture.cycleId, expectedTaskGenerationId: generation!.id, confirmation: true,
  });
}

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

async function shoppingItemForPurchase(
  db: Context["db"],
  fixture: Fixture,
  ownerId = OWNER_ID,
) {
  await createShoppingCommandService(db, CLOCK).confirmStock(
    ownerId,
    confirmInput(fixture),
  );
  const [shoppingItem] = await db
    .select()
    .from(cycleShoppingItems)
    .where(
      and(
        eq(cycleShoppingItems.ownerId, ownerId),
        eq(cycleShoppingItems.bakeCycleId, fixture.cycleId),
        eq(cycleShoppingItems.planningSnapshotId, fixture.planningSnapshotId),
      ),
    )
    .limit(1);
  if (!shoppingItem) throw new Error("Shopping fixture missing item");
  return shoppingItem;
}

function purchaseInput(
  fixture: Fixture,
  shoppingItemId: string,
  overrides: Partial<{
    cycleId: string;
    planningSnapshotId: string;
    shoppingItemId: string;
    purchaseRequestId: string;
    packCount: number;
    totalPriceSatang: number;
    purchasedFrom: string;
    occurredAt: Date;
    notes: string;
  }> = {},
) {
  return {
    cycleId: overrides.cycleId ?? fixture.cycleId,
    planningSnapshotId: overrides.planningSnapshotId ?? fixture.planningSnapshotId,
    shoppingItemId: overrides.shoppingItemId ?? shoppingItemId,
    purchaseRequestId: overrides.purchaseRequestId ?? PURCHASE_1,
    packCount: overrides.packCount ?? 1,
    totalPriceSatang: overrides.totalPriceSatang ?? 5_500,
    purchasedFrom: overrides.purchasedFrom ?? "ร้านวัตถุดิบ",
    occurredAt: overrides.occurredAt ?? PURCHASED_AT,
    notes: overrides.notes ?? "ซื้อเพิ่ม",
  };
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

  it("accepts the maximum numeric(18,6) counted quantity", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);

    await expect(
      createShoppingCommandService(context.db, CLOCK).confirmStock(
        OWNER_ID,
        confirmInput(fixture, {
          counts: [
            {
              inventoryItemId: fixture.ingredientItemId,
              countedQuantity: "999999999999.999999",
            },
            { inventoryItemId: fixture.packagingItemId, countedQuantity: "14" },
          ],
        }),
      ),
    ).resolves.toMatchObject({ kind: "SHOPPING" });
    expect(
      (await persistedRows(context.db)).persistedCounts.find(
        (row) => row.inventoryItemId === fixture.ingredientItemId,
      ),
    ).toMatchObject({ countedQuantity: "999999999999.999999" });
  });

  it("maps one-over counted input to validation without writing a count set", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);

    await expect(
      createShoppingCommandService(context.db, CLOCK).confirmStock(
        OWNER_ID,
        confirmInput(fixture, {
          counts: [
            {
              inventoryItemId: fixture.ingredientItemId,
              countedQuantity: "1000000000000",
            },
            { inventoryItemId: fixture.packagingItemId, countedQuantity: "14" },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ShoppingValidationError);
    expect(await persistedRows(context.db)).toEqual({
      countMovements: [],
      persistedCounts: [],
      shoppingRows: [],
    });
  });

  it("maps an oversized refreshed balance to state without writing a count set", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    await context.db.insert(inventoryMovements).values([
      {
        ownerId: OWNER_ID,
        inventoryItemId: fixture.ingredientItemId,
        type: "CORRECTION",
        quantityDeltaInBaseUnit: "999999999999.999999",
        occurredAt: COUNTED_AT,
      },
      {
        ownerId: OWNER_ID,
        inventoryItemId: fixture.ingredientItemId,
        type: "CORRECTION",
        quantityDeltaInBaseUnit: "0.000001",
        occurredAt: COUNTED_AT,
      },
    ]);

    await expect(
      createShoppingCommandService(context.db, CLOCK).confirmStock(
        OWNER_ID,
        confirmInput(fixture),
      ),
    ).rejects.toBeInstanceOf(ShoppingStateError);
    expect(await persistedRows(context.db)).toEqual({
      countMovements: [],
      persistedCounts: [],
      shoppingRows: [],
    });
  });

  it("maps oversized required and recommendation source values to state before writing", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const service = createShoppingCommandService(context.db, CLOCK);
    const [material] = await context.db
      .select()
      .from(cycleMaterialRequirements)
      .where(eq(cycleMaterialRequirements.inventoryItemId, fixture.ingredientItemId));
    if (!material) throw new Error("Material fixture missing");
    await context.db
      .update(cycleMaterialRequirements)
      .set({ plannedRequirement: "999999999999.999999" })
      .where(eq(cycleMaterialRequirements.inventoryItemId, fixture.ingredientItemId));
    await context.db.insert(cycleMaterialRequirements).values({
      ...material,
      id: undefined,
      plannedRequirement: "0.000001",
    });

    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture))).rejects.toBeInstanceOf(
      ShoppingStateError,
    );
    expect(await persistedRows(context.db)).toEqual({
      countMovements: [],
      persistedCounts: [],
      shoppingRows: [],
    });

    await context.db
      .update(cycleMaterialRequirements)
      .set({ plannedRequirement: "999999999999.999999" })
      .where(eq(cycleMaterialRequirements.inventoryItemId, fixture.ingredientItemId));
    await context.db
      .update(inventoryItems)
      .set({ baseQuantityPerPurchasePack: "600000000000" })
      .where(eq(inventoryItems.id, fixture.ingredientItemId));
    await expect(
      service.confirmStock(
        OWNER_ID,
        confirmInput(fixture, {
          counts: [
            { inventoryItemId: fixture.ingredientItemId, countedQuantity: "0" },
            { inventoryItemId: fixture.packagingItemId, countedQuantity: "14" },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ShoppingStateError);
    expect(await persistedRows(context.db)).toEqual({
      countMovements: [],
      persistedCounts: [],
      shoppingRows: [],
    });
  });

  it("uses the single grouped post-lock source balance read without per-item reloads", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    const fixture = await seedLockedPlanningScenario(context.db);
    queries.length = 0;

    await createShoppingCommandService(context.db, CLOCK).confirmStock(
      OWNER_ID,
      confirmInput(fixture),
    );

    const movementReadIndexes = queries
      .map((query, index) => ({ query, index }))
      .filter(({ query }) => query.includes('from "inventory_movements"'));
    const itemLockIndexes = queries
      .map((query, index) => ({ query, index }))
      .filter(
        ({ query }) =>
          query.includes('from "inventory_items"') && query.includes("for update"),
      )
      .map(({ index }) => index);
    expect(movementReadIndexes).toHaveLength(2);
    expect(movementReadIndexes.every(({ query }) =>
      query.includes('group by "inventory_movements"."inventory_item_id"'),
    )).toBe(true);
    expect(itemLockIndexes).toHaveLength(2);
    expect(movementReadIndexes[1]!.index).toBeGreaterThan(Math.max(...itemLockIndexes));
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

    await context.db.update(bakeCycles).set({ status: "OPEN" }).where(eq(bakeCycles.id, fixture.cycleId));
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture))).rejects.toBeInstanceOf(ShoppingStateError);
    await context.db.update(bakeCycles).set({ status: "LOCKED" }).where(eq(bakeCycles.id, fixture.cycleId));
    await createCycleOperationsCommandService(context.db, CLOCK).startCycle(OWNER_ID, { cycleId: fixture.cycleId });
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture))).resolves.toMatchObject({ kind: "SHOPPING" });
    await completeOperations(context.db, fixture);
    await expect(service.confirmStock(OWNER_ID, confirmInput(fixture, {
      confirmationRequestId: SECOND_CONFIRMATION_REQUEST_ID,
    }))).rejects.toBeInstanceOf(ShoppingStateError);
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

  it("records partial, complete, and overage purchase progress from copied pack quantities", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);

    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id)),
    ).resolves.toMatchObject({
      status: "PARTIAL",
      purchasedQuantity: "1000",
      remainingQuantity: "200",
      overageQuantity: "0",
    });
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        purchaseRequestId: PURCHASE_2,
        totalPriceSatang: 5_700,
        occurredAt: LATER_PURCHASED_AT,
      })),
    ).resolves.toMatchObject({
      status: "COMPLETE",
      purchasedQuantity: "2000",
      remainingQuantity: "0",
      overageQuantity: "800",
    });
  });

  it("records one linked purchase entry, movement, and actual-total price per idempotent request", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    const input = purchaseInput(fixture, shoppingItem.id);

    await service.recordPurchase(OWNER_ID, input);
    await expect(service.recordPurchase(OWNER_ID, input)).resolves.toMatchObject({
      status: "PARTIAL",
      purchasedQuantity: "1000",
    });

    const entries = await context.db.select().from(cyclePurchaseEntries);
    const movements = await context.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.type, "PURCHASE"));
    const prices = await context.db
      .select()
      .from(inventoryPrices)
      .where(eq(inventoryPrices.inventoryItemId, fixture.ingredientItemId));
    expect(entries).toHaveLength(1);
    expect(movements).toHaveLength(1);
    expect(prices.filter((price) => price.id === entries[0]!.inventoryPriceId)).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: "PURCHASE",
      quantityDeltaInBaseUnit: "1000.000000",
      referenceType: "CYCLE_PURCHASE_ENTRY",
      referenceId: entries[0]!.id,
    });
    expect(prices.find((price) => price.id === entries[0]!.inventoryPriceId)).toMatchObject({
      packPriceSatang: 5_500,
      packBaseQuantity: "1000.000000",
      purchasedFrom: "ร้านวัตถุดิบ",
      effectiveAt: PURCHASED_AT,
    });
  });

  it("rejects every mismatched payload field for an existing purchase request", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    const input = purchaseInput(fixture, shoppingItem.id);
    await service.recordPurchase(OWNER_ID, input);

    const mismatches = [
      { packCount: 2 },
      { totalPriceSatang: 5_501 },
      { occurredAt: LATER_PURCHASED_AT },
      { purchasedFrom: "ร้านอื่น" },
      { notes: "หมายเหตุอื่น" },
      { shoppingItemId: "65000000-0000-4000-8000-000000000001" },
      { planningSnapshotId: "65000000-0000-4000-8000-000000000002" },
    ];
    for (const mismatch of mismatches) {
      await expect(
        service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, mismatch)),
      ).rejects.toBeInstanceOf(ShoppingValidationError);
    }
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        cycleId: "65000000-0000-4000-8000-000000000003",
      })),
    ).rejects.toBeInstanceOf(ShoppingStateError);
    expect(await context.db.select().from(cyclePurchaseEntries)).toHaveLength(1);
  });

  it("accepts purchases while locked or in production, including zero price and post-complete overage", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    await service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
      packCount: 2,
      totalPriceSatang: 0,
    }));
    await createCycleOperationsCommandService(context.db, CLOCK).startCycle(OWNER_ID, { cycleId: fixture.cycleId });
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        purchaseRequestId: PURCHASE_2,
        totalPriceSatang: 5_700,
      })),
    ).resolves.toMatchObject({
      status: "COMPLETE",
      purchasedQuantity: "3000",
      overageQuantity: "1800",
    });
    const [zeroPrice] = await context.db
      .select()
      .from(inventoryPrices)
      .where(eq(inventoryPrices.packPriceSatang, 0));
    expect(zeroPrice).toMatchObject({ packBaseQuantity: "2000.000000" });
  });

  it("rejects OPEN, terminal or superseded lifecycle writes and owner/cycle/item isolation violations", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    await context.db.update(bakeCycles).set({ status: "OPEN" }).where(eq(bakeCycles.id, fixture.cycleId));
    await expect(service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id))).rejects.toBeInstanceOf(ShoppingStateError);
    await context.db.update(bakeCycles).set({ status: "LOCKED" }).where(eq(bakeCycles.id, fixture.cycleId));
    await context.db.update(cyclePlanningSnapshots).set({
      status: "SUPERSEDED",
      unlockedAt: CLOCK.now(),
      unlockReason: "ปรับรอบ",
      unlockedFromStatus: "LOCKED",
    }).where(eq(cyclePlanningSnapshots.id, fixture.planningSnapshotId));
    await expect(service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id))).rejects.toBeInstanceOf(ShoppingStateError);
    await context.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, fixture.cycleId));
    await expect(service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id))).rejects.toBeInstanceOf(ShoppingStateError);

    const isolated = await seedLockedPlanningScenario(context.db, {
      ownerId: OTHER_OWNER_ID,
      idSet: "SECONDARY",
    });
    const isolatedShoppingItem = await shoppingItemForPurchase(
      context.db,
      isolated,
      OTHER_OWNER_ID,
    );
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, isolatedShoppingItem.id)),
    ).rejects.toBeInstanceOf(ShoppingStateError);
    await expect(
      service.recordPurchase(OTHER_OWNER_ID, purchaseInput(isolated, shoppingItem.id)),
    ).rejects.toBeInstanceOf(ShoppingStateError);
    await expect(
      service.recordPurchase(OTHER_OWNER_ID, purchaseInput(isolated, "65000000-0000-4000-8000-000000000004")),
    ).rejects.toBeInstanceOf(ShoppingStateError);
    await expect(
      service.recordPurchase(OTHER_OWNER_ID, purchaseInput(isolated, isolatedShoppingItem.id, {
        cycleId: "65000000-0000-4000-8000-000000000005",
      })),
    ).rejects.toBeInstanceOf(ShoppingStateError);
  });

  it("rolls back a purchase movement and price when the entry insert fails", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    await context.db.execute(sql`
      CREATE FUNCTION fail_cycle_purchase_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced purchase rollback'; END;
      $$ LANGUAGE plpgsql
    `);
    await context.db.execute(sql`
      CREATE TRIGGER force_cycle_purchase_failure
      BEFORE INSERT ON cycle_purchase_entries
      FOR EACH ROW EXECUTE FUNCTION fail_cycle_purchase_insert()
    `);

    await expect(
      createShoppingCommandService(context.db, CLOCK).recordPurchase(
        OWNER_ID,
        purchaseInput(fixture, shoppingItem.id),
      ),
    ).rejects.toThrow();
    expect(await context.db.select().from(cyclePurchaseEntries)).toEqual([]);
    expect(await context.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.type, "PURCHASE"))).toEqual([]);
    expect((await context.db
      .select()
      .from(inventoryPrices)
      .where(eq(inventoryPrices.inventoryItemId, fixture.ingredientItemId))).filter(
      (price) => price.effectiveAt.getTime() === PURCHASED_AT.getTime(),
    )).toEqual([]);
  });

  it("serializes concurrent identical purchase requests into one ledger event", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    const input = purchaseInput(fixture, shoppingItem.id, {
      purchaseRequestId: PURCHASE_5,
    });

    const [first, second] = await Promise.all([
      service.recordPurchase(OWNER_ID, input),
      service.recordPurchase(OWNER_ID, input),
    ]);
    expect(first).toEqual(second);
    expect(await context.db.select().from(cyclePurchaseEntries)).toHaveLength(1);
    expect(await context.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.type, "PURCHASE"))).toHaveLength(1);
  });

  it("recovers only Drizzle-wrapped request-id conflicts and preserves payload mismatch validation", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    const input = purchaseInput(fixture, shoppingItem.id);
    await service.recordPurchase(OWNER_ID, input);
    const wrappedRequestConflict = Object.assign(new Error("Failed query"), {
      cause: {
        code: "23505",
        constraint: "cycle_purchase_entries_owner_request_unique",
      },
    });
    const postgresJsRequestConflict = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("postgres error"), {
        cause: {
          code: "23505",
          constraint_name: "cycle_purchase_entries_owner_request_unique",
        },
      }),
    });
    const transactionSpy = vi.spyOn(context.db, "transaction");
    transactionSpy.mockImplementationOnce(async () => {
      throw wrappedRequestConflict;
    });
    await expect(service.recordPurchase(OWNER_ID, input)).resolves.toMatchObject({
      status: "PARTIAL",
      purchasedQuantity: "1000",
    });

    transactionSpy.mockImplementationOnce(async () => {
      throw postgresJsRequestConflict;
    });
    await expect(service.recordPurchase(OWNER_ID, input)).resolves.toMatchObject({
      status: "PARTIAL",
      purchasedQuantity: "1000",
    });

    transactionSpy.mockImplementationOnce(async () => {
      throw postgresJsRequestConflict;
    });
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        totalPriceSatang: 5_501,
      })),
    ).rejects.toBeInstanceOf(ShoppingValidationError);
    transactionSpy.mockRestore();
  });

  it("rethrows unrelated and cyclic wrapped database errors unchanged", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    const unrelatedUnique = Object.assign(new Error("Failed query"), {
      cause: {
        code: "23505",
        constraint: "cycle_purchase_entries_owner_movement_unique",
      },
    });
    const cyclicCause = Object.assign(new Error("Failed query"), {
      code: "23503",
    }) as Error & { cause?: unknown };
    cyclicCause.cause = cyclicCause;
    const transactionSpy = vi.spyOn(context.db, "transaction");
    transactionSpy.mockImplementationOnce(async () => {
      throw unrelatedUnique;
    });
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id)),
    ).rejects.toBe(unrelatedUnique);
    transactionSpy.mockImplementationOnce(async () => {
      throw cyclicCause;
    });
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id)),
    ).rejects.toBe(cyclicCause);
    transactionSpy.mockRestore();
  });

  it("accepts persistence maxima for pack count, total price, and computed quantity", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    await context.db
      .update(cycleInventoryCounts)
      .set({ baseQuantityPerPurchasePack: "0.000001" })
      .where(eq(cycleInventoryCounts.id, shoppingItem.inventoryCountId));
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        purchaseRequestId: PURCHASE_2,
        packCount: POSTGRESQL_INTEGER_MAX,
      })),
    ).resolves.toMatchObject({ purchasedQuantity: "2147.483647" });
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        purchaseRequestId: PURCHASE_3,
        totalPriceSatang: POSTGRESQL_INTEGER_MAX,
      })),
    ).resolves.toMatchObject({ status: "COMPLETE" });
    await context.db
      .update(cycleInventoryCounts)
      .set({ baseQuantityPerPurchasePack: "999999999999" })
      .where(eq(cycleInventoryCounts.id, shoppingItem.inventoryCountId));
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        purchaseRequestId: PURCHASE_4,
      })),
    ).resolves.toMatchObject({ status: "COMPLETE" });
    const [maximumQuantityEntry] = await context.db
      .select()
      .from(cyclePurchaseEntries)
      .where(eq(cyclePurchaseEntries.purchaseRequestId, PURCHASE_4));
    expect(maximumQuantityEntry).toMatchObject({
      purchasedQuantity: "999999999999.000000",
    });
  });

  it("rejects one-overflow persisted integer and quantity values before ledger inserts", async () => {
    const fixture = await seedLockedPlanningScenario(context.db);
    const shoppingItem = await shoppingItemForPurchase(context.db, fixture);
    const service = createShoppingCommandService(context.db, CLOCK);
    const invalidInputs = [
      purchaseInput(fixture, shoppingItem.id, {
        packCount: POSTGRESQL_INTEGER_MAX + 1,
      }),
      purchaseInput(fixture, shoppingItem.id, {
        totalPriceSatang: POSTGRESQL_INTEGER_MAX + 1,
      }),
    ];
    for (const input of invalidInputs) {
      await expect(service.recordPurchase(OWNER_ID, input)).rejects.toBeInstanceOf(
        ShoppingValidationError,
      );
    }
    await context.db
      .update(cycleInventoryCounts)
      .set({ baseQuantityPerPurchasePack: "500000000000" })
      .where(eq(cycleInventoryCounts.id, shoppingItem.inventoryCountId));
    await expect(
      service.recordPurchase(OWNER_ID, purchaseInput(fixture, shoppingItem.id, {
        purchaseRequestId: PURCHASE_2,
        packCount: 2,
      })),
    ).rejects.toBeInstanceOf(ShoppingValidationError);
    expect(await context.db.select().from(cyclePurchaseEntries)).toEqual([]);
    expect(await context.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.type, "PURCHASE"))).toEqual([]);
  });
});
