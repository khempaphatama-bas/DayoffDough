import { sql } from "drizzle-orm";
import { confirmConsumptionStock } from "@tests/fixtures/consumption";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";
import { OWNER_ID as PLANNING_OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { createOrderOperationsCommandService } from "@/modules/operations/application/order-commands";
import { bakeCycles } from "@/modules/cycles/db/schema";

const OWNER_ID = "71000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "71000000-0000-4000-8000-000000000002";
const CUSTOMER_ID = "72000000-0000-4000-8000-000000000001";
const CYCLE_ID = "73000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "74000000-0000-4000-8000-000000000001";
const ORDER_ID = "75000000-0000-4000-8000-000000000001";
const ITEM_ID = "76000000-0000-4000-8000-000000000001";
const SECOND_ITEM_ID = "76000000-0000-4000-8000-000000000002";
const MISSING_ITEM_ID = "76000000-0000-4000-8000-000000000099";

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

async function expectTriggerRejection(operation: () => Promise<unknown>, marker: string) {
  let rejection: unknown;
  try { await operation(); } catch (error) { rejection = error; }
  expect(rejection).toBeInstanceOf(Error);
  expect((rejection as Error & { cause?: Error }).cause?.message).toContain(marker);
}

async function seedLegacyPackingRows(
  db: DatabaseClient,
  options: Readonly<{
    cycleStatus?: "LOCKED" | "IN_PRODUCTION";
    orderStatus?: "CONFIRMED" | "IN_PRODUCTION" | "PACKED";
    itemActive?: boolean;
  }> = {},
) {
  const cycleStatus = options.cycleStatus ?? "IN_PRODUCTION";
  const orderStatus = options.orderStatus ?? "IN_PRODUCTION";
  const itemActive = options.itemActive ?? true;

  await db.execute(sql`
    INSERT INTO customers (id, owner_id, name)
    VALUES (${CUSTOMER_ID}, ${OWNER_ID}, 'Packing customer')
  `);
  await db.execute(sql`
    INSERT INTO bake_cycles (
      id, owner_id, name, status,
      target_production_date, primary_delivery_date
    ) VALUES (
      ${CYCLE_ID}, ${OWNER_ID}, 'Packing cycle', ${cycleStatus},
      '2026-09-26', '2026-09-27'
    )
  `);
  await db.execute(sql`
    INSERT INTO products (
      id, owner_id, name, selling_unit, default_unit_price_satang
    ) VALUES (${PRODUCT_ID}, ${OWNER_ID}, 'Packing loaf', 'piece', 12000)
  `);
  await db.execute(sql`
    INSERT INTO orders (
      id, owner_id, customer_id, bake_cycle_id, fulfillment_status
    ) VALUES (
      ${ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, ${orderStatus}
    )
  `);
  await db.execute(sql`
    INSERT INTO order_items (
      id, owner_id, order_id, product_id, quantity,
      unit_price_satang, position, active
    ) VALUES (
      ${ITEM_ID}, ${OWNER_ID}, ${ORDER_ID}, ${PRODUCT_ID}, 4,
      12000, 0, ${itemActive}
    )
  `);
}

async function insertProgress(
  db: DatabaseClient,
  options: Readonly<{
    ownerId?: string;
    orderItemId?: string;
    packedQuantity?: number;
  }> = {},
) {
  return db.execute(sql`
    INSERT INTO order_item_packing_progress (
      owner_id, order_item_id, packed_quantity
    ) VALUES (
      ${options.ownerId ?? OWNER_ID},
      ${options.orderItemId ?? ITEM_ID},
      ${options.packedQuantity ?? 1}
    )
  `);
}

describe("Phase 4B packing integrity", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  async function seedPackingFixture(_db: DatabaseClient, options: Parameters<typeof seedLegacyPackingRows>[1] = {}) {
    await context.close();
    context = await createTestDatabase({ beforeConsumptionCutover: (db) => seedLegacyPackingRows(db, options) });
  }

  beforeEach(async () => {
    context = await createTestDatabase();
    const tableResult = await context.db.execute(sql`
      SELECT to_regclass('public.order_item_packing_progress')::text
        AS "tableName"
    `);
    const table = (
      tableResult as unknown as { rows: { tableName: string | null }[] }
    ).rows;
    expect(table).toEqual([
      { tableName: "order_item_packing_progress" },
    ]);
  });

  afterEach(async () => context.close());

  it("rejects direct fulfillment jumps", async () => {
    await seedPackingFixture(context.db, { orderStatus: "CONFIRMED" });
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE orders SET fulfillment_status = 'PACKED' WHERE id = ${ORDER_ID}
    `), "order fulfillment transition not allowed");
  });

  it("rejects packing while an active item is incomplete", async () => {
    await seedPackingFixture(context.db);
    await insertProgress(context.db, { packedQuantity: 1 });
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE orders SET fulfillment_status = 'PACKED' WHERE id = ${ORDER_ID}
    `), "order packing incomplete");
  });

  it("rejects direct delivery of an order that was never packed", async () => {
    await seedPackingFixture(context.db);
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE orders SET fulfillment_status = 'DELIVERED' WHERE id = ${ORDER_ID}
    `), "order fulfillment transition not allowed");
  });

  it("requires a current generation before direct cycle production start", async () => {
    await seedPackingFixture(context.db, { cycleStatus: "LOCKED", orderStatus: "CONFIRMED" });
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE bake_cycles SET status = 'IN_PRODUCTION' WHERE id = ${CYCLE_ID}
    `), "cycle operations requires current task generation");
  });

  it("rejects direct production start from OPEN and direct completion from LOCKED", async () => {
    await seedPackingFixture(context.db, { cycleStatus: "LOCKED", orderStatus: "CONFIRMED" });
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE bake_cycles SET status = 'COMPLETED' WHERE id = ${CYCLE_ID}
    `), "cycle operations transition not allowed");
    await context.db.execute(sql`
      UPDATE bake_cycles SET status = 'OPEN' WHERE id = ${CYCLE_ID}
    `);
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE bake_cycles SET status = 'IN_PRODUCTION' WHERE id = ${CYCLE_ID}
    `), "cycle operations transition not allowed");
  });

  it("rejects direct completion while current work is unfinished", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await confirmConsumptionStock(context.db, PLANNING_OWNER_ID, scenario.cycleId);
    await createCycleOperationsCommandService(context.db).startCycle(
      PLANNING_OWNER_ID, { cycleId: scenario.cycleId },
    );
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE bake_cycles SET status = 'COMPLETED'
      WHERE owner_id = ${PLANNING_OWNER_ID} AND id = ${scenario.cycleId}
    `), "cycle completion blocked by unfinished work");
  });

  it("rejects direct unlock after an Order starts production", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await confirmConsumptionStock(context.db, PLANNING_OWNER_ID, scenario.cycleId);
    await createCycleOperationsCommandService(context.db).startCycle(
      PLANNING_OWNER_ID, { cycleId: scenario.cycleId },
    );
    await createOrderOperationsCommandService(context.db).startOrders(
      PLANNING_OWNER_ID, { cycleId: scenario.cycleId, orderIds: [scenario.orderIds[0]!] },
    );
    await expectTriggerRejection(() => context.db.execute(sql`
      UPDATE bake_cycles SET status = 'OPEN', active_planning_snapshot_id = NULL
      WHERE owner_id = ${PLANNING_OWNER_ID} AND id = ${scenario.cycleId}
    `), "cycle unlock blocked by operations");
    const [cycle] = await context.db.select().from(bakeCycles)
      .where(sql`${bakeCycles.id} = ${scenario.cycleId}`);
    expect(cycle!.status).toBe("IN_PRODUCTION");
  });

  it("allows packing progress changes while the active item, Order, and Cycle are in production", async () => {
    await seedPackingFixture(context.db);
    await insertProgress(context.db);

    await context.db.execute(sql`
      UPDATE order_item_packing_progress
      SET packed_quantity = 4
      WHERE owner_id = ${OWNER_ID} AND order_item_id = ${ITEM_ID}
    `);

    const result = await context.db.execute(sql`
      SELECT packed_quantity AS "packedQuantity"
      FROM order_item_packing_progress
      WHERE owner_id = ${OWNER_ID} AND order_item_id = ${ITEM_ID}
    `);
    expect(
      (result as unknown as { rows: { packedQuantity: number }[] }).rows,
    ).toEqual([{ packedQuantity: 4 }]);
  });

  it("rejects duplicate owner/item progress rows", async () => {
    await seedPackingFixture(context.db);
    await insertProgress(context.db);

    await expectConstraintViolation(
      () => insertProgress(context.db),
      "order_item_packing_progress_owner_item_unique",
    );
  });

  it("rejects negative packed quantities", async () => {
    await seedPackingFixture(context.db);

    await expectConstraintViolation(
      () => insertProgress(context.db, { packedQuantity: -1 }),
      "order_item_packing_progress_non_negative",
    );
  });

  it("rejects a cross-owner item reference", async () => {
    await seedPackingFixture(context.db);

    await expect(
      insertProgress(context.db, { ownerId: OTHER_OWNER_ID }),
    ).rejects.toThrow();
  });

  it("rejects a missing item", async () => {
    await seedPackingFixture(context.db);

    await expect(
      insertProgress(context.db, { orderItemId: MISSING_ITEM_ID }),
    ).rejects.toThrow();
  });

  it("rejects an inactive item", async () => {
    await seedPackingFixture(context.db, { itemActive: false });

    await expect(insertProgress(context.db)).rejects.toThrow();
  });

  it("rejects a packed quantity above the active item quantity", async () => {
    await seedPackingFixture(context.db);

    await expect(
      insertProgress(context.db, { packedQuantity: 5 }),
    ).rejects.toThrow();
  });

  it("rejects packing when the Cycle is not in production", async () => {
    await seedPackingFixture(context.db, { cycleStatus: "LOCKED" });

    await expect(insertProgress(context.db)).rejects.toThrow();
  });

  it("rejects packing when the Order is not exactly in production", async () => {
    await seedPackingFixture(context.db, { orderStatus: "CONFIRMED" });

    await expect(insertProgress(context.db)).rejects.toThrow();
  });

  it("rejects a progress update after the Order becomes packed", async () => {
    await seedPackingFixture(context.db);
    await insertProgress(context.db, { packedQuantity: 4 });
    await context.db.execute(sql`
      UPDATE orders
      SET fulfillment_status = 'PACKED'
      WHERE owner_id = ${OWNER_ID} AND id = ${ORDER_ID}
    `);

    await expect(
      context.db.execute(sql`
        UPDATE order_item_packing_progress
        SET packed_quantity = 2
        WHERE owner_id = ${OWNER_ID} AND order_item_id = ${ITEM_ID}
      `),
    ).rejects.toThrow();
  });

  it("rejects owner/item changes even when the replacement item is valid", async () => {
    await seedPackingFixture(context.db);
    await context.db.execute(sql`
      INSERT INTO order_items (
        id, owner_id, order_id, product_id, quantity,
        unit_price_satang, position, active
      ) VALUES (
        ${SECOND_ITEM_ID}, ${OWNER_ID}, ${ORDER_ID}, ${PRODUCT_ID}, 4,
        12000, 1, true
      )
    `);
    await insertProgress(context.db);

    await expect(
      context.db.execute(sql`
        UPDATE order_item_packing_progress
        SET order_item_id = ${SECOND_ITEM_ID}
        WHERE owner_id = ${OWNER_ID} AND order_item_id = ${ITEM_ID}
      `),
    ).rejects.toThrow();
  });

  it("rejects hard deletion of packing progress", async () => {
    await seedPackingFixture(context.db);
    await insertProgress(context.db);

    await expect(
      context.db.execute(sql`
        DELETE FROM order_item_packing_progress
        WHERE owner_id = ${OWNER_ID} AND order_item_id = ${ITEM_ID}
      `),
    ).rejects.toThrow();
  });
});
