# Task 5 Report: Planning Source, Fingerprint, and Template Blocker

## Implementation summary

Planning now loads owner-scoped active production templates and active activities for the cycle's ordered products, requires exactly one ready active Product Template (with at least one active activity) for every planned product, and treats Cycle Templates as optional. Missing readiness emits the stable `MISSING_PRODUCT_TEMPLATE` issue with product context and a `/production/templates` link; the existing lock disablement follows the blocker list. Fingerprinting includes canonical template/activity content with deterministic ordering, so meaningful active template edits invalidate the fingerprint while source-array reordering does not.

The shared planning fixture now seeds one deterministic active Product Template and activity, keeping prior planning tests focused on their original behavior.

## TDD evidence

### RED

Added tests before implementation for:

- product plans without a ready Product Template;
- active templates with zero activities;
- optional Cycle Templates;
- active activity time changes and template/activity reorder stability in fingerprints;
- owner-scoped active template/activity loading with inactive activities excluded;
- blocker link rendering in Planning Preview.

Command:

```sh
PATH=/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm test:run src/modules/planning/domain/build-preview.test.ts src/modules/planning/domain/fingerprint.test.ts src/modules/planning/application/planning-queries.test.ts src/modules/planning/ui/planning-preview-form.test.tsx
```

Result: 5 intended failures across the new behaviors (missing blocker, empty-activity readiness, fingerprint activity edit, source template loading, and UI link rendering), while the pre-existing tests ran.

### GREEN

Focused command:

```sh
PATH=/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm test:run src/modules/planning/domain/build-preview.test.ts src/modules/planning/domain/fingerprint.test.ts src/modules/planning/application/planning-queries.test.ts src/modules/planning/ui/planning-preview-form.test.tsx
```

Result: `4 passed` test files, `57 passed` tests.

Planning module command:

```sh
PATH=/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm test:run src/modules/planning
```

Result: `15 passed` test files, `241 passed` tests.

Typecheck and whitespace checks:

```sh
PATH=/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm typecheck
git diff --check
```

Result: both completed successfully.

## Full-suite attempt

Ran once:

```sh
PATH=/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm test:run
```

The run remained resource-starved under parallel PGlite execution. It reported unrelated failures in `src/modules/shopping/application/load-shopping-source.test.ts` (2), `src/modules/products/application/products.test.ts` (1), `src/modules/orders/db/order-item-lifecycle-migration.test.ts` (1), and `src/modules/planning/db/planning-order-delivery-requirement-migration.test.ts` (1), then was terminated after bounded polling with exit 130. No Task 5 planning domain, query, or UI test failed in this run.

## Self-review

- Production source queries derive owner scope from the verified owner argument and filter templates/activities by `active = true`.
- Template and activity output is ordered by template ID, sequence, and activity ID; activity times are normalized to `HH:mm`.
- Product readiness checks use active Product Templates with at least one active activity and emit one stable product-scoped blocker whenever the ready count is not exactly one.
- Fingerprints include cycle templates and ordered-product templates, while canonicalizing all required template/activity fields and excluding `calculatedAt` as before.
- The lock action remains disabled whenever blockers exist; blocker context renders a direct management link.
- `git diff --check` passed before commit.

## Concerns

The full repository suite remains affected by the existing parallel PGlite resource contention. The focused Task 5 suite, complete planning module suite, and typecheck are green.

## Commit

`0cbf25a974d67b631e4e7ff747abfb3f54ffe6bd` (`feat: require production templates before planning lock`)
