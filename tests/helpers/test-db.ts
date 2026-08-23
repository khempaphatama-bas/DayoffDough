import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Logger } from "drizzle-orm/logger";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import type { DatabaseClient } from "@/lib/db/types";

export async function createTestDatabase(options?: Readonly<{
  logger?: Logger;
}>): Promise<{
  db: DatabaseClient;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const testDb = drizzle(client, {
    schema,
    ...(options?.logger ? { logger: options.logger } : {}),
  });
  await migrate(testDb, { migrationsFolder: "drizzle" });
  return {
    db: testDb as unknown as DatabaseClient,
    close: async () => client.close(),
  };
}
