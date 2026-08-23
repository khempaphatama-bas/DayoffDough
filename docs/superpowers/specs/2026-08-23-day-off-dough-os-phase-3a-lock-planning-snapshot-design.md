# Day Off Dough OS — Phase 3A Lock and Planning Snapshot Design

**Date:** 2026-08-23
**Status:** Approved in conversation
**Audience:** Product owner and implementation team

## Goal

Add a trustworthy production-planning boundary to each Bake Cycle. Before locking a cycle, the owner reviews product demand, suggested batches, recipe scaling, material and packaging requirements, and planning cost. Confirming the lock creates one immutable, auditable planning generation in a single transaction.

The design supports the single-owner workflow while preserving enough history and structure for Phase 3B stock and shopping calculations. Unlocking never deletes or rewrites an earlier plan; re-locking creates the next generation.

## Scope

Phase 3A includes:

- a live lock-preview workflow for an `OPEN` Bake Cycle;
- blocking validation and non-blocking warnings;
- suggested full-batch calculation and intentional positive-decimal overrides;
- immutable snapshots of included orders, item prices, products, active recipe versions, inventory prices, packaging rules, and shop costing settings;
- product plans, recipe plans, ingredient requirements, and packaging requirements;
- known and complete planning-cost summaries;
- atomic lock, unlock, and re-lock generation behavior;
- planning-generation history;
- restrictions on production-affecting order and cycle changes while locked;
- owner-scoped authorization, RLS, concurrency controls, and responsive phone/desktop UI;
- automated domain, integration, component, and end-to-end coverage.

## Deferred

The following remain outside Phase 3A:

- physical stock counts and reconciliation;
- stock balances and shortage calculations;
- shopping quantities and suggested purchase packs;
- purchase capture and inventory movements;
- production templates, generated tasks, and timeline execution;
- final actual-cost snapshots, revenue, profit, margin, and CSV export;
- carrier, payment, or social-channel integrations.

Phase 3B will consume the active Phase 3A material and packaging requirements instead of recalculating them from mutable master data.

## Architectural Approach

Use normalized immutable generation tables rather than a replaceable derived plan or a single JSON document. Each successful lock creates `generation = previous maximum + 1` for that owner and cycle. Child rows belong to exactly one planning snapshot and are never reassigned.

Add a focused `planning` module with four boundaries:

- domain calculators accept explicit values and return deterministic plans without database access;
- preview queries gather current owner-scoped inputs and return calculations, blockers, warnings, and an input fingerprint without persisting a snapshot;
- command services perform lock and unlock transactions and are the only write path for planning data;
- read queries return the active generation or an explicitly selected historical generation.

Existing customer, order, cycle, product, recipe, inventory, delivery, settings, and unit modules remain the authorities for their master or operational data. Planning may read those modules but does not mutate them.

## Cycle Lifecycle

The normal path becomes:

```text
DRAFT -> OPEN -> LOCKED -> IN_PRODUCTION -> COMPLETED
```

Only `OPEN` can be previewed and locked. A `DRAFT` cycle must be opened first. `LOCKED` can advance to `IN_PRODUCTION` without creating a new generation.

Unlock is allowed from `LOCKED` and `IN_PRODUCTION`. It requires a non-empty reason and strong confirmation, marks the active generation `SUPERSEDED`, records the status from which it was unlocked, clears the cycle's active snapshot pointer, and returns the cycle to `OPEN` in one transaction. `COMPLETED` and `CANCELLED` cannot be unlocked.

Re-locking creates the next generation; it never updates, deletes, or reactivates an older generation. At most one generation may be `ACTIVE` for a cycle.

While a cycle is `LOCKED` or `IN_PRODUCTION`, the application rejects changes that can alter production inputs, including:

- creating an order in that cycle;
- changing, adding, or removing order items;
- moving an order into or out of the cycle;
- changing delivery method or delivery details used by packaging rules;
- changing production notes copied into the plan;
- cancelling or restoring an order;
- editing the cycle's production, delivery, or cutoff dates.

Amount paid, payment status, and non-cancellation fulfillment progress may change without an unlock because they do not alter the production plan. Master data remains editable globally; an existing planning snapshot is unaffected, and a later generation uses the current master data.

## Data Model

All planning tables use UUID primary keys, `owner_id`, timestamps, owner-scoped indexes, composite owner foreign keys, and RLS policies consistent with the existing modules.

### Existing `bake_cycles` extension

- `locked_at`, nullable;
- `active_planning_snapshot_id`, nullable.

The active pointer is set only after all snapshot rows exist and is cleared on unlock. The database migration adds its owner-scoped foreign key after both sides of the relationship exist. The pointer and the snapshot's `ACTIVE` status must change together in the same transaction.

### `cycle_planning_snapshots`

- `id`;
- `owner_id`;
- `bake_cycle_id`;
- `generation`, positive integer;
- `status`: `ACTIVE | SUPERSEDED`;
- `lock_request_id`, client-generated UUID used for idempotency;
- `input_fingerprint`;
- copied cycle name and key dates;
- copied labor rate, default waste allowance, timezone, and currency;
- `cost_complete`;
- `locked_at`;
- `unlocked_at`, nullable;
- `unlock_reason`, nullable;
- `unlocked_from_status`, nullable: `LOCKED | IN_PRODUCTION`;
- `created_at`.

Constraints enforce unique `(owner_id, bake_cycle_id, generation)`, unique `(owner_id, lock_request_id)`, and at most one `ACTIVE` row per owner and cycle. Unlock metadata is absent while active and required once superseded.

### `cycle_planning_warnings`

One row per warning accepted at lock time. It stores a stable warning code, scope, nullable source entity identifiers, a copied Thai display message, and structured scalar context needed to explain the warning. Blockers are not persisted because a generation cannot be created while blockers exist.

### `cycle_order_snapshots`

One row per included non-cancelled order. It copies the source order and customer identifiers plus customer name, delivery method identifier and name, requested and confirmed delivery dates, delivery location, production-relevant notes, payment and fulfillment status, delivery charges/cost, discount, amount paid, and calculated order totals.

### `cycle_order_item_snapshots`

One row per included order item. It copies the source item and product identifiers, product name, selling unit, ordered quantity, unit price, and line note. The copied item price is historical evidence even though Phase 3A does not calculate profit.

### `cycle_recipe_plans`

One row per planned product. It copies the source recipe and recipe-version identifiers, recipe name, version code, instructions, original base-yield quantity and unit, base yield converted to the product selling unit, labor minutes per batch, utility cost per batch, selected waste allowance, and whether waste came from the recipe or shop default.

### `cycle_product_plans`

One row per product represented by included order items. It stores copied product identity and selling unit, ordered quantity, suggested batch count, selected batch count, optional override reason, planned output, output difference, and the associated recipe plan.

An override reason is required whenever selected and suggested batch counts differ. Selected batch count must be greater than zero. A negative output difference is permitted only as an intentional override and appears as a prominent warning.

### `cycle_inventory_price_snapshots`

One row per inventory item needed by an ingredient or packaging requirement. It copies inventory item name, category, base unit, source price identifier, pack price, pack base quantity, effective timestamp, and exact unit-cost input. When no eligible price exists, the source and price fields remain `NULL`; the row still exists and identifies the missing cost. Zero is a valid recorded price and is distinct from missing data.

### `cycle_material_requirements`

Rows preserve each product plan's contribution by inventory item. Each row stores copied ingredient and inventory identity, quantity per batch in the inventory base unit, selected batch count, base requirement, applied waste percentage, waste quantity, planned requirement, linked price snapshot, and nullable base/waste cost values. Cycle totals are obtained by grouping these immutable contribution rows by inventory item.

### `cycle_packaging_requirements`

Rows preserve each applied packaging-rule contribution. Each row copies rule scope, consumption basis, source product or delivery method, inventory item and base unit, rule quantity, multiplier, planned requirement, linked price snapshot, and nullable cost.

### `cycle_product_cost_snapshots`

One row per product plan stores known ingredient, waste, product-scoped packaging, labor, and utility components; a known subtotal; a nullable complete total; and a completeness flag. Delivery-method packaging is not arbitrarily allocated to products and therefore appears only at cycle level.

### `cycle_cost_snapshots`

One row per planning snapshot stores known base-ingredient, waste, product-packaging, delivery-packaging, labor, and utility totals; known production subtotal; nullable complete production total; distinct missing-inventory-item count; and a completeness flag.

The complete total is `NULL` whenever any required inventory price is missing. The known subtotal remains visible but must always be labeled as partial.

## Planning Calculations

All quantity math uses `decimal.js` and canonical decimal strings. Stored monetary values are integer satang. Calculators keep exact decimal satang internally, round each atomic stored cost component with `ROUND_HALF_UP`, and build higher totals by summing those stored component values so detail and summary always reconcile.

### Product and batch plan

For each product, sum quantities from non-cancelled snapshotted order items:

```text
orderedQuantity = sum(order item quantity)
yieldInSellingUnit = convert(base yield, yield unit, product selling unit)
rawBatchCount = orderedQuantity / yieldInSellingUnit
suggestedBatchCount = ceil(rawBatchCount)
plannedOutput = selectedBatchCount * yieldInSellingUnit
outputDifference = plannedOutput - orderedQuantity
```

The suggested count is always a whole number. The owner may explicitly select any positive decimal batch count and must provide a reason when it differs from the suggestion. Waste allowance does not increase batch count.

### Ingredient requirements

Use recipe-version waste when present; otherwise use the snapshotted shop default:

```text
baseRequirement = ingredientQuantityPerBatch * selectedBatchCount
wasteQuantity = baseRequirement * wasteAllowancePercent / 100
plannedRequirement = baseRequirement + wasteQuantity
```

Recipe ingredient quantities are already expressed in each inventory item's base unit. Requirements for the cycle are grouped only after product-level contributions have been retained.

### Packaging requirements

- `PRODUCT + PER_PRODUCT_UNIT`: rule quantity multiplied by planned output in the product selling unit;
- `PRODUCT + PER_ORDER`: rule quantity multiplied by the distinct included-order count containing that product;
- `DELIVERY_METHOD + PER_DELIVERY`: rule quantity multiplied by the included-order count using that delivery method.

An order counts once for a rule even if the same product appears in more than one line.

### Cost

For every required inventory item, select the latest price whose `effective_at <= locked_at`, ordered deterministically by effective time and then creation/id. Calculate:

```text
unitCost = packPriceSatang / packBaseQuantity
baseIngredientCost = baseRequirement * unitCost
wasteCost = wasteQuantity * unitCost
packagingCost = plannedPackagingRequirement * unitCost
laborCost = laborMinutesPerBatch * selectedBatchCount * laborRateSatangPerHour / 60
utilityCost = utilityCostSatangPerBatch * selectedBatchCount
```

Waste cost is represented through waste quantity and is never added a second time. Product display may derive cost per selected batch, planned output unit, and ordered unit from complete product cost only. Missing prices never become zero and never produce a supposedly complete per-unit cost.

## Preview and Lock Data Flow

### Preview

`buildPlanningPreview(ownerId, cycleId)` reads current source data, validates it, calculates the plan, and returns:

- blockers;
- warnings;
- product, recipe, material, packaging, and cost previews;
- a deterministic input fingerprint.

Preview persists nothing. The fingerprint is a SHA-256 hash of a canonical representation of all production-relevant cycle, order, order-item, product, recipe, ingredient, packaging-rule, inventory-price, and shop-setting values used by the calculation. Display ordering does not affect the hash.

Batch overrides exist only in browser form state until confirmation. They are not part of the source fingerprint; the confirmation payload contains selected counts and required reasons, and the server validates and recalculates them.

### Confirm lock

The confirmation payload contains `cycleId`, `inputFingerprint`, `lockRequestId`, and product batch overrides. The server runs a repeatable-read transaction:

1. derive and verify the owner from the authenticated session;
2. acquire a row lock on the Bake Cycle;
3. return the already-created snapshot for a repeated `lockRequestId`;
4. require current status `OPEN` and no active generation;
5. re-read authoritative source data and recompute blockers, warnings, plan, and fingerprint;
6. reject stale preview data when fingerprints differ;
7. validate and apply batch overrides, then recompute all downstream requirements and costs;
8. choose `max(generation) + 1` while the cycle row remains locked;
9. insert the parent snapshot and every normalized child row;
10. set the snapshot active, set the cycle pointer and `locked_at`, and change the cycle to `LOCKED`;
11. commit.

Any failure rolls back every insert and state change. Concurrent order mutations use the same cycle-row locking protocol, so they cannot pass between the authoritative re-read and commit. A master-data edit that commits after the repeatable-read snapshot begins does not alter the values captured by that lock generation.

If the fingerprint changed, return the Thai recovery message `ข้อมูลรอบเปลี่ยนแล้ว กรุณาตรวจสอบแผนอีกครั้ง` and a fresh preview. No snapshot is written.

### Unlock

The unlock command receives cycle ID, non-empty reason, and explicit confirmation. In one transaction it locks the cycle, verifies status `LOCKED` or `IN_PRODUCTION`, locks the active snapshot, marks it `SUPERSEDED`, records unlock metadata, clears the active pointer and `locked_at`, and changes the cycle to `OPEN`.

Unlock never deletes child rows. A failed unlock rolls back without changing the cycle or snapshot.

## Validation and Warnings

### Blocking errors

Lock confirmation is rejected when any of the following is true:

- the cycle is not `OPEN` or lacks its primary delivery date;
- there are no non-cancelled orders;
- an included order has no items;
- an ordered product has no active recipe version;
- recipe base yield is missing or not positive;
- recipe yield unit and product selling unit have different dimensions or no supported conversion;
- an ingredient quantity is not strictly positive or otherwise invalid;
- a selected batch count is not positive;
- a selected batch differs from the suggestion without a non-empty reason.

Database checks already prevent several invalid master values, but lock validation remains defensive because it is the historical planning boundary.

### Non-blocking warnings

The preview warns, but permits owner confirmation, for:

- a missing eligible inventory price;
- an `UNPAID` or `PARTIAL` included order;
- missing delivery information required by the selected delivery method;
- requested or confirmed delivery date differing from the cycle's primary delivery date;
- a selected batch override that produces less than ordered quantity.

Warnings are recalculated inside the lock transaction and copied into the snapshot in structured form so the locked-generation view can explain what the owner accepted.

## User Experience

The cycle detail page adds a primary `ตรวจแผนและล็อกรอบ` action for `OPEN` cycles. It opens a phone-first planning page, expected at `/cycles/[id]/planning`, with:

1. blockers and warnings at the top;
2. one product card per plan showing ordered quantity, suggested and selected batches, planned output, and surplus/shortfall;
3. an override-reason field revealed when the selected count differs;
4. expandable ingredient and packaging summaries;
5. known-cost and completeness summaries with a prominent `ต้นทุนไม่สมบูรณ์` badge when needed;
6. a sticky confirmation action on small screens.

Blockers disable confirmation. Warnings require no extra acknowledgement beyond the normal final lock confirmation. Duplicate submissions are disabled client-side, while the request ID remains the authoritative server-side idempotency guard.

For `LOCKED` and `IN_PRODUCTION` cycles, the same planning page reads the active immutable generation and displays its generation number, locked time, completeness badge, product plans, requirement summaries, costs, and accepted warnings. A history selector opens superseded generations read-only.

Unlock requires a non-empty reason and typing the confirmation word `ปลดล็อก`. When unlocking from `IN_PRODUCTION`, the copy states clearly that current production tracking will return to planning state.

On locked-cycle order pages, production-affecting fields become read-only and explain that the cycle must be unlocked first. Payment controls and allowed fulfillment transitions remain available.

## Error Handling

- Shared schemas validate preview overrides and command payloads at browser and server boundaries.
- Server validation and authenticated owner scope are authoritative.
- Field errors appear next to batch count or reason inputs and preserve form state.
- Stale previews return a fresh preview and never partially persist a snapshot.
- Duplicate `lockRequestId` requests return the existing successful result rather than creating a generation.
- Database or serialization failures produce a safe Thai retry message; detailed diagnostics remain server-side and exclude credentials.
- Missing or inaccessible cycles return the same not-found outcome to avoid leaking cross-owner identifiers.

## Security and Integrity

- Every planning route, query, and command requires the verified owner session and configured owner email.
- `owner_id` is derived server-side and is never accepted from browser input.
- Every source query and snapshot write is owner-scoped.
- Composite owner foreign keys prevent cross-owner snapshot relationships.
- RLS is enabled on all planning tables as defense in depth.
- Child snapshot rows expose no general update or delete operation; only the controlled unlock transaction may update parent snapshot status and unlock metadata.
- Production-affecting order and cycle services acquire the applicable cycle row lock before checking state and writing.
- No database URL, service-role key, or sensitive diagnostic is exposed to the browser.

## Testing Strategy

### Domain tests

- whole-number suggested batch rounding and positive-decimal overrides;
- output surplus and shortfall;
- same-dimension yield conversion and incompatible-unit rejection;
- recipe and shop-default waste selection;
- ingredient and all three packaging-rule calculations;
- distinct-order counting for product packaging;
- effective-price selection at the lock timestamp;
- satang rounding and detail-to-summary reconciliation;
- missing-price propagation without zero substitution;
- product and cycle cost completeness.

### Application and database tests

- preview persists nothing and produces a stable canonical fingerprint;
- lock writes a complete normalized generation atomically;
- a mid-transaction failure leaves the cycle `OPEN` with no partial generation;
- stale fingerprints are rejected;
- repeated request IDs are idempotent;
- concurrent lock attempts create at most one active generation;
- order mutation and lock commands serialize on the cycle row;
- locked-state restrictions allow payment updates but reject production-impacting changes and cancellation;
- unlock from `LOCKED` and `IN_PRODUCTION` records a reason and preserves all child rows;
- unlock from `COMPLETED` and `CANCELLED` is rejected;
- re-lock creates the next generation and preserves prior generations;
- edits to products, recipes, prices, settings, and packaging rules do not change an existing snapshot;
- RLS and composite ownership constraints reject cross-owner access.

### UI and end-to-end tests

On phone and desktop viewports:

1. open a cycle with multiple orders and products;
2. review suggested batches, requirements, warnings, and costs;
3. override a batch and verify reason enforcement and output difference;
4. lock and verify the immutable active generation;
5. verify locked order restrictions and allowed payment progress;
6. unlock with strong confirmation and reason;
7. change an order, re-lock, and verify generation history;
8. verify a missing inventory price shows incomplete cost but does not block lock.

The delivery gate is passing lint, typecheck, unit/integration tests, production build, database migration checks, and phone/desktop Playwright E2E tests.

## Acceptance Criteria

Phase 3A is complete when:

- an `OPEN` cycle can be previewed without persistence and locked atomically;
- blockers stop locking and warnings remain explicitly visible;
- suggested batches round up and any override is positive, deliberate, and explained;
- recipe scaling, waste, material, and packaging requirements are correct in base units;
- planning costs use effective price history and snapshotted labor/utility settings;
- missing prices produce incomplete, nullable costs and never silently become zero;
- the active planning generation remains unchanged when master data changes;
- unlock preserves history and re-lock creates a strictly increasing generation;
- locked and in-production cycles reject production-affecting order changes;
- completed and cancelled cycles cannot be unlocked;
- owner isolation and concurrency invariants hold at service and database layers;
- the complete workflow is usable and tested on phone and desktop;
- no Phase 3B stock, shortage, shopping, purchase, or movement behavior is introduced.
