import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";

const tables = ["consumption_operations", "consumption_revision_items", "consumption_revisions", "cycle_consumption_contexts", "cycle_consumption_items", "inventory_ledger_states"];
describe("consumption schema catalog", () => {
  it("installs owned RESTRICT keys, successor uniqueness, exact storage, and RLS without policies", async () => {
    const fixture = await createTestDatabase();
    try {
      const db = fixture.db;
      const query = async (statement: ReturnType<typeof sql>) => (await db.execute(statement) as unknown as { rows: Record<string, unknown>[] }).rows;
      const names = sql.join(tables.map((name) => sql`${name}`), sql`, `);
      expect(await query(sql`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN (${names}) ORDER BY relname`)).toEqual(tables.map((relname) => ({ relname, relrowsecurity: true })));
      expect(await query(sql`SELECT policyname FROM pg_policies WHERE tablename IN (${names})`)).toEqual([]);
      const keys = await query(sql`SELECT conname, confdeltype, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname IN (${names}))`);
      expect(keys.map((key) => key.conname).sort()).toEqual([
        "consumption_contexts_current_fk", "consumption_contexts_cycle_fk", "consumption_contexts_generation_fk", "consumption_contexts_snapshot_fk",
        "consumption_items_context_fk", "consumption_items_inventory_fk", "consumption_items_price_fk",
        "consumption_revision_items_initial_count_fk", "consumption_revision_items_membership_fk", "consumption_revision_items_movement_fk", "consumption_revision_items_revision_fk", "consumption_revision_items_settlement_count_fk",
        "consumption_revisions_context_fk", "consumption_revisions_operation_fk", "consumption_revisions_previous_fk",
        "ledger_states_owned_count_fk", "ledger_states_owned_item_fk",
      ]);
      for (const key of keys) {
        expect(key.confdeltype).toBe("r");
        expect(key.definition).toMatch(/FOREIGN KEY \(owner_id,/);
      }
      expect(keys).toEqual(expect.arrayContaining([
        expect.objectContaining({ conname: "ledger_states_owned_count_fk", definition: expect.stringContaining("FOREIGN KEY (owner_id, inventory_item_id, latest_count_movement_id)") }),
        expect.objectContaining({ conname: "consumption_revisions_previous_fk", definition: expect.stringContaining("FOREIGN KEY (owner_id, context_id, previous_revision_id)") }),
        expect.objectContaining({ conname: "consumption_contexts_current_fk", definition: expect.stringContaining("FOREIGN KEY (owner_id, id, current_revision_id)") }),
      ]));
      const indexes = await query(sql`SELECT indexname FROM pg_indexes WHERE tablename IN (${names})`);
      expect(indexes).toEqual(expect.arrayContaining(["consumption_revisions_one_initial", "consumption_revisions_one_successor", "consumption_revisions_number_unique", "consumption_operations_request_unique"].map((indexname) => ({ indexname }))));
      expect(await query(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inventory_ledger_states' ORDER BY column_name`)).toEqual([
        { column_name: "inventory_item_id", data_type: "uuid" }, { column_name: "latest_count_movement_id", data_type: "uuid" }, { column_name: "ledger_revision", data_type: "bigint" }, { column_name: "owner_id", data_type: "uuid" },
      ]);
      expect(await query(sql`SELECT numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'consumption_revision_items' AND column_name IN ('used_quantity', 'quantity_delta')`)).toEqual(Array(2).fill({ numeric_precision: 18, numeric_scale: 6 }));
    } finally { await fixture.close(); }
  });
});
