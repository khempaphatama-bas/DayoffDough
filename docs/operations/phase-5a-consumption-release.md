# Phase 5A consumption — local verification and release handoff

Actual-shop/shared database migration is **UNAPPLIED**. Applying it requires separate explicit authorization, as do merge, push and deployment. This document does not authorize any of those actions. Local verification uses a disposable PostgreSQL database; existing Supabase is used only for owner login, never as the app-data target.

## Cutover and owner workflow

Migration `0014_phase_5a_consumption` preserves existing cycles as `LEGACY` and makes newly created cycles `CONSUMPTION_V1`. Legacy plans remain read-only for consumption: no historical usage, ledger backfill or guessed historical COUNT ordering is created. Inventory metadata starts at the explicit cutover baseline. Existing planning snapshots and their fingerprints remain unchanged.

For a new V1 cycle: accept preorders, lock the plan, explicitly check initial stock (unless its exact required item set is empty), buy the shortfall, and start production. After baking, the owner separately confirms usage before completing the cycle. Completing tasks or delivering orders does not confirm usage. Planned quantities are estimates, not a claim that the owner measured actual quantities. Only confirmed usage reduces usable stock; over-purchases remain available. A shortage saves nothing and must be resolved before retrying.

Pack and deliver explicitly. All existing work/delivery completion gates still apply. A completed cycle may retain an unpaid balance; the warning remains visible and later payment collection is allowed. There is no reservation, overlapping-production scheduler, out-of-plan usage, final cost/profit, CSV, lot/FIFO, offline or multi-user functionality in this phase.

Cancellation never returns stock automatically. A cancelled started cycle requires an explicit `OWNER_REPORTED` amount for every planned item, initially blank; zero is permitted with a reason. An empty required set requires both explicit confirmations and a reason, not inferred usage or invented inventory rows.

## Counts, settlement and correction

Ordinary physical COUNT is blocked while related started cycles have pending usage. Either record those usages first, or choose the items being physically counted and open a fresh settlement preview. The preview includes the full usage sets of exactly the pending contexts intersecting the counted subset.

Example: count flour after baking while also reporting the same cycle's boxes. Flour receives `COUNT_SETTLED`: its final balance equals the entered physical remainder, not remainder minus usage again. Uncounted boxes receive `DIRECT` usage from their current balance. All included usage and counts commit atomically; an uncounted-item shortage or stale ledger token rolls the entire operation back. Changing selected count items requires a new GET preview. A purchase or other stock change after preview requires explicit refresh and review, not an automatic retry or hidden context expansion.

Corrections require a reason and append immutable history. Before a later COUNT, the correction applies only the difference between old and new usage. Once a new COUNT fence exists, corrections to the earlier usage are `HISTORY_ONLY` and do not change current stock. Use the current physical-count workflow for a present-day stock adjustment. Old revisions and reasons remain visible; they are not overwritten or deleted. Unlock is blocked by pending use and by any context that ever had positive recorded use, even if later corrected to zero.

Quantities are exact nonnegative decimals with at most six decimal places within the supported numeric range; there is no silent float rounding and no negative stock. Source labels/units and required membership come from the locked snapshot.

## Authorized operator prerequisites — before any actual-shop change

1. Obtain separate migration approval for the exact shop target and a planned maintenance window. Stop all writers, including old app versions, imports and background jobs. Do not run a mixed-version cutover.
2. Take a restorable, access-controlled database backup and verify restore procedures. Record the pre-cutover migration journal, schema version, cycle statuses/policies, inventory balances and planning snapshot fingerprints without logging connection strings, credentials or Auth sessions. Investigate existing anomalies; do not silently rewrite their ledger history.
3. Verify the complete forward migration chain `0000` through `0014`, including the previously applied `0001`–`0013` and their journal/hash integrity. Never edit applied migrations, disable guards or seed new cycles with a legacy opt-out. `0014` SQL SHA-256 for this handoff: `6c2e34a87fb53ee10898dd761f7ad9accc515410ea01083e34e33045fb576549`.
4. Review the final branch and its local evidence: full unit suite, phone/desktop authenticated E2E, both real-PostgreSQL race scripts, typecheck, lint, build and diff check. PGlite/serial unit tests are not a substitute for PostgreSQL lock/race proof. Reconfirm the exact deployment artifact and schema compatibility.
5. Only after explicit authorization, apply the complete pending forward chain to that exact approved target. Verify migration receipts/catalog, owned foreign keys/RLS/guards, legacy policies and unchanged historical balances/fingerprints; new V1 defaults must be active. Keep secrets out of logs. Resume writers only after approved smoke checks and a release decision.

No destructive down-migration or automatic deployment is promised. On cutover failure, keep writers stopped, preserve evidence, and use the separately approved recovery/restore or forward-fix procedure. Never erase immutable usage/stock ledger records as cleanup.

## Local coverage and limitations

`tests/e2e/consumption.spec.ts` runs in the existing phone and desktop projects using visible authenticated owner actions, matching same-path action POST responses and re-reading committed values. It covers over-purchase/use balances, successive correction intents, post-count history, cancellation actual/zero use, COUNT blocking, selective flour-count/boxes-DIRECT settlement, atomic shortage rollback, stale-preview refresh, empty-use confirmation, keyboard dialog cancellation/focus, native options and numeric document/form/card viewport bounds. Existing Operations and Production assertions remain; their added V1 stock/use actions do not opt cycles out of the gates.

Rejected saves retain the entered amount, basis, consent, reasons and request identity consistently in the visible controls and submitted draft. Only a new successful receipt resets the controlled usage/settlement intent. Native recipe, template and order options retain their full text while their forms fit the phone viewport.

The sole disclosed master-fixture exception is for the empty-required-set browser case: the current UI insists on at least one positive recipe ingredient. After the UI creates a uniquely named new owned Product/recipe, before any order/planning/context references, a guarded test-only local helper removes only that exact recipe's ingredient. It refuses unsafe targets, wrong identities/versions, references and shared packaging. The subsequent lock, start, confirmations, reason and recorded result all use the real UI. It does not change application behavior, snapshots, triggers, ledger or Auth accounts.

Local Auth/network availability and browser execution remain environmental prerequisites, not permission to bypass authentication or connect app data to the shop. The ignored Task14 execution report records exact commands/results, any genuine RED/GREEN fixes, baseline warnings, owned resources and teardown. Final verification is evidence, not authorization to release.
