import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/lib/db/types";
import { assertCycleOperationsUnlockAllowed } from "@/modules/operations/application/unlock-guard";

const OWNER_ID = "81000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "82000000-0000-4000-8000-000000000001";
const CYCLE_ID = "83000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "84000000-0000-4000-8000-000000000001";
const PACKED_ORDER_ID = "85000000-0000-4000-8000-000000000001";
const DELIVERED_ORDER_ID = "85000000-0000-4000-8000-000000000002";
const IN_PRODUCTION_ORDER_ID = "85000000-0000-4000-8000-000000000003";
const INACTIVE_ORDER_ID = "85000000-0000-4000-8000-000000000004";
const PACKED_ITEM_ID = "86000000-0000-4000-8000-000000000001";
const DELIVERED_ITEM_ID = "86000000-0000-4000-8000-000000000002";
const IN_PRODUCTION_ITEM_ID = "86000000-0000-4000-8000-000000000003";
const INACTIVE_ITEM_ID = "86000000-0000-4000-8000-000000000004";

async function applyMigrations(
  db: ReturnType<typeof drizzle>,
  migrations: readonly MigrationMeta[],
  startIndex: number,
  endIndex: number,
) {
  for (const migration of migrations.slice(startIndex, endIndex + 1)) {
    for (const statement of migration.sql) {
      if (statement.trim().length > 0) {
        await db.execute(sql.raw(statement));
      }
    }
  }
}

async function seedLegacyOrders(db: ReturnType<typeof drizzle>) {
  await db.execute(sql`
    INSERT INTO customers (id, owner_id, name)
    VALUES (${CUSTOMER_ID}, ${OWNER_ID}, 'Legacy packing customer')
  `);
  await db.execute(sql`
    INSERT INTO bake_cycles (
      id, owner_id, name, status,
      target_production_date, primary_delivery_date
    ) VALUES (
      ${CYCLE_ID}, ${OWNER_ID}, 'Legacy packing cycle', 'COMPLETED',
      '2026-09-19', '2026-09-20'
    )
  `);
  await db.execute(sql`
    INSERT INTO products (
      id, owner_id, name, selling_unit, default_unit_price_satang
    ) VALUES (${PRODUCT_ID}, ${OWNER_ID}, 'Legacy loaf', 'piece', 10000)
  `);
  await db.execute(sql`
    INSERT INTO orders (
      id, owner_id, customer_id, bake_cycle_id, fulfillment_status
    ) VALUES
      (${PACKED_ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, 'PACKED'),
      (${DELIVERED_ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, 'DELIVERED'),
      (${IN_PRODUCTION_ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, 'IN_PRODUCTION'),
      (${INACTIVE_ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, 'PACKED')
  `);
  await db.execute(sql`
    INSERT INTO order_items (
      id, owner_id, order_id, product_id, quantity,
      unit_price_satang, position, active
    ) VALUES
      (${PACKED_ITEM_ID}, ${OWNER_ID}, ${PACKED_ORDER_ID}, ${PRODUCT_ID}, 4, 10000, 0, true),
      (${DELIVERED_ITEM_ID}, ${OWNER_ID}, ${DELIVERED_ORDER_ID}, ${PRODUCT_ID}, 2, 10000, 0, true),
      (${IN_PRODUCTION_ITEM_ID}, ${OWNER_ID}, ${IN_PRODUCTION_ORDER_ID}, ${PRODUCT_ID}, 3, 10000, 0, true),
      (${INACTIVE_ITEM_ID}, ${OWNER_ID}, ${INACTIVE_ORDER_ID}, ${PRODUCT_ID}, 5, 10000, 0, false)
  `);
}

async function packedProgressRows(db: ReturnType<typeof drizzle>) {
  const result = await db.execute<{
    orderItemId: string;
    packedQuantity: number;
  }>(sql`
    SELECT
      order_item_id AS "orderItemId",
      packed_quantity AS "packedQuantity"
    FROM order_item_packing_progress
    ORDER BY order_item_id
  `);
  return result.rows;
}

describe("0013 Phase 4B operations migration", () => {
  it("ignores a zero Packing row preserved from before the progress trigger", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      await applyMigrations(db, migrations, 0, 12);
      await db.execute(sql`INSERT INTO customers (id, owner_id, name)
        VALUES (${CUSTOMER_ID}, ${OWNER_ID}, 'Legacy zero-progress customer')`);
      await db.execute(sql`INSERT INTO bake_cycles (
        id, owner_id, name, status, target_production_date, primary_delivery_date
      ) VALUES (${CYCLE_ID}, ${OWNER_ID}, 'Legacy zero-progress cycle', 'LOCKED', '2026-09-19', '2026-09-20')`);
      await db.execute(sql`INSERT INTO products (
        id, owner_id, name, selling_unit, default_unit_price_satang
      ) VALUES (${PRODUCT_ID}, ${OWNER_ID}, 'Legacy loaf', 'piece', 10000)`);
      await db.execute(sql`INSERT INTO orders (
        id, owner_id, customer_id, bake_cycle_id, fulfillment_status
      ) VALUES (${IN_PRODUCTION_ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID}, 'CONFIRMED')`);
      await db.execute(sql`INSERT INTO order_items (
        id, owner_id, order_id, product_id, quantity, unit_price_satang, position, active
      ) VALUES (${IN_PRODUCTION_ITEM_ID}, ${OWNER_ID}, ${IN_PRODUCTION_ORDER_ID}, ${PRODUCT_ID}, 3, 10000, 0, true)`);

      const statements = migrations[13]!.sql;
      const progressGuardIndex = statements.findIndex((statement) =>
        statement.includes("CREATE FUNCTION enforce_order_item_packing_progress"));
      expect(progressGuardIndex).toBeGreaterThan(0);
      for (const statement of statements.slice(0, progressGuardIndex)) {
        if (statement.trim()) await db.execute(sql.raw(statement));
      }
      await db.execute(sql`INSERT INTO order_item_packing_progress (
        owner_id, order_item_id, packed_quantity
      ) VALUES (${OWNER_ID}, ${IN_PRODUCTION_ITEM_ID}, 0)`);
      for (const statement of statements.slice(progressGuardIndex)) {
        if (statement.trim()) await db.execute(sql.raw(statement));
      }

      await expect(assertCycleOperationsUnlockAllowed(
        db as unknown as DatabaseClient, OWNER_ID, CYCLE_ID,
      )).resolves.toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("backfills only active items belonging to packed or delivered legacy orders", async () => {
    const client = new PGlite();
    const db = drizzle(client);

    try {
      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      expect(migrations.length).toBeGreaterThanOrEqual(14);
      await applyMigrations(db, migrations, 0, 12);
      await seedLegacyOrders(db);
      await applyMigrations(db, migrations, 13, 13);

      expect(await packedProgressRows(db)).toEqual([
        { orderItemId: PACKED_ITEM_ID, packedQuantity: 4 },
        { orderItemId: DELIVERED_ITEM_ID, packedQuantity: 2 },
      ]);

      const trigger = await db.execute<{
        triggerName: string;
        functionName: string;
      }>(sql`
        SELECT
          trigger.tgname AS "triggerName",
          procedure.proname AS "functionName"
        FROM pg_trigger AS trigger
        JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
        WHERE NOT trigger.tgisinternal
          AND trigger.tgrelid = 'order_item_packing_progress'::regclass
      `);
      expect(trigger.rows).toEqual([
        {
          triggerName: "order_item_packing_progress_guard",
          functionName: "enforce_order_item_packing_progress",
        },
      ]);

      const lifecycleTriggers = await db.execute<{
        tableName: string;
        triggerName: string;
      }>(sql`
        SELECT relation.relname AS "tableName", trigger_row.tgname AS "triggerName"
        FROM pg_trigger AS trigger_row
        JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
        WHERE NOT trigger_row.tgisinternal
          AND trigger_row.tgname IN ('order_fulfillment_transition_guard', 'cycle_operations_lifecycle_guard')
        ORDER BY relation.relname
      `);
      expect(lifecycleTriggers.rows).toEqual([
        { tableName: "bake_cycles", triggerName: "cycle_operations_lifecycle_guard" },
        { tableName: "orders", triggerName: "order_fulfillment_transition_guard" },
      ]);
    } finally {
      await client.close();
    }
  });
});
