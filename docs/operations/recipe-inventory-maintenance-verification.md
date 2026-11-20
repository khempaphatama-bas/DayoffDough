# Recipe and inventory maintenance: local release checks

The application under test is `8bf9f7f835a39da547cc14c69007beddc0d5b3d3` plus this verification-only change. Production Auth, database, deploy, and migrations were not used in these checks.

## Reproduce locally

Use an isolated worktree without a `.env` file (including Next environment variants). Export the following only for test services; do not use store credentials:

- `RECIPE_INVENTORY_LOCAL_PG_ADMIN_URL`: disposable PostgreSQL, in the form `postgres://…@127.0.0.1:<port>/postgres`, with no connection options.
- `RECIPE_INVENTORY_LOCAL_PG_URL`: same local service, with an existing disposable database named `recipe_inventory_test_…`. The Playwright server runs the migration chain against this database before booting the app.
- `RECIPE_INVENTORY_TEST_AUTH_URL` and `RECIPE_INVENTORY_TEST_AUTH_KEY`: a loopback HTTP Auth gateway with an explicit port and its test public key.
- `RECIPE_INVENTORY_TEST_OWNER_EMAIL` and `RECIPE_INVENTORY_TEST_OWNER_PASSWORD`: one dummy account in that Auth service.

Leave `SUPABASE_DATABASE_CA_PEM` unset. Playwright runs Next on `127.0.0.1:3215` and will not reuse another process. Allocate a fresh disposable database for each browser batch: master-data checks global dashboard readiness; maintenance deliberately creates unpriced tracked items.

```sh
node --test tests/postgres/recipe-inventory-concurrency.test.mjs
pnpm exec playwright test --config=playwright.recipe-inventory.local.config.ts --project=phone --project=desktop tests/e2e/master-data.spec.ts
pnpm exec playwright test --config=playwright.recipe-inventory.local.config.ts --project=phone --project=desktop tests/e2e/recipe-inventory-maintenance.spec.ts
# Optional legacy regression: use another fresh disposable database.
pnpm exec playwright test --config=playwright.recipe-inventory.local.config.ts --project=phone --project=desktop tests/e2e/consumption.spec.ts
pnpm exec vitest run --maxWorkers=2 --reporter=dot
pnpm typecheck
pnpm lint
git diff --check
```

For `pnpm build`, map the validated local test values to `SUPABASE_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `OWNER_EMAIL`. Do not use a store `.env` as a shortcut.

To prove the cap test detects the missing product lock, run this expected failure with the same isolated admin target. It replaces just the recipe-create lock in temporary compiled test modules and does not change application source:

```sh
RECIPE_INVENTORY_PG_CONTROL=omit-recipe-create-product-lock node --test --test-name-pattern="sixth and seventh" tests/postgres/recipe-inventory-concurrency.test.mjs
```

## Verified locally

- Real PostgreSQL: **15/15** concurrency cases, each with an observed blocked backend and verified committed or rejected result. The negative control exited 1 as expected: two creates left six selectable versions without the guard.
- Playwright: **6/6** maintenance and **2/2** master-data cases across phone and desktop, no skips. The maintenance checks include same-template draft reset, the sixth-version archive, both production-use paths including explicit empty confirmation, and save/disable actions that pass pointer hit testing.
- Optional legacy consumption Playwright suite: **14/14** across both projects with exact translated stock-unit assertions and all 16 ordered migration hashes verified. One superseded local attempt was interrupted by host sleep; the awake rerun used the same timeouts.
- Vitest: **1,634/1,634** in 140 files with two workers. TypeScript, lint, and the isolated production build exited 0. Lint reported 16 existing warnings outside the touched tests.
- The local Operations page logged a pre-existing Thai time-format hydration recovery (`08:00 น.` on Node vs `08:00` in Chromium); it did not prevent production start or usage confirmation. No deployed-site behavior was verified.

## Production release checklist — separate authorization required

1. Before any production action, obtain approval and agree on the maintenance window, backup, and rollback procedure. Verify that the backup can be restored.
2. Preflight read-only counts for catalog kinds and active states, owner-scoped versions per product, active recipe pointers, and locked snapshot lineage. Identify products over the limit, calculate the expected deterministic archive list, and record baseline stock/history and snapshot integrity.
3. Pause writes from the old app. Apply migration `0015` successfully before deploying code that depends on it; do not let old write paths run between migration and deployment.
4. Verify that products retain at most five selectable versions; active pointers and version payloads are preserved; no active recipe references a disabled item; and previous snapshots, prices, movements, and historical quantities are unchanged. Confirm expected archive counts and migration receipts before restoring normal write access.
5. After deployment, smoke-test sign-in and Thai recipe/inventory controls on a phone. Verify a safe read-only history and prep-only view first; use a separately approved test record for any production write smoke test.
