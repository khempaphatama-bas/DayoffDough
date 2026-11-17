import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Logger } from "drizzle-orm/logger";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import type { DatabaseClient } from "@/lib/db/types";
import { applyMigrationRange } from "./migration-boundary";

export async function createTestDatabase(options?: Readonly<{
  logger?: Logger;
  // Only explicitly historical fixtures: raw SQL against the actual 0013 schema.
  beforeConsumptionCutover?: (db: DatabaseClient) => Promise<void>;
}>): Promise<{
  db: DatabaseClient;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const testDb = drizzle(client, {
    schema,
    ...(options?.logger ? { logger: options.logger } : {}),
  });
  if (options?.beforeConsumptionCutover) {
    await applyMigrationRange(drizzle(client), 0, 13);
    await options.beforeConsumptionCutover(testDb as unknown as DatabaseClient);
    await applyMigrationRange(drizzle(client), 14, 15);
  } else {
    await migrate(testDb, { migrationsFolder: "drizzle" });
  }
  return {
    db: testDb as unknown as DatabaseClient,
    close: async () => client.close(),
  };
}
