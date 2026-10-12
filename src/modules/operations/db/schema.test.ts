import { sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";

async function queryRows<T>(db: DatabaseClient, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

async function operationColumns(db: DatabaseClient) {
  return queryRows<{
    tableName: string;
    columnName: string;
    dataType: string;
  }>(
    db,
    sql`
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'orders' AND column_name = 'confirmed_delivery_time')
          OR (
            table_name = 'cycle_order_snapshots'
            AND column_name = 'confirmed_delivery_time'
          )
          OR (
            table_name = 'order_item_packing_progress'
            AND column_name = 'packed_quantity'
          )
        )
      ORDER BY table_name, column_name
    `,
  );
}

describe("Phase 4B operations schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("installs authoritative Order and Cycle lifecycle triggers", async () => {
    const rows = await queryRows<{ tableName: string; triggerName: string; functionName: string }>(context.db, sql`
      SELECT relation.relname AS "tableName", trigger_row.tgname AS "triggerName",
        procedure.proname AS "functionName"
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
      WHERE NOT trigger_row.tgisinternal
        AND trigger_row.tgname IN ('order_fulfillment_transition_guard', 'cycle_operations_lifecycle_guard')
      ORDER BY relation.relname
    `);
    expect(rows).toEqual([
      { tableName: "bake_cycles", triggerName: "cycle_operations_lifecycle_guard", functionName: "enforce_cycle_operations_lifecycle" },
      { tableName: "orders", triggerName: "order_fulfillment_transition_guard", functionName: "enforce_order_fulfillment_transition" },
    ]);
  });

  it("stores local delivery time and packing quantities with the required types", async () => {
    expect(await operationColumns(context.db)).toEqual([
      {
        tableName: "cycle_order_snapshots",
        columnName: "confirmed_delivery_time",
        dataType: "time without time zone",
      },
      {
        tableName: "order_item_packing_progress",
        columnName: "packed_quantity",
        dataType: "integer",
      },
      {
        tableName: "orders",
        columnName: "confirmed_delivery_time",
        dataType: "time without time zone",
      },
    ]);
  });

  it("registers the owner-scoped item key, owner/item uniqueness, quantity check, and list index", async () => {
    const constraints = await queryRows<{
      constraintName: string;
      constraintType: string;
      columns: string[];
    }>(
      context.db,
      sql`
        SELECT
          constraint_row.conname AS "constraintName",
          constraint_row.contype AS "constraintType",
          array_agg(attribute.attname ORDER BY key_column.ordinality) AS columns
        FROM pg_constraint AS constraint_row
        CROSS JOIN LATERAL unnest(constraint_row.conkey)
          WITH ORDINALITY AS key_column(attribute_number, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attribute_number
        WHERE constraint_row.conrelid = 'order_item_packing_progress'::regclass
          AND constraint_row.contype IN ('c', 'f', 'p', 'u')
        GROUP BY constraint_row.conname, constraint_row.contype
        ORDER BY constraint_row.conname
      `,
    );
    const foreignKey = await queryRows<{
      constraintName: string;
      referencedTable: string;
      referencedColumns: string[];
      deleteAction: string;
    }>(
      context.db,
      sql`
        SELECT
          constraint_row.conname AS "constraintName",
          referenced_class.relname AS "referencedTable",
          array_agg(attribute.attname ORDER BY key_column.ordinality)
            AS "referencedColumns",
          constraint_row.confdeltype AS "deleteAction"
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS referenced_class
          ON referenced_class.oid = constraint_row.confrelid
        CROSS JOIN LATERAL unnest(constraint_row.confkey)
          WITH ORDINALITY AS key_column(attribute_number, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.confrelid
         AND attribute.attnum = key_column.attribute_number
        WHERE constraint_row.conname = 'order_item_packing_progress_owned_item_fk'
        GROUP BY
          constraint_row.conname,
          referenced_class.relname,
          constraint_row.confdeltype
      `,
    );
    const indexes = await queryRows<{ indexName: string }>(
      context.db,
      sql`
        SELECT indexname AS "indexName"
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'order_item_packing_progress_owner_item_idx'
      `,
    );

    expect(constraints).toEqual([
      {
        constraintName: "order_item_packing_progress_non_negative",
        constraintType: "c",
        columns: ["packed_quantity"],
      },
      {
        constraintName: "order_item_packing_progress_owned_item_fk",
        constraintType: "f",
        columns: ["owner_id", "order_item_id"],
      },
      {
        constraintName: "order_item_packing_progress_owner_item_unique",
        constraintType: "u",
        columns: ["owner_id", "order_item_id"],
      },
      {
        constraintName: "order_item_packing_progress_pkey",
        constraintType: "p",
        columns: ["id"],
      },
    ]);
    expect(foreignKey).toEqual([
      {
        constraintName: "order_item_packing_progress_owned_item_fk",
        referencedTable: "order_items",
        referencedColumns: ["owner_id", "id"],
        deleteAction: "r",
      },
    ]);
    expect(indexes).toEqual([
      { indexName: "order_item_packing_progress_owner_item_idx" },
    ]);
  });

  it("enables RLS without creating Data API policies", async () => {
    const tables = await queryRows<{
      tableName: string;
      rowSecurity: boolean;
    }>(
      context.db,
      sql`
        SELECT relname AS "tableName", relrowsecurity AS "rowSecurity"
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname = 'order_item_packing_progress'
      `,
    );
    const policies = await queryRows<{ policyName: string }>(
      context.db,
      sql`
        SELECT policyname AS "policyName"
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'order_item_packing_progress'
      `,
    );

    expect(tables).toEqual([
      { tableName: "order_item_packing_progress", rowSecurity: true },
    ]);
    expect(policies).toEqual([]);
  });

  it("installs only the authoritative Packing trigger for Phase 4B", async () => {
    const triggers = await queryRows<{
      triggerName: string;
      functionName: string;
    }>(
      context.db,
      sql`
        SELECT
          trigger.tgname AS "triggerName",
          procedure.proname AS "functionName"
        FROM pg_trigger AS trigger
        JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
        WHERE NOT trigger.tgisinternal
          AND trigger.tgrelid = 'order_item_packing_progress'::regclass
        ORDER BY trigger.tgname
      `,
    );

    expect(triggers).toEqual([
      {
        triggerName: "order_item_packing_progress_guard",
        functionName: "enforce_order_item_packing_progress",
      },
    ]);
  });
});
