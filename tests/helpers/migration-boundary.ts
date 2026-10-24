import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";

// Disposable fixtures only. Each migration is atomic, like the real migrator;
// readMigrationFiles preserves statement breakpoints inside PL/pgSQL bodies.
export async function applyMigrationRange(
  db: PgliteDatabase,
  fromInclusive: number,
  toInclusive: number,
) {
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  for (let index = fromInclusive; index <= toInclusive; index++) {
    const migration = migrations[index];
    if (!migration) throw new Error(`Migration ${index} is missing`);
    await db.transaction(async (tx) => {
      for (const statement of migration.sql) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
    });
  }
}
