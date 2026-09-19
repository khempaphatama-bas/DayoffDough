# Task 12 report — Exact production page heading selector

## Scope and implementation

- Changed only `tests/e2e/production.spec.ts`.
- The production page heading assertion now requests the exact accessible name `Production Timeline` with `exact: true`.
- No production code, waits, timeouts, force options, or assertion weakening were added.
- The other heading assertions in this spec use distinct `รุ่น 2` / `รุ่น 1` regex names and showed no identical ambiguity, so they were left unchanged.

## TDD RED/GREEN evidence

- RED: controller-owned authenticated production-build runs on both phone and desktop had already completed Product/Cycle template creation and activation, cycle lock, task generation, and `/production` navigation, then failed at line 158 because the non-exact locator matched both the exact H1 `Production Timeline` and H2 `ประวัติ Production Timeline` under Playwright strict mode.
- GREEN/static: the selector now targets exactly one heading by accessible name. Authenticated phone/desktop rerun remains controller-owned and is pending after this commit; no local authenticated E2E rerun was required.

## Verification

| Command | Result |
|---|---|
| `pnpm test:e2e tests/e2e/production.spec.ts --list` | PASS — 2 tests discovered: `[phone]` and `[desktop]` |
| `pnpm exec eslint tests/e2e/production.spec.ts` | PASS |
| `pnpm typecheck` | PASS |
| `git diff --check` | PASS |
| `pnpm test:run` | STOPPED after >90s with no test progress; repository history documents the default parallel PGlite contention/stall |
| `pnpm exec vitest run --pool=forks --maxWorkers=1 --reporter=dot` | PASS — 88 files / 826 tests in 250.20s |
| Authenticated `pnpm test:e2e tests/e2e/production.spec.ts` | Pending controller-owned phone/desktop rerun |

## Exact diff

```diff
-  await expect(page.getByRole("heading", { name: "Production Timeline" })).toBeVisible();
+  await expect(
+    page.getByRole("heading", { name: "Production Timeline", exact: true }),
+  ).toBeVisible();
```

## Commit and status

- Base: `961e354`
- Commit: this Task 12 commit (`test: require exact production timeline heading`); final SHA is returned with handoff.
- Worktree status before commit: only this test correction and this report were modified.
