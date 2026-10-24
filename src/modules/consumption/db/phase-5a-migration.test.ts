import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrationRange } from "@tests/helpers/migration-boundary";

const owner = "81000000-0000-4000-8000-000000000001";
const item = "82000000-0000-4000-8000-000000000001";

describe("0014 consumption cutover", () => {
  it("keeps every legacy movement and balance unchanged at cutover", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    try {
      await applyMigrationRange(db, 0, 13);
      for (const status of ["DRAFT", "OPEN", "LOCKED", "IN_PRODUCTION", "COMPLETED", "CANCELLED"]) {
        await db.execute(sql`INSERT INTO bake_cycles (owner_id, name, status, target_production_date, primary_delivery_date)
          VALUES (${owner}, ${status}, ${status}, '2026-10-24', '2026-10-25')`);
      }
      await db.execute(sql`INSERT INTO inventory_items
        (id, owner_id, name, category, base_unit, purchase_unit_label, base_quantity_per_purchase_pack)
        VALUES (${item}, ${owner}, 'Legacy flour', 'INGREDIENT', 'g', 'bag', 1000)`);
      await db.execute(sql`INSERT INTO inventory_movements
        (owner_id, inventory_item_id, type, quantity_delta_in_base_unit, counted_quantity_in_base_unit, occurred_at)
        VALUES (${owner}, ${item}, 'COUNT', 8, 8, '2026-10-23'),
          (${owner}, ${item}, 'PURCHASE', 2, NULL, '2026-10-23'),
          (${owner}, ${item}, 'COUNT', -15, 0, '2026-10-01')`);
      const beforeMovements = (await db.execute(sql`SELECT * FROM inventory_movements ORDER BY id`)).rows;
      const beforeBalances = (await db.execute(sql`SELECT inventory_item_id, sum(quantity_delta_in_base_unit)::text AS balance FROM inventory_movements GROUP BY inventory_item_id`)).rows;
      await applyMigrationRange(db, 14, 14);
      expect((await db.execute(sql`SELECT * FROM inventory_movements ORDER BY id`)).rows).toEqual(beforeMovements);
      expect((await db.execute(sql`SELECT inventory_item_id, sum(quantity_delta_in_base_unit)::text AS balance FROM inventory_movements GROUP BY inventory_item_id`)).rows).toEqual(beforeBalances);
      expect((await db.execute(sql`SELECT consumption_policy FROM bake_cycles ORDER BY name`)).rows.map((row) => row.consumption_policy)).toEqual(Array(6).fill("LEGACY"));
      expect((await db.execute(sql`SELECT ledger_revision::text AS revision, latest_count_movement_id AS fence FROM inventory_ledger_states`)).rows).toEqual([{ revision: "0", fence: null }]);
      for (const table of ["cycle_consumption_contexts", "cycle_consumption_items", "consumption_operations", "consumption_revisions", "consumption_revision_items"]) {
        expect((await db.execute(sql.raw(`SELECT count(*)::int AS count FROM ${table}`))).rows).toEqual([{ count: 0 }]);
      }
      expect((await db.execute(sql`INSERT INTO bake_cycles (owner_id, name, target_production_date, primary_delivery_date)
        VALUES (${owner}, 'New', '2026-10-24', '2026-10-25') RETURNING consumption_policy`)).rows).toEqual([{ consumption_policy: "CONSUMPTION_V1" }]);
      await expect(db.execute(sql`UPDATE bake_cycles SET consumption_policy = 'CONSUMPTION_V1' WHERE name = 'DRAFT'`)).rejects.toThrow();
      await expect(db.execute(sql`INSERT INTO bake_cycles (owner_id, name, consumption_policy, target_production_date, primary_delivery_date)
        VALUES (${owner}, 'Opt out', 'LEGACY', '2026-10-24', '2026-10-25')`)).rejects.toThrow();
    } finally { await client.close(); }
  });

  it("migrates an empty database without inventory or prices", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    try {
      await applyMigrationRange(db, 0, 14);
      expect((await db.execute(sql`SELECT count(*)::int AS count FROM inventory_ledger_states`)).rows).toEqual([{ count: 0 }]);
    } finally { await client.close(); }
  });
});
