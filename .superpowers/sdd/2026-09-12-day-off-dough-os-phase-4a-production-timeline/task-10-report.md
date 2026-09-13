# Task 10 report — Navigation and cache integration

## Scope

Implemented only the Task 10 application-navigation and unit-test changes. No E2E More allowlist or `tests/fixtures/owner.ts` changes were made, per the binding preflight ruling.

## TDD evidence

- RED: added coverage for the desktop template route, More active state and copy, cycle current Timeline link, clean current/queried historical generation links, and production revalidation. The focused command failed with 9 intended assertions across 5 files because those destinations, links, and the production revalidation path were absent.
- GREEN: added the minimal route metadata/destination entries, links, and production revalidation path. The focused command passed with 5 files and 24 tests.

## Verification

- Focused RED command: `pnpm test:run src/components/app-shell.test.tsx 'src/app/(app)/more/page.test.tsx' 'src/app/(app)/cycles/[id]/page.test.tsx' src/modules/planning/ui/planning-generation-view.test.tsx 'src/app/(app)/cycles/[id]/planning/actions.test.ts'` — expected RED; 9 failures.
- Focused GREEN command (bundled Node invocation) — PASS, 5 files / 24 tests.
- Task 9/navigation regressions — PASS, 10 files / 60 tests.
- Typecheck (`tsc --noEmit`) — PASS.
- ESLint on all changed application/test files — PASS.
- `git diff --check` — PASS.
- Full suite attempted once; a pre-existing/resource-constrained PGlite shopping failure appeared in `src/modules/shopping/application/load-shopping-source.test.ts` (1 failure, 15.1s), then the runner remained stalled for 60 seconds. Stopped with Ctrl-C, exit code 130. The focused suite was rerun afterward and passed.

## Self-review

- Desktop `/production/templates` route and route metadata added.
- Mobile More recognizes production template descendants as active; More has exact label `เทมเพลตการผลิต` and description `กำหนดขั้นตอนและเวลาเทียบกับวันส่ง`.
- Active cycle detail links to clean `/cycles/:id/production`.
- Planning generation view links current production cleanly and historical production with `?generation=N`.
- Lock/unlock revalidate concrete cycle production alongside existing cycle/planning/orders/dashboard paths.
- Existing template-wide planning invalidation `revalidatePath("/cycles/[id]/planning", "page")` was preserved unchanged.
- Server auth, owner derivation, route Promise contracts, and all binding constraints remain untouched.

Implementation commit: pending
