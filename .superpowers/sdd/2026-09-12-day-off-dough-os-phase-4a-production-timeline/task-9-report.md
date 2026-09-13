# Task 9 report — Cycle Production Timeline

## RED evidence

The required focused command initially could not start because the shell had no `node` on PATH (`exec: node: not found`). Re-running with the bundled Node runtime produced the expected missing-module failures for all three new test files (the UI and page files did not yet exist).

## GREEN evidence

- Focused Task 9 command: `15 passed` across `cycle-task-form.test.tsx`, `cycle-task-list.test.tsx`, and `production/page.test.tsx`.
- Task 7–8 production regressions plus Task 9: `50 passed` across six files, including production actions, commands, and queries.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm lint`: blocked by the pre-existing error in `src/modules/production/ui/template-form.tsx:47` (`react-hooks/set-state-in-effect`); new production files had no lint errors. New test action doubles have only unused-parameter warnings.
- Full `pnpm test:run`: stalled after approximately 30 seconds in the unrelated shopping test `src/modules/shopping/application/load-shopping-source.test.ts`, test `aggregates immutable requirements and batches owned operational reads`; the isolated test stalls identically and returns no completion code from the command wrapper.

## Implemented behavior

- Current, history, no-plan, and legacy snapshot timeline states.
- Bangkok-local day grouping and explicit Bangkok wall-clock to UTC conversion for `datetime-local` submissions.
- One accessible article card per task, preserving query order and separating same-name activities.
- Independent per-card edit state; four statuses and conditional skip reason.
- Stable manual `creationRequestId` through failed validation, rotated only after successful creation.
- Pending manual-only soft-delete controls; generated tasks expose no delete control.
- Read-only history hides mutations and includes unlock/re-lock metadata.
- Clean active-generation URL and query-based historical generation links; invalid/cross-owner/missing generation flows use not-found behavior.
- Next 16 promised `params`/`searchParams` route props.

## Self-review and concerns

- Server-side owner derivation and command authorization remain in Task 8 actions; this UI never submits `owner_id`.
- Query-side deterministic ordering and immutable snapshot names remain in Task 7.
- No timezone dependency was added; Bangkok is the sole supported timezone.
- Full-suite confidence is limited by the unrelated shopping-loader stall and repository lint baseline error noted above.

## Fix round 1

### RED evidence

Added regression tests for each review finding. The focused suite failed with four datetime normalization assertions (invalid values were normalized), missing primary-delivery header text, and missing visible field-error feedback. The first run also exposed a duplicate `vi` test import, which was corrected before the production RED run.

### GREEN evidence

- Focused Task 9 suite: `23 passed`.
- Task 7–8 regressions plus Task 9: `58 passed` across six files.
- `pnpm typecheck`: passed.
- Changed-file ESLint: passed with warnings only (unused parameters in test doubles); no changed-file errors.
- `git diff --check`: passed.

### Fixes

- Strictly validate Bangkok date, month/day, hour, and minute components before UTC conversion; invalid retained dates now render safely.
- Show product, batch, duration, and sequence field errors adjacent to controls.
- Show visible quick-status and delete failure alerts.
- Render primary delivery date in the generated timeline header.
- Show unlock/re-lock guidance for both `LOCKED` and `IN_PRODUCTION` generated views.

## Fix round 2

### RED evidence

Added a user-flow regression that dispatches a failed manual creation, then two successful distinct intents. The focused run failed because the second successful intent reused the prior request ID. Added accepted-year round-trip cases; `0001` was observed as `1901` due to `Date.UTC` remapping. The malformed-schedule regression now dispatches the failing action and asserts visible error feedback; lifecycle guidance assertions are container-scoped.

### GREEN evidence

- Focused Task 9 suite: `25 passed`.
- Task 7–8 regressions: `35 passed`.
- `pnpm typecheck`: passed.
- Changed-file ESLint: passed with warnings only (unused parameters in test doubles); no errors.
- `git diff --check`: passed.

### Fixes

- Rotate the manual request ID for every new successful action-state object, with submit-time freshness fallback so consecutive successes cannot reuse an ID.
- Construct years 0001–0099 using `setUTCFullYear` rather than `Date.UTC`'s 1900 offset behavior.
- Strengthened malformed schedule and lifecycle guidance tests to exercise/observe the actual rendered flow.

## Fix round 3

### RED evidence

Added direct formatter round-trip tests for accepted years 0001 and 0099 and a retained historical `datetime-local` form-value test. The focused RED run reproduced the formatter defect: `1-01-01T09:42` instead of `0001-01-01T10:00`, and an empty retained input.

### GREEN evidence

- Focused Task 9 + Task 7–8 regression suite: `62 passed` across six files.
- `pnpm typecheck`: passed.
- Changed-file ESLint: passed with warnings only (unused parameters in test doubles); no errors.
- `git diff --check`: passed.

### Fix

Replaced historical Intl timezone formatting with deterministic fixed UTC+07:00 wall-clock arithmetic, preserving supported datetime-local components and zero-padding four-digit years while retaining safe invalid-input fallback behavior.
