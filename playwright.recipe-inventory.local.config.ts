import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("./", import.meta.url));
const baseURL = "http://127.0.0.1:3215";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for isolated recipe/inventory testing`);
  return value;
}

function loopback(name: string, protocol: string, path: RegExp) {
  let url: URL;
  try { url = new URL(required(name)); } catch { throw new Error(`${name} must be an explicit local test URL`); }
  if (url.protocol !== protocol || url.hostname !== "127.0.0.1" || !url.port || Number(url.port) < 1
    || !path.test(url.pathname) || url.search || url.hash || (protocol === "http:" && (url.username || url.password))) {
    throw new Error(`${name} must identify the intended disposable loopback service with an explicit port`);
  }
  return url;
}

const database = loopback("RECIPE_INVENTORY_LOCAL_PG_URL", "postgres:", /^\/recipe_inventory_test_[a-z0-9_]+$/);
const auth = loopback("RECIPE_INVENTORY_TEST_AUTH_URL", "http:", /^\/$/);
const key = required("RECIPE_INVENTORY_TEST_AUTH_KEY");
const email = required("RECIPE_INVENTORY_TEST_OWNER_EMAIL");
const password = required("RECIPE_INVENTORY_TEST_OWNER_PASSWORD");

// Next would load these independently of Playwright. Do not even launch with
// potentially store-owned environment files present in the test worktree.
if (readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== ".env.example")) {
  throw new Error("Run this config from an isolated worktree without .env files");
}
delete process.env.SUPABASE_DATABASE_CA_PEM;
const testEnv = {
  RECIPE_INVENTORY_LOCAL_PG_URL: database.href,
  SUPABASE_DATABASE_URL: database.href,
  NEXT_PUBLIC_SUPABASE_URL: auth.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  OWNER_EMAIL: email,
  E2E_OWNER_EMAIL: email,
  E2E_OWNER_PASSWORD: password,
  E2E_ISOLATED_LOCAL_DATABASE: "1",
  E2E_LOCAL_DATABASE_PORT: database.port,
};
Object.assign(process.env, testEnv);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["recipe-inventory-maintenance.spec.ts", "master-data.spec.ts", "consumption.spec.ts"],
  outputDir: "./test-results/recipe-inventory",
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm exec drizzle-kit migrate && pnpm exec next dev --hostname 127.0.0.1 --port 3215",
    cwd: root,
    env: testEnv,
    timeout: 90_000,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
