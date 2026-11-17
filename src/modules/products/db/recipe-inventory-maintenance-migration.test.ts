import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { applyMigrationRange } from "@tests/helpers/migration-boundary";

const owner = "81000000-0000-4000-8000-000000000001";
const otherOwner = "81000000-0000-4000-8000-000000000002";
const item = "82000000-0000-4000-8000-000000000001";
const versionId = (catalog: number, version: number) =>
  `83000000-0000-4000-8000-${String(catalog * 100 + version).padStart(12, "0")}`;

function insertedId(result: { rows: { id: string }[] }) {
  const [row] = result.rows;
  if (!row) throw new Error("Missing fixture insert ID");
  return row.id;
}

async function seedCatalog(
  db: PgliteDatabase,
  ownerId: string,
  catalog: number,
  dates: string[],
  activeVersion: number | null,
) {
  const name = `Bread ${catalog}`;
  const activeId = activeVersion === null ? null : versionId(catalog, activeVersion);
  const product = await db.execute<{ id: string }>(sql`INSERT INTO products
    (owner_id, name, selling_unit, default_unit_price_satang)
    VALUES (${ownerId}, ${name}, 'pc', 10000) RETURNING id`);
  const productId = insertedId(product);
  const recipe = await db.execute<{ id: string }>(sql`INSERT INTO recipes (owner_id, product_id, name)
    VALUES (${ownerId}, ${productId}, ${name}) RETURNING id`);
  const recipeId = insertedId(recipe);
  for (const [index, date] of dates.entries()) {
    await db.execute(sql`INSERT INTO recipe_versions
      (id, owner_id, recipe_id, version_code, base_yield_quantity, yield_unit,
       labor_minutes_per_batch, utility_cost_satang_per_batch, instructions, created_at)
      VALUES (${versionId(catalog, index + 1)}, ${ownerId}, ${recipeId}, ${`v${index + 1}`},
        12, 'pc', 30, 200, 'Mix and bake', ${date})`);
  }
  if (activeId) {
    await db.execute(sql`UPDATE products SET active_recipe_version_id = ${activeId}
      WHERE owner_id = ${ownerId} AND id = ${productId}`);
  }
  return { productId, recipeId };
}

describe("0015 recipe and inventory maintenance", () => {
  it("backfills_active_oldest_and_tied_timestamps_preserving_snapshot", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    try {
      await applyMigrationRange(db, 0, 14);
      const dates = [
        "2026-01-01", "2026-01-02", "2026-01-02", "2026-01-04",
        "2026-01-05", "2026-01-06", "2026-01-07",
      ];
      const { productId, recipeId } = await seedCatalog(db, owner, 1, dates, 1);
      const tied = await seedCatalog(db, owner, 2, Array(7).fill("2026-01-01"), null);
      const exact = await seedCatalog(db, owner, 3, dates.slice(0, 5), 1);
      const separate = await seedCatalog(db, otherOwner, 4, dates, 2);
      const archivedReference = versionId(1, 2);

      await db.execute(sql`INSERT INTO inventory_items
        (id, owner_id, name, category, base_unit, purchase_unit_label, base_quantity_per_purchase_pack)
        VALUES (${item}, ${owner}, 'น้ำ', 'INGREDIENT', 'ml', 'bottle', 1500)`);
      await db.execute(sql`INSERT INTO recipe_ingredients
        (owner_id, recipe_version_id, inventory_item_id, quantity_in_base_unit, notes)
        VALUES (${owner}, ${archivedReference}, ${item}, 250, 'Original notes')`);

      const cycle = await db.execute<{ id: string }>(sql`INSERT INTO bake_cycles
        (owner_id, name, status, target_production_date, primary_delivery_date)
        VALUES (${owner}, 'Locked bake', 'LOCKED', '2026-10-24', '2026-10-25') RETURNING id`);
      const cycleId = insertedId(cycle);
      const snapshot = await db.execute<{ id: string }>(sql`INSERT INTO cycle_planning_snapshots
        (owner_id, bake_cycle_id, generation, status, lock_request_id, input_fingerprint,
         cycle_number, cycle_name, target_production_date, primary_delivery_date,
         labor_rate_satang_per_hour, default_waste_allowance_percent, timezone, currency, cost_complete, locked_at)
        SELECT owner_id, id, 1, 'ACTIVE', gen_random_uuid(), ${"a".repeat(64)}, cycle_number, name,
          target_production_date, primary_delivery_date, 0, 0, 'Asia/Bangkok', 'THB', true, now()
        FROM bake_cycles WHERE id = ${cycleId} RETURNING id`);
      const snapshotId = insertedId(snapshot);
      await db.execute(sql`INSERT INTO cycle_recipe_plans
        (owner_id, planning_snapshot_id, source_product_id, source_recipe_id, source_recipe_version_id,
         recipe_name, version_code, instructions, base_yield_quantity, yield_unit, yield_in_selling_unit,
         selling_unit, labor_minutes_per_batch, utility_cost_satang_per_batch, waste_allowance_percent, waste_allowance_source)
        VALUES (${owner}, ${snapshotId}, ${productId}, ${recipeId}, ${archivedReference}, 'Bread 1', 'v2',
          'Mix and bake', 12, 'pc', 12, 'pc', 30, 200, 0, 'RECIPE')`);
      await db.execute(sql`INSERT INTO cycle_cost_snapshots
        (owner_id, planning_snapshot_id, known_base_ingredient_cost_satang, known_waste_cost_satang,
         known_product_packaging_cost_satang, known_delivery_packaging_cost_satang, labor_cost_satang,
         utility_cost_satang, known_production_cost_satang, complete_production_cost_satang, missing_price_count, cost_complete)
        VALUES (${owner}, ${snapshotId}, 850, 0, 0, 0, 0, 200, 1050, 1050, 0, true)`);
      const readSnapshot = async () => {
        const rows = await db.execute(sql`SELECT to_jsonb(s) AS header, to_jsonb(r) AS recipe, to_jsonb(c) AS cost,
          r.source_recipe_version_id AS "sourceRecipeVersionId",
          c.complete_production_cost_satang AS "completeProductionCostSatang"
          FROM cycle_planning_snapshots s
          JOIN cycle_recipe_plans r ON r.owner_id = s.owner_id AND r.planning_snapshot_id = s.id
          JOIN cycle_cost_snapshots c ON c.owner_id = s.owner_id AND c.planning_snapshot_id = s.id
          WHERE s.id = ${snapshotId}`);
        return rows.rows;
      };
      const readIngredients = async () => (await db.execute(sql`SELECT * FROM recipe_ingredients
        WHERE owner_id = ${owner} AND recipe_version_id = ${archivedReference} ORDER BY id`)).rows;
      const readVersions = async () => (await db.execute(sql`SELECT to_jsonb(rv) - 'archived_at' AS content
        FROM recipe_versions rv ORDER BY id`)).rows;
      const before = await readSnapshot();
      expect(before).toEqual([expect.objectContaining({
        sourceRecipeVersionId: archivedReference, completeProductionCostSatang: 1050,
      })]);
      const ingredients = await readIngredients();
      expect(ingredients).toHaveLength(1);
      const versions = await readVersions();

      const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
      await applyMigrationRange(db, 15, migrations.length - 1);

      const selectable = async (ownerId: string, id: string) =>
        (await db.execute<{ version_code: string }>(sql`SELECT version_code FROM recipe_versions
          WHERE owner_id = ${ownerId} AND recipe_id = ${id} AND archived_at IS NULL ORDER BY id`))
          .rows.map((row) => row.version_code);
      const selectableCodes = await selectable(owner, recipeId);
      expect(selectableCodes).toEqual(["v1", "v4", "v5", "v6", "v7"]);
      expect(await selectable(owner, tied.recipeId)).toEqual(["v3", "v4", "v5", "v6", "v7"]);
      expect(await selectable(owner, exact.recipeId)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
      expect(await selectable(otherOwner, separate.recipeId)).toEqual(["v2", "v4", "v5", "v6", "v7"]);
      const state = await db.execute(sql`SELECT name, active_recipe_version_id FROM products ORDER BY name`);
      expect(state.rows).toEqual([
        { name: "Bread 1", active_recipe_version_id: versionId(1, 1) },
        { name: "Bread 2", active_recipe_version_id: null },
        { name: "Bread 3", active_recipe_version_id: versionId(3, 1) },
        { name: "Bread 4", active_recipe_version_id: versionId(4, 2) },
      ]);
      expect(await readIngredients()).toEqual(ingredients);
      expect(await readVersions()).toEqual(versions);
      const after = await readSnapshot();
      expect(after).toEqual(before);
      expect((await db.execute(sql`SELECT owner_id, name, ingredient_kind, purchase_unit_label,
        base_quantity_per_purchase_pack::text FROM inventory_items WHERE id = ${item}`)).rows)
        .toEqual([{ owner_id: owner, name: "น้ำ", ingredient_kind: "STANDARD", purchase_unit_label: "bottle",
          base_quantity_per_purchase_pack: "1500.000000" }]);
    } finally {
      await client.close();
    }
  });

  it("preserves_existing_items_and_validates_prep_units_on_fresh_db", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    try {
      await migrate(db, { migrationsFolder: "drizzle" });
      const insert = async (kind: string, unit: string, category = "INGREDIENT",
        label = "ไม่ต้องซื้อ", packQuantity = 1, minimumStock = 0) =>
        (await db.execute(sql`INSERT INTO inventory_items
          (owner_id, name, category, base_unit, ingredient_kind, purchase_unit_label,
           base_quantity_per_purchase_pack, minimum_stock_quantity)
          VALUES (${owner}, gen_random_uuid()::text, ${category}, ${unit}, ${kind}, ${label},
            ${packQuantity}, ${minimumStock}) RETURNING ingredient_kind, base_unit`)).rows;
      for (const [kind, unit] of [["WATER", "ml"], ["WATER", "l"], ["ICE", "g"], ["ICE", "kg"]] as const) {
        await expect(insert(kind, unit)).resolves.toMatchObject([{ ingredient_kind: kind, base_unit: unit }]);
      }
      const rejected: Parameters<typeof insert>[] = [
        ["WATER", "g"],
        ["ICE", "ml"],
        ["WATER", "ml", "PACKAGING"],
        ["WATER", "ml", "INGREDIENT", "bottle"],
        ["WATER", "ml", "INGREDIENT", "ไม่ต้องซื้อ", 2],
        ["ICE", "g", "INGREDIENT", "ไม่ต้องซื้อ", 1, 2],
        ["UNKNOWN", "g"],
      ];
      for (const args of rejected) {
        await expect(insert(...args)).rejects.toMatchObject({ cause: { code: "23514" } });
      }
      const metadata = await db.execute(sql`SELECT
        count(*)::int AS items,
        count(*) FILTER (WHERE ledger_revision = 0 AND latest_count_movement_id IS NULL)::int AS inert
        FROM inventory_ledger_states`);
      expect(metadata.rows).toEqual([{ items: 4, inert: 4 }]);
      for (const counts of [
        await db.execute(sql`SELECT count(*)::int AS count FROM inventory_prices`),
        await db.execute(sql`SELECT count(*)::int AS count FROM inventory_movements`),
      ]) {
        expect(counts.rows).toEqual([{ count: 0 }]);
      }
    } finally {
      await client.close();
    }
  });
});
