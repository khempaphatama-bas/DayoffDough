# Recipe and inventory maintenance: local release checks

These checks cover the recipe/inventory maintenance branch, including the final fixes on top of `76f49c8c9e432e82f9bf71e3dc65ae2c5f999828`. Production Auth, database, deploy, and migrations were not used in these checks.

## Reproduce locally

Use an isolated worktree without a `.env` file (including Next environment variants). Export the following only for test services; do not use store credentials:

- `RECIPE_INVENTORY_LOCAL_PG_ADMIN_URL`: disposable PostgreSQL, in the form `postgres://<test-user>:<test-password>@127.0.0.1:<port>/postgres`; explicit credentials are required, with no query or fragment delimiters.
- `RECIPE_INVENTORY_LOCAL_PG_URL`: same local URL requirements, with an existing disposable database named `recipe_inventory_test_…`. The Playwright server runs the migration chain against this database before booting the app.
- `RECIPE_INVENTORY_TEST_AUTH_URL` and `RECIPE_INVENTORY_TEST_AUTH_KEY`: a loopback HTTP Auth gateway with an explicit port and its test public key. The gateway URL accepts no query, fragment, or URL credentials.
- `RECIPE_INVENTORY_TEST_OWNER_EMAIL` and `RECIPE_INVENTORY_TEST_OWNER_PASSWORD`: one dummy account in that Auth service.

Leave `SUPABASE_DATABASE_CA_PEM` unset. The dedicated Playwright config runs Next on `127.0.0.1:3215` and will not reuse another process. Default Playwright discovery excludes the dedicated maintenance spec. Allocate a fresh disposable database for each browser batch: master-data checks global dashboard readiness; maintenance deliberately creates unpriced tracked items.

```sh
node --test tests/config/recipe-inventory-local.test.mjs
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

- Real PostgreSQL: **17/17** concurrency cases, each with an observed blocked backend and verified committed or rejected result. The two packaging cases prove a stale 50 g rule cannot become 50 kg, and an existing rule prevents changing the unit. The earlier cap negative control exited 1 as expected: two creates left six selectable versions without the guard.
- Local test safety and discovery: **15/15** metadata/URL checks without starting a web server or connecting to a database. Missing credentials and bare URL delimiters are rejected.
- Playwright: **8/8** maintenance and **2/2** master-data cases across phone and desktop, no skips. Maintenance includes same-template reset and duplicate-code retry, the sixth-version archive, a stale packaging form in a second tab that rejects 50 g before a reviewed 0.05 kg save, both production-use paths including empty confirmation, and inventory edit/disable with pointer hit testing.
- Optional legacy consumption Playwright suite: **14/14** across both projects at pre-final-wave commit `ece1a16`, with exact translated stock-unit assertions and all 16 ordered migration hashes verified. It was not rerun in full after `7a6242c`; the final both-device maintenance cases separately exercise the changed recipe retry and packaging-rule paths. One superseded local attempt was interrupted by host sleep; the awake rerun used the same timeouts.
- Final Vitest at reviewed application commit `7a6242c`: **1,643/1,643** in **143 files**, exit 0, no failed or skipped cases, 336.93 seconds on 2026-11-21. Command: `/usr/bin/caffeinate -i pnpm exec vitest run --maxWorkers=2 --reporter=dot`. This replaces the pre-wave 1,634-test baseline. A preceding interrupted run recorded 12 timeout failures and three worker-start timeouts while the power log showed clamshell sleep; no test timeout or application code was changed for the passing repeat.
- TypeScript, lint, and the isolated production build exited 0 on the final wave. Lint reported 16 existing warnings; Node emitted its existing experimental localStorage warning. Whole-branch review and the scoped final-wave review are approved with no open Critical or Important finding.
- The local Operations page logged a pre-existing Thai time-format hydration recovery (`08:00 น.` on Node vs `08:00` in Chromium); it did not prevent production start or usage confirmation. No deployed-site behavior was verified.

## Recorded implementation decisions

1. Used a project-local isolated checkout when the first app-managed checkout was not writable, later resumed in the managed checkout after permissions changed. All original checkouts were preserved. If this placement is unwanted, the cost is transferring the local branch, not shop data.
2. Preserved the approved source plan/spec and copied them into the resumed checkout rather than modifying the original in place. If both copies are maintained later, reconcile the documentation before merging.
3. An empty stock requirement gets a read-only no-stock-required view, not a synthetic count. Existing explicit actual-use confirmation remains. A different empty-round workflow would need UI/lifecycle review, not retrospective ledger edits.
4. Concurrently introduced packaging rules follow the established repeatable-read snapshot rather than forcing an unrelated product timestamp update. Existing snapshots are not retroactively rewritten. Stricter catalog freshness would require an explicit revision/invalidation mechanism.
5. Replaced the resumed implementer when it retained old filesystem permissions, reusing its tests and the completed commits. The cost if unnecessary is extra setup/context, not application behavior.
6. Used separate disposable browser databases for global master-data readiness and intentionally incomplete pricing fixtures. This preserves both assertions; the cost is extra local setup/runs.
7. Added a small shared local PostgreSQL helper and this permanent report instead of duplicating the large harness or leaving evidence only in ignored scratch. Removing this choice would mean a test/documentation refactor, not a feature change.

Production rollout and deployed mobile checks remain outside the authorized local implementation. Existing Operations ICU/lint warnings and pre-existing malformed detail-URL 404 behavior remain separate follow-ups. Archived recipe cards use current catalog names; versioned IDs/units/quantities and locked operational snapshots retain their historical guarantees.

## Production release checklist — separate authorization required

1. Before any production action, obtain approval and agree on the maintenance window, backup, and rollback procedure. Verify that the backup can be restored.
2. Preflight read-only counts for catalog kinds and active states, owner-scoped versions per product, active recipe pointers, and locked snapshot lineage. Identify products over the limit, calculate the expected deterministic archive list, and record baseline stock/history and snapshot integrity.
3. Pause writes from the old app. Apply migration `0015` successfully before deploying code that depends on it; do not let old write paths run between migration and deployment.
4. Verify that products retain at most five selectable versions; active pointers and version payloads are preserved; no active recipe references a disabled item; and previous snapshots, prices, movements, and historical quantities are unchanged. Confirm expected archive counts and migration receipts before restoring normal write access.
5. After deployment, smoke-test sign-in and Thai recipe/inventory controls on a phone. Verify a safe read-only history and prep-only view first; use a separately approved test record for any production write smoke test.
