# Task 7 Report: Cycle Production Query Service and Legacy Modes

## Implementation summary

Added the owner-scoped production query service and the exact production view
union/types. The service resolves a selected planning snapshot, reports legacy
snapshots without a persisted timeline as an explicit empty mode, classifies
only an active snapshot/current pointer on a `LOCKED` or `IN_PRODUCTION` cycle
as `CURRENT`, and returns every other generated timeline as `HISTORY`.

Generated task snapshots retain their stored source/product names. Active
product options are loaded separately, soft-deleted manual tasks are omitted,
and returned tasks are sorted by scheduled time, sequence, product name, and
stable task ID. Invalid, missing, and cross-owner requests use the same
`Production generation not found` error.

## TDD evidence

### RED

Command:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/production-queries.test.ts
```

Result: the suite failed during import because
`src/modules/production/application/production-queries.ts` did not exist.

### GREEN

Focused query suite:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/production-queries.test.ts
```

Result: `1 passed` test file, `11 passed` tests.

Production/planning regressions:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/modules/production/application/production-queries.test.ts src/modules/production/domain/task-generation.test.ts src/modules/production/application/task-generation-writer.test.ts src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts src/modules/planning/application/planning-queries.test.ts src/modules/planning/application/planning-commands.test.ts
```

Result: `7 passed` test files, `90 passed` tests.

Static checks:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/modules/production/application/production-queries.ts src/modules/production/application/production-queries.test.ts src/modules/production/domain/types.ts
git diff --check
```

All completed successfully.

## Full-suite attempt

Ran once:

```sh
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run
```

The parallel PGlite run stalled for approximately 120 seconds. Before
interruption, unrelated suites reported failures in
`src/modules/shopping/application/load-shopping-source.test.ts`,
`src/modules/planning/db/schema.test.ts`, and
`src/modules/orders/application/orders.test.ts`; no query-service failure was
reported. The process was interrupted with Ctrl-C (exit 130). This matches the
existing repository-wide parallel PGlite resource limitation documented by
earlier Phase 4A reports.

## Self-review

- Every database read is owner- and cycle-scoped; child task reads also include
  owner and generation ownership.
- Invalid UUIDs, invalid generation numbers, missing cycles, cross-owner cycles,
  and missing explicit generations share one non-disclosing not-found outcome.
- Omitted generation returns `NO_PLAN` only when the cycle has no active pointer;
  a pointer to a pre-Phase-4A snapshot without a task generation returns
  `LEGACY_SNAPSHOT`.
- `CURRENT` requires snapshot `ACTIVE`, matching cycle active pointer, and cycle
  status `LOCKED` or `IN_PRODUCTION`; all other generated views are `HISTORY`.
- Snapshot cycle names/numbers and task source/product names come from immutable
  snapshot rows, while product options come from active current products.
- Deleted rows are excluded with `deleted_at IS NULL`; task ordering uses all
  required deterministic keys and the stable task ID tie-breaker.
- No production command, lifecycle, schema, or unrelated module was changed.

## Concerns

The full-suite parallel PGlite runner remains resource-starved; the focused
production/planning regressions and static checks pass.

## Commit

 `e2f0deaaa6bcbf51be3b2e35d0dd81985580b987`
