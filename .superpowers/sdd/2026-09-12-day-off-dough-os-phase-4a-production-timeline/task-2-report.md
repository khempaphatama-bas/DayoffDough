# Task 2 Report: Production Database Schema, Migration, and Integrity Guards

## Implementation

Implemented the Phase 4A production database foundation.

- Added owner-scoped, RLS-enabled `production_templates`, `production_template_activities`, `cycle_task_generations`, and `cycle_tasks` Drizzle tables.
- Added the exact production enums sourced from the Task 1 domain literals.
- Added owner-scoped composite foreign keys with `ON DELETE RESTRICT`, named checks, active-template/activity partial unique indexes, and task-generation/task list indexes.
- Generated exactly migration `0012_phase_4a_production_timeline.sql`, snapshot `0012_snapshot.json`, and journal entry 12.
- Added explicit PostgreSQL trigger functions `enforce_cycle_task_generation_snapshot()` and `enforce_cycle_task_lifecycle()` plus their table triggers. The lifecycle trigger rejects hard deletes, prevents lineage mutation, gates task updates/manual writes to the active locked or in-production generation, and permits template generation only during the active OPEN lock transaction.
- Exported all new tables and enums from the application Drizzle schema.

## Files

- `src/modules/production/db/schema.ts`
- `src/modules/production/db/schema.test.ts`
- `src/modules/production/db/schema.integrity.test.ts`
- `src/lib/db/schema.ts`
- `drizzle/0012_phase_4a_production_timeline.sql`
- `drizzle/meta/0012_snapshot.json`
- `drizzle/meta/_journal.json`

## TDD evidence

### RED

The inherited tests were retained because they query actual migrated catalog objects and exercise real constraints/triggers rather than only checking exports.

Requested command (the shell could not resolve `node`):

```sh
pnpm test:run src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts
```

Output:

```text
/node_modules/.bin/vitest: line 41: exec: node: not found
[ELIFECYCLE] Command failed.
```

Equivalent command using the bundled Node runtime:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts
```

Output before production schema/migration existed:

```text
Test Files  2 failed (2)
Tests  4 failed (4)
Failed to resolve import "./schema" from "src/modules/production/db/schema.integrity.test.ts"
expected [] to deeply equal [production columns/indexes/RLS rows]
relation "cycle_task_generations" does not exist
```

Two test repairs were required after the first GREEN attempt, not requirement changes: PGlite exposes trigger exception text through Drizzle's `cause`, so tests now assert that real database cause; and the malformed TEMPLATE fixture now nulls `creationRequestId`, isolating the required `cycle_tasks_lineage_shape` violation instead of also violating `cycle_tasks_creation_request_shape`.

### GREEN

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts
```

Final output:

```text
Test Files  2 passed (2)
Tests  21 passed (21)
```

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
```

Output: exit 0.

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/drizzle-kit/bin.cjs generate --name phase_4a_schema_drift_check
```

Output:

```text
No schema changes, nothing to migrate 😴
```

## Full-suite attempt

Ran the required full command once:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run
```

The run was terminated as a single process with exit 130 after more than ten minutes of continuing but severely resource-starved PGlite execution. It was not a production-schema assertion failure: unrelated files failed broadly while their individual tests took 13–53 seconds, including `planning-commands.test.ts` (21 failures, 484424ms), `planning-queries.test.ts` (17 failures, 399683ms), `cycles.test.ts` (15 failures, 368011ms), and `inventory.test.ts` (8 failures, 215782ms). This matches the pre-existing parallel PGlite contention documented in `progress.md`.

As a focused control after termination:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/inventory/application/inventory.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  8 passed (8)
Duration  34.01s
```

The production focused suite was then rerun and passed again (2 files, 21 tests).

## Self-review

- Verified generated migration is exactly numbered 0012 and the later drift check created no 0013 files.
- Verified each new table has RLS enabled and no policies are created.
- Verified all planned named constraints/indexes and both trigger registrations through migrated PostgreSQL catalogs.
- Verified cross-owner foreign keys, copied snapshot values, immutable task lineage, hard-delete rejection, manual idempotency, status/reason shape, and active-generation lifecycle behavior through real PGlite writes.
- Ran `git diff --check`; no whitespace errors.

## Concerns

- The full parallel Vitest suite remains environment-resource constrained for PGlite-heavy tests. The focused production suite, typecheck, drift check, and a previously failed unrelated suite all pass in isolation. No Task 2 schema or migration failure was observed.

## Fix round 1: immutable task generations

Reviewer finding verified: `enforce_cycle_task_generation_snapshot()` previously accepted `UPDATE` and only validated the replacement row against the replacement snapshot. An existing generation could therefore be rebound to another valid owner-scoped cycle/snapshot, carrying its dependent tasks into different immutable history.

Added a migrated-behavior regression test that creates a second, fully matching active snapshot and attempts exactly that rebind. The test asserts the real database trigger rejects the update with `task generation is immutable`.

### RED

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/db/schema.integrity.test.ts -t "rejects rebinding a task generation to another matching snapshot"
```

Output before the trigger fix:

```text
Test Files  1 failed (1)
Tests  1 failed | 17 skipped (18)
AssertionError: expected undefined to be an instance of Error
```

This means the direct rebind resolved instead of being rejected.

### GREEN

The minimal migration-only change makes every generation identity/history field immutable on update (`id`, `owner_id`, cycle/snapshot binding, generation, copied delivery date/timezone, and `created_at`) while retaining the existing insert snapshot-copy validation.

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/db/schema.integrity.test.ts -t "rejects rebinding a task generation to another matching snapshot"
```

```text
Test Files  1 passed (1)
Tests  1 passed | 17 skipped (18)
```

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts
```

```text
Test Files  2 passed (2)
Tests  22 passed (22)
```

`tsc --noEmit` passed, and `drizzle-kit generate --name phase_4a_task_generation_immutability_drift_check` reported `No schema changes, nothing to migrate`.

Fix commit: `21a89fe fix: make task generations immutable`.
