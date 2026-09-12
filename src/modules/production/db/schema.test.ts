import { sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";

async function queryRows<T>(db: DatabaseClient, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

describe("Phase 4A production schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("migrates all production columns with the required PostgreSQL types", async () => {
    const columns = await queryRows<{
      tableName: string;
      columnName: string;
      dataType: string;
      numericPrecision: number | null;
      numericScale: number | null;
    }>(
      context.db,
      sql`
        SELECT
          table_name AS "tableName",
          column_name AS "columnName",
          data_type AS "dataType",
          numeric_precision AS "numericPrecision",
          numeric_scale AS "numericScale"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'production_template_activities' AND column_name = 'default_time')
            OR (table_name = 'cycle_task_generations' AND column_name = 'primary_delivery_date')
            OR (table_name = 'cycle_tasks' AND column_name IN ('batch_count', 'scheduled_at'))
          )
        ORDER BY table_name, column_name
      `,
    );

    expect(columns).toEqual([
      {
        tableName: "cycle_task_generations",
        columnName: "primary_delivery_date",
        dataType: "date",
        numericPrecision: null,
        numericScale: null,
      },
      {
        tableName: "cycle_tasks",
        columnName: "batch_count",
        dataType: "numeric",
        numericPrecision: 18,
        numericScale: 6,
      },
      {
        tableName: "cycle_tasks",
        columnName: "scheduled_at",
        dataType: "timestamp with time zone",
        numericPrecision: null,
        numericScale: null,
      },
      {
        tableName: "production_template_activities",
        columnName: "default_time",
        dataType: "time without time zone",
        numericPrecision: null,
        numericScale: null,
      },
    ]);
  });

  it("registers the owner-scoped and active-list indexes", async () => {
    const rows = await queryRows<{ indexName: string }>(
      context.db,
      sql`
        SELECT indexname AS "indexName"
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'production_templates_owner_scope_active_idx',
            'production_templates_owner_product_active_idx',
            'production_templates_one_active_cycle_idx',
            'production_templates_one_active_product_idx',
            'production_template_activities_owner_template_sequence_idx',
            'production_template_activities_active_sequence_unique',
            'cycle_task_generations_owner_cycle_generation_unique',
            'cycle_tasks_owner_generation_scheduled_idx'
          )
        ORDER BY indexname
      `,
    );

    expect(rows.map((row) => row.indexName)).toEqual([
      "cycle_task_generations_owner_cycle_generation_unique",
      "cycle_tasks_owner_generation_scheduled_idx",
      "production_template_activities_active_sequence_unique",
      "production_template_activities_owner_template_sequence_idx",
      "production_templates_one_active_cycle_idx",
      "production_templates_one_active_product_idx",
      "production_templates_owner_product_active_idx",
      "production_templates_owner_scope_active_idx",
    ]);
  });

  it("installs both authoritative trigger functions and their triggers", async () => {
    const rows = await queryRows<{ triggerName: string; functionName: string }>(
      context.db,
      sql`
        SELECT
          trigger.tgname AS "triggerName",
          procedure.proname AS "functionName"
        FROM pg_trigger AS trigger
        JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
        WHERE NOT trigger.tgisinternal
          AND trigger.tgrelid IN (
            'cycle_task_generations'::regclass,
            'cycle_tasks'::regclass
          )
        ORDER BY trigger.tgname
      `,
    );

    expect(rows).toEqual([
      {
        triggerName: "cycle_task_generation_snapshot_guard",
        functionName: "enforce_cycle_task_generation_snapshot",
      },
      {
        triggerName: "cycle_task_lifecycle_guard",
        functionName: "enforce_cycle_task_lifecycle",
      },
    ]);
  });

  it("enables RLS without creating Data API policies", async () => {
    const tables = await queryRows<{ tableName: string; rowSecurity: boolean }>(
      context.db,
      sql`
        SELECT relname AS "tableName", relrowsecurity AS "rowSecurity"
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN (
            'production_templates',
            'production_template_activities',
            'cycle_task_generations',
            'cycle_tasks'
          )
        ORDER BY relname
      `,
    );
    const policies = await queryRows<{ policyName: string }>(
      context.db,
      sql`
        SELECT policyname AS "policyName"
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'production_templates',
            'production_template_activities',
            'cycle_task_generations',
            'cycle_tasks'
          )
      `,
    );

    expect(tables).toEqual([
      { tableName: "cycle_task_generations", rowSecurity: true },
      { tableName: "cycle_tasks", rowSecurity: true },
      { tableName: "production_template_activities", rowSecurity: true },
      { tableName: "production_templates", rowSecurity: true },
    ]);
    expect(policies).toEqual([]);
  });
});
