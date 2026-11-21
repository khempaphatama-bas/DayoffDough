import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validatedAdminUrl } from "../helpers/recipe-inventory-postgres.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const admin = "postgres://explicit-user:explicit-pass@127.0.0.1:65431/postgres";
const browser = "postgres://explicit-user:explicit-pass@127.0.0.1:65431/recipe_inventory_test_metadata";
const auth = "http://127.0.0.1:65432/";
const localConfig = "playwright.recipe-inventory.local.config.ts";
const testEnv = {
  PATH: process.env.PATH, FORCE_COLOR: "0", CI: "1",
  PGUSER: "inherited-user", PGUSERNAME: "inherited-username", PGPASSWORD: "inherited-pass",
  RECIPE_INVENTORY_LOCAL_PG_URL: browser,
  RECIPE_INVENTORY_TEST_AUTH_URL: auth,
  RECIPE_INVENTORY_TEST_AUTH_KEY: "synthetic-publishable-key",
  RECIPE_INVENTORY_TEST_OWNER_EMAIL: "fixture@example.invalid",
  RECIPE_INVENTORY_TEST_OWNER_PASSWORD: "synthetic-owner-password",
};

function node(args, env = testEnv) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  assert.ifError(result.error);
  return result;
}

const uncredentialed = (url) => [
  ["no explicit credentials", url.replace("explicit-user:explicit-pass@", "")],
  ["no explicit username", url.replace("explicit-user:", ":")],
  ["no explicit password", url.replace(":explicit-pass@", "@")],
];
const emptyOptions = (url) => [["bare query delimiter", `${url}?`], ["bare fragment delimiter", `${url}#`]];

for (const [reason, url] of [...uncredentialed(admin), ...emptyOptions(admin)]) {
  test(`admin guard rejects ${reason}`, () => {
    assert.throws(() => validatedAdminUrl(url), /RECIPE_INVENTORY_LOCAL_PG_ADMIN_URL/);
  });
}

test("admin guard accepts an explicit credentialed loopback admin URL", () => {
  assert.equal(validatedAdminUrl(admin).href, admin);
});

for (const [name, invalid] of [
  ["RECIPE_INVENTORY_LOCAL_PG_URL", [...uncredentialed(browser), ...emptyOptions(browser)]],
  ["RECIPE_INVENTORY_TEST_AUTH_URL", emptyOptions(auth)],
]) for (const [reason, url] of invalid) {
  test(`isolated config rejects ${reason} for ${name} before application launch`, () => {
    // Importing configuration loads no migration, DB client, Auth, or web server.
    const result = node(["--input-type=module", "-e", `await import("./${localConfig}")`], { ...testEnv, [name]: url });
    assert.equal(result.status, 1, `configuration accepted ${reason}`);
    assert.match(result.stderr, new RegExp(name));
    assert.doesNotMatch(result.stderr, /explicit-pass|inherited-pass|synthetic-owner-password/);
  });
}

test("default Playwright discovery lists legacy files, not the dedicated maintenance spec", () => {
  assert.ok(!readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== ".env.example"),
    "Default discovery must be checked without store .env files");
  const result = node([playwrightCli, "test", "--config=playwright.config.ts", "--list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /master-data\.spec\.ts/);
  assert.doesNotMatch(result.stdout, /recipe-inventory-maintenance\.spec\.ts/);
});

test("dedicated Playwright discovery still lists all maintenance cases on both projects", () => {
  const result = node([playwrightCli, "test", `--config=${localConfig}`, "--list", "tests/e2e/recipe-inventory-maintenance.spec.ts"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[phone\].+recipe-inventory-maintenance\.spec\.ts/);
  assert.match(result.stdout, /\[desktop\].+recipe-inventory-maintenance\.spec\.ts/);
  assert.match(result.stdout, /Total: 6 tests in 1 file/);
});
