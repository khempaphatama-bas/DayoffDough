import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import type { DatabaseClient } from "@/lib/db/types";

export async function createTestDatabase(): Promise<{
  db: DatabaseClient;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const testDb = drizzle(client, { schema });
  await migrate(testDb, { migrationsFolder: "drizzle" });
  return {
    db: testDb as unknown as DatabaseClient,
    close: async () => client.close(),
  };
}
