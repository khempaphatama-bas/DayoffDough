import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "20000000-0000-4000-8000-000000000001";
const CYCLE_ID = "30000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "40000000-0000-4000-8000-000000000001";
const ORDER_ID = "50000000-0000-4000-8000-000000000001";
const FIRST_ITEM_ID = "60000000-0000-4000-8000-000000000001";
const SECOND_ITEM_ID = "60000000-0000-4000-8000-000000000002";

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

describe("0010 order item lifecycle migration", () => {
  it("backfills deterministic positions and enforces active-position integrity", async () => {
    const client = new PGlite();
    const db = drizzle(client);

    try {
      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      expect(migrations).toHaveLength(11);
      await applyMigrations(db, migrations, 0, 9);
      await db.execute(sql`
        INSERT INTO customers (id, owner_id, name)
        VALUES (${CUSTOMER_ID}, ${OWNER_ID}, 'Migration customer')
      `);
      await db.execute(sql`
        INSERT INTO bake_cycles (
          id, owner_id, cycle_number, name,
          target_production_date, primary_delivery_date
        ) VALUES (
          ${CYCLE_ID}, ${OWNER_ID}, 8001, 'Migration cycle',
          '2026-08-30', '2026-08-31'
        )
      `);
      await db.execute(sql`
        INSERT INTO products (
          id, owner_id, name, selling_unit, default_unit_price_satang
        ) VALUES (${PRODUCT_ID}, ${OWNER_ID}, 'Migration product', 'piece', 0)
      `);
      await db.execute(sql`
        INSERT INTO orders (id, owner_id, customer_id, bake_cycle_id)
        VALUES (${ORDER_ID}, ${OWNER_ID}, ${CUSTOMER_ID}, ${CYCLE_ID})
      `);
      await db.execute(sql`
        INSERT INTO order_items (
          id, owner_id, order_id, product_id, quantity,
          unit_price_satang, created_at
        ) VALUES
          (
            ${SECOND_ITEM_ID}, ${OWNER_ID}, ${ORDER_ID}, ${PRODUCT_ID}, 1,
            0, '2026-08-30T00:00:00.000Z'
          ),
          (
            ${FIRST_ITEM_ID}, ${OWNER_ID}, ${ORDER_ID}, ${PRODUCT_ID}, 1,
            0, '2026-08-30T00:00:00.000Z'
          )
      `);

      await applyMigrations(db, migrations, 10, 10);

      const rows = await db.execute<{
        id: string;
        position: number;
        active: boolean;
      }>(sql`
        SELECT id, position, active
        FROM order_items
        WHERE owner_id = ${OWNER_ID} AND order_id = ${ORDER_ID}
        ORDER BY position
      `);
      expect(rows.rows).toEqual([
        { id: FIRST_ITEM_ID, position: 0, active: true },
        { id: SECOND_ITEM_ID, position: 1, active: true },
      ]);

      const columns = await db.execute<{
        columnName: string;
        isNullable: string;
      }>(sql`
        SELECT column_name AS "columnName", is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_items'
          AND column_name IN ('position', 'active')
        ORDER BY column_name
      `);
      expect(columns.rows).toEqual([
        { columnName: "active", isNullable: "NO" },
        { columnName: "position", isNullable: "NO" },
      ]);
      await expect(
        db.execute(sql`
          UPDATE order_items SET position = -1 WHERE id = ${FIRST_ITEM_ID}
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          UPDATE order_items SET position = 0 WHERE id = ${SECOND_ITEM_ID}
        `),
      ).rejects.toThrow();
      await db.execute(sql`
        UPDATE order_items SET active = false WHERE id = ${SECOND_ITEM_ID}
      `);
      await expect(
        db.execute(sql`
          UPDATE order_items SET position = 0 WHERE id = ${SECOND_ITEM_ID}
        `),
      ).resolves.toBeDefined();
    } finally {
      await client.close();
    }
  });
});
