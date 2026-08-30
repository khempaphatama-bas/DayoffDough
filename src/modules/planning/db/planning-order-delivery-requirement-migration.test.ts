import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CYCLE_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const REQUIRES_LOCATION_METHOD_ID = "40000000-0000-4000-8000-000000000001";
const NO_LOCATION_METHOD_ID = "40000000-0000-4000-8000-000000000002";
const SNAPSHOT_ID = "50000000-0000-4000-8000-000000000001";

const ORDER_CASES = [
  {
    orderId: "60000000-0000-4000-8000-000000000001",
    orderSnapshotId: "70000000-0000-4000-8000-000000000001",
    deliveryMethodId: REQUIRES_LOCATION_METHOD_ID,
    expected: true,
  },
  {
    orderId: "60000000-0000-4000-8000-000000000002",
    orderSnapshotId: "70000000-0000-4000-8000-000000000002",
    deliveryMethodId: NO_LOCATION_METHOD_ID,
    expected: false,
  },
  {
    orderId: "60000000-0000-4000-8000-000000000003",
    orderSnapshotId: "70000000-0000-4000-8000-000000000003",
    deliveryMethodId: null,
    expected: false,
  },
] as const;

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

describe("0009 planning order delivery requirement migration", () => {
  it("backfills true, false, and missing delivery methods before enforcing NOT NULL", async () => {
    const client = new PGlite();
    const db = drizzle(client);

    try {
      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      expect(migrations.length).toBeGreaterThanOrEqual(10);

      await applyMigrations(db, migrations, 0, 8);

      await db.execute(sql`
        INSERT INTO delivery_methods (
          id,
          owner_id,
          name,
          default_customer_fee_satang,
          default_internal_cost_satang,
          requires_delivery_location
        ) VALUES
          (${REQUIRES_LOCATION_METHOD_ID}, ${OWNER_ID}, 'Requires location', 0, 0, true),
          (${NO_LOCATION_METHOD_ID}, ${OWNER_ID}, 'No location', 0, 0, false)
      `);
      await db.execute(sql`
        INSERT INTO customers (id, owner_id, name)
        VALUES (${CUSTOMER_ID}, ${OWNER_ID}, 'Migration customer')
      `);
      await db.execute(sql`
        INSERT INTO bake_cycles (
          id,
          owner_id,
          cycle_number,
          name,
          target_production_date,
          primary_delivery_date
        ) VALUES (
          ${CYCLE_ID},
          ${OWNER_ID},
          7001,
          'Migration cycle',
          '2026-08-30',
          '2026-08-31'
        )
      `);

      for (const orderCase of ORDER_CASES) {
        await db.execute(sql`
          INSERT INTO orders (
            id,
            owner_id,
            customer_id,
            bake_cycle_id,
            delivery_method_id
          ) VALUES (
            ${orderCase.orderId},
            ${OWNER_ID},
            ${CUSTOMER_ID},
            ${CYCLE_ID},
            ${orderCase.deliveryMethodId}
          )
        `);
      }

      await db.execute(sql`
        INSERT INTO cycle_planning_snapshots (
          id,
          owner_id,
          bake_cycle_id,
          generation,
          status,
          lock_request_id,
          input_fingerprint,
          cycle_number,
          cycle_name,
          target_production_date,
          primary_delivery_date,
          labor_rate_satang_per_hour,
          default_waste_allowance_percent,
          timezone,
          currency,
          cost_complete,
          locked_at
        ) VALUES (
          ${SNAPSHOT_ID},
          ${OWNER_ID},
          ${CYCLE_ID},
          1,
          'ACTIVE',
          '80000000-0000-4000-8000-000000000001',
          ${"a".repeat(64)},
          7001,
          'Migration cycle',
          '2026-08-30',
          '2026-08-31',
          0,
          0,
          'Asia/Bangkok',
          'THB',
          true,
          '2026-08-30T00:00:00.000Z'
        )
      `);

      for (const orderCase of ORDER_CASES) {
        await db.execute(sql`
          INSERT INTO cycle_order_snapshots (
            id,
            owner_id,
            planning_snapshot_id,
            source_order_id,
            source_customer_id,
            customer_name,
            source_delivery_method_id,
            delivery_method_name,
            payment_status,
            fulfillment_status,
            delivery_fee_payer,
            delivery_fee_charged_satang,
            delivery_cost_satang,
            discount_satang,
            amount_paid_satang,
            subtotal_satang,
            grand_total_satang,
            balance_satang
          ) VALUES (
            ${orderCase.orderSnapshotId},
            ${OWNER_ID},
            ${SNAPSHOT_ID},
            ${orderCase.orderId},
            ${CUSTOMER_ID},
            'Migration customer',
            ${orderCase.deliveryMethodId},
            ${orderCase.deliveryMethodId === null ? null : "Historical method"},
            'UNPAID',
            'NEW',
            'CUSTOMER',
            0,
            0,
            0,
            0,
            0,
            0,
            0
          )
        `);
      }

      await applyMigrations(db, migrations, 9, 9);

      const backfilled = await db.execute<{
        id: string;
        deliveryRequiresLocation: boolean;
      }>(sql`
        SELECT
          id,
          delivery_requires_location AS "deliveryRequiresLocation"
        FROM cycle_order_snapshots
        ORDER BY id
      `);
      expect(backfilled.rows).toEqual(
        ORDER_CASES.map((orderCase) => ({
          id: orderCase.orderSnapshotId,
          deliveryRequiresLocation: orderCase.expected,
        })),
      );

      const column = await db.execute<{ isNullable: string }>(sql`
        SELECT is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cycle_order_snapshots'
          AND column_name = 'delivery_requires_location'
      `);
      expect(column.rows).toEqual([{ isNullable: "NO" }]);
      await expect(
        db.execute(sql`
          UPDATE cycle_order_snapshots
          SET delivery_requires_location = NULL
          WHERE id = ${ORDER_CASES[0].orderSnapshotId}
        `),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});
