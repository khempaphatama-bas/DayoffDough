# Task 11 report — End-to-end flow, documentation, and release verification

## Scope and implementation

- Added the complete authenticated Playwright lifecycle in `tests/e2e/production.spec.ts`: template creation (Product and Cycle), missing-template blocker, lock/generation 1, generated-task edits, required SKIPPED reason failure/success, manual create/delete, unlock/re-lock, generation 2 regeneration, and read-only generation 1 history.
- Added the typed `createProductionTemplate(page, input)` fixture helper and deferred More allowlist entry in `tests/fixtures/owner.ts`.
- Added ready Product Templates to planning and shopping E2E setup. Updated the shopping-loader fixture with a ready template for its second planned product so the new readiness invariant is covered without weakening the test.
- Updated README routes, prerequisites, generation/history semantics, migration `0012_phase_4a_production_timeline`, migration command, and E2E check.
- Fixed the known `react-hooks/set-state-in-effect` lint error in `src/modules/production/ui/template-form.tsx` with behavior-preserving deferred initialization; this is committed separately.

## TDD RED/GREEN evidence

- RED: after the controller exposed the configured environment and applied migration 0012, authenticated production E2E reached the app and failed on both phone and desktop because `getByLabel("สินค้า")` matched both the scope select and Product select. Review also reproduced four vacuous proof gaps: deleting the only manual task before re-lock, not checking generation-1 content, not asserting persisted edit fields/product, and omitting the Cycle Template task assertion.
- GREEN/local: changed Product Template lookup to an exact accessible label, added explicit replacement-dialog confirmation, retained one manual task while deleting a separate one, changed and re-read the product plus every editable field, asserted Cycle Template output, and asserted generation-1 title/notes/skip reason. `pnpm typecheck` passed and the focused Phase 4A regression run passed 17 files / 185 tests.

## Verification commands and results

All commands used the bundled Node PATH:

| Command | Result |
|---|---|
| `pnpm lint` | PASS, 0 errors / 16 existing unused-variable warnings |
| `pnpm typecheck` | PASS |
| `pnpm exec vitest run --pool=forks --maxWorkers=1 --reporter=verbose` | PASS, 87 files / 820 tests; this is the clean full-suite command after diagnosing PGlite parallel contention |
| `pnpm test:run` | Attempted twice after implementation; each run encountered a different PGlite parallel-contended failure and then stalled. The exact focused failures passed, and the safe single-worker full command above passed all tests. No tests were skipped or assertions weakened. |
| Phase 4A focused Vitest command (17 files) | PASS, 17 files / 185 tests |
| `pnpm db:migrate` | PASS per controller evidence; migration `0012_phase_4a_production_timeline` applied to the configured Supabase database before the authenticated RED run |
| `pnpm test:e2e tests/e2e/production.spec.ts` (authenticated pre-fix run) | RED on both phone and desktop at the ambiguous `getByLabel("สินค้า")` selector in `tests/fixtures/owner.ts`; this is the confirmed application-test finding fixed in this round |
| `pnpm test:e2e tests/e2e/production.spec.ts` (post-fix attempt) | BLOCKED after the configured service went offline; the run reached a cycle page, then planning navigation stalled. Subsequent loopback checks returned connection refused for ports 54321 and 54322, and the approval guard rejected remote authenticated mutation against the symlinked `.env.local` target |
| planning + shopping targeted E2E and full `pnpm test:e2e` | NOT rerun post-fix because the authenticated Supabase target was unavailable; no safe local replacement exists |
| `pnpm build` | PASS, Next.js 16.3.2 webpack build; route output includes `/production/templates`, `/production/templates/[id]`, `/production/templates/new`, and `/cycles/[id]/production` |
| `git diff --check` | PASS |

The pre-fix E2E run used the already-authorized configured environment and proved authentication/schema startup before exposing the selector RED. The post-fix run could not complete after the service disappeared; no remote retry or mutation was attempted once the target could not be verified.

## Migration inspection

`rg -ni 'ENABLE ROW LEVEL SECURITY|CREATE TRIGGER|ON DELETE RESTRICT|task generation snapshot mismatch|task generation is read-only' drizzle/0012_phase_4a_production_timeline.sql` confirmed four RLS statements (lines 19, 59, 80, 94), both trigger families and stable error markers (lines 138, 144, 190, 197, 206, 214, 220), and all history foreign keys with lowercase `ON DELETE restrict` (lines 95–102).

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
- `91e31db test: confirm production template activation in e2e` — confirms the replacement-activation dialog when present.

`next-env.d.ts` was restored to the tracked `.next/types` references after Next dev/build generation. Final status is clean after the report commit below. Overall status: fix-round implementation and local unit/build verification complete; authenticated E2E remains blocked by the currently unavailable configured Supabase service after the pre-fix selector RED was isolated.

## Concerns

- The mandated default Vitest mode is not a reliable release command in this environment because PGlite workers contend for the shared local resource; the unmodified full test set passes cleanly with one fork worker.
- Authenticated E2E requires the configured Supabase stack to be online; the last safe checks showed both loopback database/API ports unavailable, and remote mutation retry was rejected because the symlinked target could not be verified.
