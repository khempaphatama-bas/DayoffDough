# Task 11 report — End-to-end flow, documentation, and release verification

## Scope and implementation

- Added the complete authenticated Playwright lifecycle in `tests/e2e/production.spec.ts`: template creation (Product and Cycle), missing-template blocker, lock/generation 1, generated-task edits, required SKIPPED reason failure/success, manual create/delete, unlock/re-lock, generation 2 regeneration, and read-only generation 1 history.
- Added the typed `createProductionTemplate(page, input)` fixture helper and deferred More allowlist entry in `tests/fixtures/owner.ts`.
- Added ready Product Templates to planning and shopping E2E setup. Updated the shopping-loader fixture with a ready template for its second planned product so the new readiness invariant is covered without weakening the test.
- Updated README routes, prerequisites, generation/history semantics, migration `0012_phase_4a_production_timeline`, migration command, and E2E check.
- Fixed the known `react-hooks/set-state-in-effect` lint error in `src/modules/production/ui/template-form.tsx` with behavior-preserving deferred initialization; this is committed separately.

## TDD RED/GREEN evidence

- RED: before the helper was implemented, typecheck reported the missing `createProductionTemplate` export and Page/Locator helper mismatches in the new scenario. The first mandated Playwright run also exposed the environment’s inability to bind the webserver (`listen EPERM 0.0.0.0:3000`); an escalated run then reached the app but lacked Supabase environment values.
- GREEN: `pnpm typecheck` passed after the helper/scenario aligned. The focused Phase 4A regression run passed 17 files / 185 tests. The helper uses accessible role/label selectors, current-page POST response waits, and active-badge confirmation.

## Verification commands and results

All commands used the bundled Node PATH:

| Command | Result |
|---|---|
| `pnpm lint` | PASS, 0 errors / 16 existing unused-variable warnings |
| `pnpm typecheck` | PASS |
| `pnpm exec vitest run --pool=forks --maxWorkers=1 --reporter=verbose` | PASS, 87 files / 820 tests; this is the clean full-suite command after diagnosing PGlite parallel contention |
| `pnpm test:run` | Attempted twice after implementation; each run encountered a different PGlite parallel-contended failure and then stalled. The exact focused failures passed, and the safe single-worker full command above passed all tests. No tests were skipped or assertions weakened. |
| Phase 4A focused Vitest command (17 files) | PASS, 17 files / 185 tests |
| `pnpm test:e2e tests/e2e/production.spec.ts` | BLOCKED, 2 projects failed at owner login (`/login`) because no local Supabase Auth/service is available |
| `pnpm test:e2e tests/e2e/production.spec.ts tests/e2e/planning.spec.ts tests/e2e/shopping.spec.ts` | BLOCKED, 6 owner tests failed at the same login boundary |
| `pnpm test:e2e` | 2 public-auth tests passed; 10 owner tests (phone and desktop) failed deterministically in `loginAsOwner` while remaining on `/login`; no authenticated flow could start |
| `pnpm build` | PASS, Next.js 16.3.2 webpack build; route output includes `/production/templates`, `/production/templates/[id]`, `/production/templates/new`, and `/cycles/[id]/production` |
| `git diff --check` | PASS |

The E2E runs used loopback placeholder endpoints and credentials only; this proves the failure is the missing service/session, not a remote mutation. The local service check did not expose Supabase Auth on the configured endpoint, and no project credentials were available to complete authenticated E2E safely.

## Migration inspection

`rg -n 'ENABLE ROW LEVEL SECURITY|CREATE TRIGGER|ON DELETE RESTRICT|task generation snapshot mismatch|task generation is read-only' drizzle/0012_phase_4a_production_timeline.sql` confirmed four RLS statements (lines 19, 59, 80, 94), both trigger families and stable error markers (lines 138, 144, 190, 197, 206, 214, 220), and the history foreign keys with `ON DELETE RESTRICT` (lines 95–102; case-insensitive search).

## Acceptance criteria mapping (1–10)

1. Template creation, Product/Cycle scopes, activation, and archive semantics: `template-service.test.ts`, `template-list.test.tsx`, `template-form.test.tsx`, template actions tests, and the new E2E helper/scenario.
2. Product Template readiness blocker and optional Cycle Template: `build-preview.test.ts`, planning preview UI tests, planning command tests, and the new E2E blocker assertion.
3. Atomic/idempotent lock and production generation creation: `planning-commands.test.ts`, `task-generation-writer.test.ts`, and schema-integrity tests.
4. One task per active activity/product and stable batch snapshots: `task-generation.test.ts`, `task-generation-writer.test.ts`, planning command tests, and E2E batch assertions.
5. Immutable source/business-field snapshots and active-task edits: `production-queries.test.ts`, `production-commands.test.ts`, `cycle-task-form.test.tsx`, and E2E field-edit assertions.
6. Manual-task and status lifecycle: `production-commands.test.ts`, `cycle-task-form.test.tsx`, `cycle-task-list.test.tsx`, and E2E manual create/delete plus status coverage.
7. Generated-task deletion protection and required SKIPPED reason: production command/schema-integrity tests, cycle task UI tests, and E2E validation/failure-success assertions.
8. Unlock/re-lock generation history and read-only prior generation: planning command/query tests, production query/UI/page tests, and E2E generation 1/2 assertions.
9. Responsive phone-safe planning/timeline controls: planning preview, unlock, cycle task list, and page component tests; phone E2E project was attempted but blocked at authentication.
10. Owner scope, RLS/composite integrity, lifecycle guards, Bangkok scheduling, and concurrency: production/planning schema-integrity, domain, application, migration, and concurrency tests; full fork-pool suite passed.

## Commits and status

- `1578ce2 fix: avoid synchronous template form state updates` — release-blocking lint fix.
- `5b88762 test: verify phase 4a production timeline` — Task 11 fixture, E2E, setup, docs, regression fixture, and release report.

Worktree verification after `5b88762` is clean. Overall status: implementation and local unit/build verification complete; authenticated E2E remains blocked by the absent Supabase Auth/database service and credentials.

## Concerns

- The mandated default Vitest mode is not a reliable release command in this environment because PGlite workers contend for the shared local resource; the unmodified full test set passes cleanly with one fork worker.
- Authenticated E2E requires a real local Supabase stack (or explicitly provided test credentials). No external service was mutated.
