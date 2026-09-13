# Task 6 Report: Atomic Task Generation in Planning Lock

## Implementation summary

Planning lock now persists the production task generation and generated tasks in the same repeatable-read transaction as the planning snapshot. The writer expands immutable template/activity and planning-product snapshots, preserves cycle-level and product-level task records separately, and returns a generation summary. Planning command construction accepts a server-side writer dependency for rollback testing while defaulting to the production writer; no Server Action or browser input is involved.

## Files changed

- `src/modules/production/application/task-generation-writer.ts`
- `src/modules/production/application/task-generation-writer.test.ts`
- `src/modules/planning/application/planning-commands.ts`
- `src/modules/planning/application/planning-commands.test.ts`

## TDD evidence

### RED

Command:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.test.ts
```

Before implementation, the new writer suite failed because `./task-generation-writer` did not exist. The new planning tests also failed because locking returned no task generation and the injected writer was never called: one test dereferenced an absent generation and the rollback test resolved instead of rejecting.

### GREEN

Focused writer + planning command:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.test.ts
```

Result: `2 passed` test files, `24 passed` tests.

Additional focused production domain/schema command:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/domain src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts
```

Result: `4 passed` test files, `55 passed` tests.

Planning module command:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/planning
```

Result: `14 passed` test files, `242 passed` tests, with one known parallel PGlite timeout in `src/modules/planning/db/planning-order-delivery-requirement-migration.test.ts`. The same test passed in isolation:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/planning/db/planning-order-delivery-requirement-migration.test.ts
```

Result: `1 passed` test file, `1 passed` test.

Typecheck and lint/whitespace checks:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/modules/production/application/task-generation-writer.ts src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.ts src/modules/planning/application/planning-commands.test.ts
git diff --check
```

All completed successfully.

## Full-suite attempt

Ran once:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run
```

Under parallel PGlite load, unrelated suites accumulated long-running failures/timeouts, including shopping, inventory, products, cycles, orders migration, and production schema integrity. The runner was still active after repeated 30-second polls and was stopped with Ctrl-C, exit code `130`. The production focused suite and isolated planning migration control pass.

## Self-review

- Writer runs after `persistPlanningSnapshot` and before cycle status/active-pointer update, inside the existing repeatable-read transaction.
- Existing `lockRequestId` early return is unchanged, so retry returns the original planning snapshot and does not call the writer again.
- Generation sequencing remains the planning snapshot sequence; generation rows copy primary delivery date/timezone and carry owner-scoped immutable lineage.
- Cycle Template activities and Product Template activities create independent records, including same-name activities; product tasks copy authoritative product name and selected batch count from the planning result.
- Re-lock tests verify latest template activity names are used and previous task edits/manual rows are not copied into generation 2.
- Injected writer failure rolls back planning rows and leaves the cycle `OPEN` with no active pointer.
- No owner ID is accepted from browser/action inputs; the seam is an internal application dependency only.
- `git diff --check`, focused tests, production integrity tests, typecheck, and lint passed.

## Concerns

The full Vitest suite remains resource-starved when many PGlite databases run concurrently. This is an existing runner/environment constraint; affected migration/integrity tests pass in isolation or in focused suites.

## Commit

Implementation commit:

`9fd746a feat: generate cycle tasks during planning lock`

## Fix round 1

### Findings verified

- Repeated-lock coverage previously counted planning rows only; it did not count `cycle_task_generations` or `cycle_tasks`.
- The writer accepted an empty draft set regardless of whether planned products or an active Cycle Template required tasks.
- The existing injected failure happened before the writer, so it did not prove rollback after production rows had been inserted.

### RED

Added tests before the implementation guard:

- repeated lock now counts one task generation and one generated task in addition to planning rows;
- an empty generation with no planned products and no active Cycle Template is allowed;
- an empty generation with a planned product but no matching task template is rejected before generation insertion;
- a writer wrapper inserts the generation/tasks, then throws, and the test counts all planning and production tables plus cycle `OPEN`/null pointer state.

Focused command before the guard:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.test.ts
```

Result: `1 failed`, `26 passed`; the invalid-empty test resolved with a generation instead of throwing `Task generation has no tasks`. The idempotency and post-production rollback tests passed, proving the assertions exercise existing behavior rather than mocks.

### GREEN

Moved draft expansion before generation insertion and rejected zero drafts when product plans exist or an active Cycle Template is supplied. The valid empty case remains a generation with zero tasks. The production writer seam remains internal and the later-failure wrapper demonstrates transaction rollback after both generation and task inserts.

Focused command after the guard:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.test.ts
```

Result: `2 passed` test files, `27 passed` tests.

Regression command:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/domain src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts
```

Result: `4 passed` test files, `55 passed` tests.

Typecheck, lint, and `git diff --check` all passed.

### Fix-round commits

- `1d548d3 fix: harden atomic task generation`
- Report update follows in the documentation commit.
