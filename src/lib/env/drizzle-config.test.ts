import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

test("Drizzle loads the database URL from .env.local", async () => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "day-off-dough-env-"));
  const originalDirectory = process.cwd();
  const originalDatabaseUrl = process.env.SUPABASE_DATABASE_URL;
  const expectedDatabaseUrl = "postgresql://owner:password@example.test:6543/postgres";

  try {
    await writeFile(
      join(fixtureDirectory, ".env.local"),
      `SUPABASE_DATABASE_URL=${expectedDatabaseUrl}\n`,
    );
    delete process.env.SUPABASE_DATABASE_URL;
    process.chdir(fixtureDirectory);
    vi.resetModules();

    const { default: config } = await import("../../../drizzle.config");

    expect(config).toMatchObject({
      dbCredentials: { url: expectedDatabaseUrl },
    });
  } finally {
    process.chdir(originalDirectory);
    if (originalDatabaseUrl === undefined) {
      delete process.env.SUPABASE_DATABASE_URL;
    } else {
      process.env.SUPABASE_DATABASE_URL = originalDatabaseUrl;
    }
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
