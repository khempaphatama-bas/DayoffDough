# Phase 4A final fix wave report

## Test runtime note

The shell PATH did not expose Node, so `pnpm test:run …` initially exited with `node: not found`. All subsequent JavaScript checks used the workspace-bundled Node executable directly:

```text
/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

This runs the same installed Vitest, TypeScript, ESLint, Next.js, and Playwright packages without changing dependencies.

## RED evidence

```text
<bundled-node> node_modules/vitest/vitest.mjs run \
  src/modules/production/ui/template-form.test.tsx \
  src/modules/production/ui/template-list.test.tsx \
  src/modules/production/domain/task-generation.test.ts \
  src/modules/production/ui/cycle-task-list.test.tsx \
  src/modules/production/ui/cycle-task-form.test.tsx
```

Result: exit 1; 5 expected failures and 40 existing tests passed.

- `TemplateForm` lacked `template-save-action` and phone reserve/sticky treatment.
- `scheduleTaskAt` rejected literal years `0001` and `0099` during calendar validation.
- Timeline headings remapped those years to `2444` and `2542`.
- The confirmation dialog rendered at `z-10`, not above shell chrome at `z-40`.
- The adjusted request-ID tests passed while waiting on the real validation error and enabled submit state; this is a test-race correction, not a product behavior change.

## GREEN evidence

Focused combined command above after the minimal source changes: exit 0; 5 files and 45 tests passed.

Per-area focused runs:

| Command target | Outcome |
| --- | --- |
| `template-form.test.tsx` | exit 0; 5 tests passed |
| `task-generation.test.ts` + `cycle-task-list.test.tsx` | exit 0; 21 tests passed |
| `template-list.test.tsx` | exit 0; 6 tests passed |
| `cycle-task-form.test.tsx` | exit 0; 13 tests passed |

`<bundled-node> node_modules/@playwright/test/cli.js test tests/e2e/production.spec.ts --list` exited 0 and discovered the lifecycle test for both `phone` and `desktop` projects. The authenticated state-writing rerun remains for the controller environment.

`<bundled-node> node_modules/vitest/vitest.mjs run src/modules/production` exited 0: 12 files and 128 tests passed.

`<bundled-node> node_modules/typescript/bin/tsc --noEmit` exited 0.

`<bundled-node> node_modules/eslint/bin/eslint.js .` exited 0 with 16 pre-existing unused-variable warnings and no errors.

`<bundled-node> node_modules/next/dist/bin/next build --webpack` exited 0 and generated the Phase 4A production routes successfully.

`git diff --check` exited 0 before the preservation commit.

## Pending rerun

The first full single-worker command, `<bundled-node> node_modules/vitest/vitest.mjs run --maxWorkers=1`, was intentionally stopped after 3 minutes 30 seconds with no test output (exit 130) so the verified source/test changes could be preserved in a commit. It must be rerun from that commit and this report updated with the actual outcome.
