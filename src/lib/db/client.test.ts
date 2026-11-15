// @vitest-environment node

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const ca = readFileSync("certificates/prod-ca-2021.crt", "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("database connection TLS", () => {
  it.each([
    ["multiline", ca],
    ["escaped single-line", ca.trim().replace(/\n/g, "\\n")],
  ])("passes the %s CA directly to PostgreSQL with verification enabled", async (_format, configuredCa) => {
    vi.stubEnv("SUPABASE_DATABASE_URL", "postgresql://shop:example@db.example.com/shop?sslmode=verify-full");
    vi.stubEnv("SUPABASE_DATABASE_CA_PEM", configuredCa);
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");

    const { db } = await import("./client");
    const ssl = db.$client.options.ssl;
    expect(ssl && typeof ssl === "object" && "ca" in ssl && ssl.ca === ca.trim()).toBe(true);
    expect(ssl && typeof ssl === "object" && "rejectUnauthorized" in ssl && ssl.rejectUnauthorized).toBe(true);
    expect(db.$client.options.prepare).toBe(false);
  });

  it("keeps the existing configuration for a local database without a CA", async () => {
    vi.stubEnv("SUPABASE_DATABASE_URL", "postgresql://shop:example@127.0.0.1/shop");
    vi.stubEnv("SUPABASE_DATABASE_CA_PEM", undefined);
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");

    const { db } = await import("./client");
    expect(db.$client.options.ssl).toBe(false);
    expect(db.$client.options.prepare).toBe(false);
  });
});
