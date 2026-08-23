# Day Off Dough OS Phase 3A Lock and Planning Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bakery owner preview production calculations, atomically lock an immutable planning generation, preserve unlock/re-lock history, and use trustworthy recipe, material, packaging, and cost snapshots.

**Architecture:** Add a normalized owner-scoped `planning` module to the existing Next.js modular monolith. Keep decimal calculations, validation, warning generation, and canonical fingerprinting in pure TypeScript; keep source loading and transactional snapshot persistence in focused application services; expose the workflow through authenticated Server Actions and phone-first Server/Client Components.

**Tech Stack:** Node.js 24.x, pnpm 11.x, Next.js 16.3 App Router, React 19, TypeScript strict mode, Tailwind CSS 4, Supabase Auth and PostgreSQL, Drizzle ORM 0.45, Zod 4, Decimal.js 10, Vitest, Testing Library, PGlite, Playwright.

**Spec:** docs/superpowers/specs/2026-08-23-day-off-dough-os-phase-3a-lock-planning-snapshot-design.md

## Global Constraints

- The primary user is one bakery owner; do not add registration, roles, teams, or public write endpoints.
- Only an `OPEN` Bake Cycle can be previewed and locked. `DRAFT` must become `OPEN` first.
- Every successful lock creates a normalized immutable generation; never replace or delete an earlier generation.
- Unlock is allowed only from `LOCKED` and `IN_PRODUCTION`, requires the exact confirmation word `ปลดล็อก` plus a non-empty reason, marks the active generation `SUPERSEDED`, and returns the cycle to `OPEN`.
- `COMPLETED` and `CANCELLED` cycles cannot be unlocked.
- Store quantities and conversion inputs as exact canonical decimals with at most six decimal places; use Decimal.js for all arithmetic.
- Store money as integer satang. Round atomic cost components with Decimal.js `ROUND_HALF_UP`, guard PostgreSQL integer range, and sum stored components for totals.
- Missing inventory prices do not block locking. Persist nullable cost fields, a missing-price record, and `costComplete = false`; never substitute zero.
- A recorded zero price is valid and must remain distinct from a missing price.
- Material and packaging requirements use inventory base units. Unit conversion is allowed only within `mass`, `volume`, or `count`; never infer density conversion.
- Suggested batch count is `ceil(ordered / converted base yield)`. An override must be a positive decimal and needs a reason whenever it differs from the suggestion.
- Use one primary delivery date per Bake Cycle.
- Production-affecting order and cycle writes must serialize on the cycle row and are allowed only in `DRAFT` or `OPEN`. `LOCKED` and `IN_PRODUCTION` require unlock first; terminal cycles reject those writes permanently. Payment changes and non-cancellation fulfillment progress remain allowed.
- Every Server Action must call `requireOwner`. Every service read and write must scope by the verified `ownerId`; never accept `ownerId` from the browser.
- Enable Row Level Security on every new planning table and add no anonymous or general Data API policy.
- Use composite owner foreign keys for cross-table relationships, including the active snapshot pointer added after both related tables exist.
- Keep database credentials server-only and do not add database or service-role values to `NEXT_PUBLIC_*` variables.
- Phase 3A must not count stock, calculate shortages, suggest purchase packs, record purchases, create inventory movements, create production tasks, or calculate profit.
- Do not add payment, social-channel, KEX, delivery-carrier, or webhook integrations.
- Next.js 16 `params` and `searchParams` are Promises and must be awaited.
- Pages and database reads remain Server Components. Add `use client` only to interactive planning, unlock, status, and error-state components.
- Model expected Server Action failures as serializable return values. Call `redirect` only after `try/catch` because redirect throws a framework control-flow exception.
- Support Pixel 7 and desktop layouts. Keep primary phone controls at least 44px high and the lock action reachable above bottom navigation.
- Use TDD for every business and persistence rule. Do not change production code before observing the relevant test fail.
- Do not commit credentials, read or print `.env.local`, or run E2E against production Supabase.

---

## File Map

### Database

- Modify `src/modules/cycles/db/schema.ts` — add `lockedAt` and `activePlanningSnapshotId`.
- Create `src/modules/planning/db/schema.ts` — planning enums and eleven normalized snapshot tables.
- Create `src/modules/planning/db/schema.test.ts` — generation, owner boundary, active-row, nullable-cost, and unlock-metadata constraints.
- Modify `src/lib/db/schema.ts` — export every planning enum/table for Drizzle and PGlite.
- Generate `drizzle/0005_phase_3a_planning_snapshots.sql`, `drizzle/meta/0005_snapshot.json`, and update `drizzle/meta/_journal.json`.

### Domain

- Create `src/modules/planning/domain/types.ts` — source, issue, preview, plan, requirement, price, and cost contracts shared across planning units.
- Create `src/modules/planning/domain/batch-plan.ts` and `batch-plan.test.ts` — yield conversion, suggested batches, overrides, and output difference.
- Create `src/modules/planning/domain/material-requirement.ts` and `material-requirement.test.ts` — waste-source selection and ingredient scaling.
- Create `src/modules/planning/domain/packaging-requirement.ts` and `packaging-requirement.test.ts` — the three approved packaging bases and distinct-order counts.
- Create `src/modules/planning/domain/costing.ts` and `costing.test.ts` — price application, satang rounding, known subtotals, and completeness propagation.
- Create `src/modules/planning/domain/build-preview.ts` and `build-preview.test.ts` — orchestration, blockers, warnings, and downstream recalculation after overrides.
- Create `src/modules/planning/domain/fingerprint.ts` and `fingerprint.test.ts` — canonical source serialization and SHA-256 hashing.
- Create `src/modules/planning/domain/lock-form.ts` and `lock-form.test.ts` — shared Zod schema for lock overrides and unlock confirmation.

### Application

- Create `tests/fixtures/planning.ts` — deterministic PGlite planning scenario used by application tests.
- Create `src/modules/planning/application/load-source.ts` — narrowly load the current cycle, orders, recipes, rules, required inventory items, and effective prices.
- Create `src/modules/planning/application/planning-queries.ts` and `planning-queries.test.ts` — read-only preview and immutable generation queries.
- Create `src/modules/planning/application/snapshot-writer.ts` — insert one complete normalized generation inside an existing transaction.
- Create `src/modules/planning/application/planning-commands.ts` and `planning-commands.test.ts` — repeatable-read lock, idempotency, stale detection, rollback, unlock, and generation progression.
- Modify `src/lib/db/row-locks.ts` — deterministic cycle locking helpers used by planning and order mutations.
- Modify `src/modules/cycles/application/cycles.ts` and `cycles.test.ts` — Phase 3A lifecycle and metadata-edit restrictions.
- Modify `src/modules/orders/application/orders.ts` and `orders.test.ts` — cycle-first serialization and locked-cycle mutation restrictions.

### Server Actions and UI

- Create `src/app/(app)/cycles/[id]/planning/actions.ts` and `actions.test.ts` — authenticated lock/unlock actions and safe Thai outcomes.
- Create `src/app/(app)/cycles/[id]/planning/page.tsx` and `page.test.tsx` — route-level preview/active/history selection.
- Create `src/modules/planning/ui/planning-preview-form.tsx` and `planning-preview-form.test.tsx` — batch override form, warning/blocker cards, stale refresh, and sticky lock action.
- Create `src/modules/planning/ui/planning-generation-view.tsx` and `planning-generation-view.test.tsx` — immutable generation details and cost-completeness display.
- Create `src/modules/planning/ui/unlock-cycle-form.tsx` and `unlock-cycle-form.test.tsx` — reason and typed confirmation.
- Modify `src/app/(app)/cycles/[id]/page.tsx`, `cycle-detail.tsx`, and `page.test.tsx` — planning entry point and active generation badge.
- Modify `src/modules/cycles/ui/cycle-status-form.tsx` and `cycle-status-form.test.tsx` — allowed Phase 3A transitions without manual `LOCKED` selection.
- Modify `src/modules/cycles/ui/cycle-form.tsx` and `cycle-form.test.tsx` — read-only cycle inputs outside `DRAFT`/`OPEN`.
- Modify `src/app/(app)/orders/[id]/page.tsx` and `page.test.tsx` — locked-cycle explanation and edit-mode selection.
- Modify `src/modules/orders/ui/order-form.tsx` and `order-form.test.tsx` — payment-only editing when production inputs are frozen.
- Modify `src/modules/orders/ui/order-status-actions.tsx` and `order-status-actions.test.tsx` — hide cancellation when the cycle is production-frozen.
- Modify `src/app/(app)/orders/actions.ts` and `actions.test.ts` — specific frozen-cycle Thai errors and planning-page revalidation.

### End-to-end and documentation

- Modify `tests/fixtures/owner.ts` — reusable inventory-unit and packaging-rule helpers.
- Create `tests/e2e/planning.spec.ts` — phone/desktop lock, incomplete cost, unlock, re-lock, read-only order, and history workflow.
- Modify `README.md` — Phase 3A capabilities, lifecycle, tables, and Phase 3B boundary.

---

### Task 1: Normalized planning schema and migration

**Files:**

- Modify: `src/modules/cycles/db/schema.ts`
- Create: `src/modules/planning/db/schema.ts`
- Create: `src/modules/planning/db/schema.test.ts`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0005_phase_3a_planning_snapshots.sql`
- Create: `drizzle/meta/0005_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**

- Produces: `planningSnapshotStatus`, `planningWarningScope`, and `wasteAllowanceSource` readonly arrays plus their PostgreSQL enums.
- Produces: `cyclePlanningSnapshots`, `cyclePlanningWarnings`, `cycleOrderSnapshots`, `cycleOrderItemSnapshots`, `cycleRecipePlans`, `cycleProductPlans`, `cycleInventoryPriceSnapshots`, `cycleMaterialRequirements`, `cyclePackagingRequirements`, `cycleProductCostSnapshots`, and `cycleCostSnapshots`.
- Produces: nullable `bakeCycles.lockedAt` and `bakeCycles.activePlanningSnapshotId`.
- Consumes: all existing owner-scoped master and operational tables.

- [ ] **Step 1: Write the failing schema integration tests**

Create `src/modules/planning/db/schema.test.ts`. Start with a valid cycle and parent generation, then assert one active generation is accepted, a second active generation for the same cycle is rejected, a child row cannot reference another owner's snapshot, a missing price uses `NULL` rather than zero, and a superseded row requires unlock metadata.

~~~ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryItems } from "@/modules/inventory/db/schema";
import {
  cycleInventoryPriceSnapshots,
  cyclePlanningSnapshots,
  cyclePlanningWarnings,
} from "./schema";

describe("Phase 3A planning schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  it("allows one owner-scoped active generation with missing price data", async () => {
    const [cycle] = await context.db.insert(bakeCycles).values({
      ownerId: OWNER_ID,
      name: "รอบส่ง 30 ส.ค.",
      status: "OPEN",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    }).returning();
    const [snapshot] = await context.db.insert(cyclePlanningSnapshots).values({
      ownerId: OWNER_ID,
      bakeCycleId: cycle!.id,
      generation: 1,
      status: "ACTIVE",
      lockRequestId: "11111111-1111-4111-8111-111111111111",
      inputFingerprint: "a".repeat(64),
      cycleNumber: cycle!.cycleNumber,
      cycleName: cycle!.name,
      targetProductionDate: cycle!.targetProductionDate,
      primaryDeliveryDate: cycle!.primaryDeliveryDate,
      laborRateSatangPerHour: 12000,
      defaultWasteAllowancePercent: "3",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: false,
      lockedAt: new Date("2026-08-23T03:00:00Z"),
    }).returning();
    const [item] = await context.db.insert(inventoryItems).values({
      ownerId: OWNER_ID,
      name: "แป้ง",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000",
    }).returning();
    const [price] = await context.db.insert(cycleInventoryPriceSnapshots).values({
      ownerId: OWNER_ID,
      planningSnapshotId: snapshot!.id,
      inventoryItemId: item!.id,
      inventoryItemName: "แป้ง",
      inventoryCategory: "INGREDIENT",
      baseUnit: "g",
    }).returning();
    expect(price).toMatchObject({ packPriceSatang: null, unitCostSatang: null });
  });
});
~~~

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

~~~bash
pnpm test:run -- src/modules/planning/db/schema.test.ts
~~~

Expected: FAIL because the planning schema and cycle snapshot columns do not exist.

- [ ] **Step 3: Define the exact schema contract**

Use these enums exactly:

~~~ts
export const planningSnapshotStatus = ["ACTIVE", "SUPERSEDED"] as const;
export const planningWarningScope = [
  "CYCLE", "ORDER", "PRODUCT", "INVENTORY_ITEM",
] as const;
export const wasteAllowanceSource = ["RECIPE", "SHOP_DEFAULT"] as const;
~~~

Use UUID primary keys, `ownerId`, `createdAt`, unique `(ownerId, id)`, owner-scoped indexes, `onDelete("restrict")`, `numeric(18, 6)` for quantities, `numeric(7, 4)` for percentages, `numeric(24, 12)` for fractional unit cost, and `integer` for satang and counts. Define the exact table columns below:

- `cyclePlanningSnapshots`: cycle id, positive generation, status, lock request UUID, 64-character fingerprint, copied cycle number/name/cutoff/production/delivery dates, copied labor/default-waste/timezone/currency, `costComplete`, lock time, nullable unlock time/reason/from-status.
- `cyclePlanningWarnings`: snapshot id, stable code, scope, nullable source entity UUID, copied Thai message, and `jsonb` scalar context defaulting to `{}`.
- `cycleOrderSnapshots`: snapshot/source order/source customer ids, copied customer and delivery method names, source channel, delivery dates/location/note/special instructions, payment and fulfillment status, fee payer, fee/cost/discount/paid/subtotal/grand-total/balance satang.
- `cycleOrderItemSnapshots`: snapshot/order-snapshot/source-item/source-product ids, copied product name/selling unit, positive quantity, unit price, and line note.
- `cycleRecipePlans`: snapshot/source product/recipe/version ids, copied recipe name/version/instructions, original base yield/unit, yield converted to selling unit, selling unit, labor minutes, utility satang, waste percent, and waste source.
- `cycleProductPlans`: snapshot/source product/recipe-plan ids, copied product name/selling unit, ordered quantity, positive whole suggested batches, positive selected decimal batches, nullable override reason, planned output, and signed output difference.
- `cycleInventoryPriceSnapshots`: snapshot/inventory-item ids, copied name/category/base unit, nullable source price id/pack price/pack quantity/effective time/unit cost. Add an all-null-or-all-present price check.
- `cycleMaterialRequirements`: snapshot/product-plan/recipe-plan/source-ingredient/inventory-item/price-snapshot ids, copied item name/base unit, quantity per batch, selected batches, base requirement, waste percent/quantity, planned requirement, nullable base and waste cost satang.
- `cyclePackagingRequirements`: snapshot, nullable product plan, source rule, scope, basis, nullable source product/delivery method, copied target/item/base-unit values, price snapshot, rule quantity, multiplier, planned requirement, and nullable cost satang.
- `cycleProductCostSnapshots`: snapshot/product-plan ids, known ingredient/waste/product-packaging/labor/utility values, known subtotal, nullable complete total, and completeness boolean.
- `cycleCostSnapshots`: snapshot id, known ingredient/waste/product-packaging/delivery-packaging/labor/utility values, known production subtotal, nullable complete total, distinct missing-item count, and completeness boolean.

Add checks for positive quantities/generation, non-negative money, the selected/suggested override-reason invariant, active-versus-superseded unlock metadata, cost completeness versus nullable complete total, and packaging scope-target validity. Add unique keys for snapshot/source order, snapshot/source item, snapshot/product, snapshot/recipe plan, snapshot/inventory item, snapshot/product-cost product plan, and the one cycle-cost row per snapshot. Add a partial unique index that permits at most one `ACTIVE` generation for `(ownerId, bakeCycleId)`.

In `bakeCycles`, add:

~~~ts
lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
activePlanningSnapshotId: uuid("active_planning_snapshot_id"),
~~~

Export every enum and table from `src/lib/db/schema.ts`.

- [ ] **Step 4: Generate and inspect migration 0005**

Run:

~~~bash
pnpm exec drizzle-kit generate --name=phase_3a_planning_snapshots
~~~

Expected: `drizzle/0005_phase_3a_planning_snapshots.sql`, its metadata snapshot, and journal entry.

After generated table creation, add the circular active-pointer constraint explicitly:

~~~sql
ALTER TABLE "bake_cycles" ADD CONSTRAINT "bake_cycles_owned_active_planning_snapshot_fk"
FOREIGN KEY ("owner_id", "active_planning_snapshot_id")
REFERENCES "cycle_planning_snapshots" ("owner_id", "id")
ON DELETE RESTRICT;
~~~

Enable RLS exactly once on all eleven new planning tables. Do not add broad policies. Inspect that every child-to-parent and source reference includes `owner_id` and that the partial active-generation unique index is present.

- [ ] **Step 5: Complete constraint coverage and run tests**

Extend the initial test to insert the second owner and assert cross-owner warning insertion rejects, duplicate active generation rejects, `SUPERSEDED` without `unlockedAt`, `unlockReason`, and `unlockedFromStatus` rejects, and `costComplete = false` with a non-null complete total rejects.

Run:

~~~bash
pnpm test:run -- src/modules/planning/db/schema.test.ts
pnpm typecheck
pnpm db:migrate
~~~

Expected: schema tests and typecheck pass, and migration 0005 applies to the configured development database without printing its URL.

- [ ] **Step 6: Commit**

~~~bash
git add src/modules/cycles/db/schema.ts src/modules/planning/db/schema.ts src/modules/planning/db/schema.test.ts src/lib/db/schema.ts drizzle
git commit -m "feat: add planning snapshot schema"
~~~

### Task 2: Pure batch and ingredient requirement calculations

**Files:**

- Create: `src/modules/planning/domain/types.ts`
- Create: `src/modules/planning/domain/batch-plan.ts`
- Create: `src/modules/planning/domain/batch-plan.test.ts`
- Create: `src/modules/planning/domain/material-requirement.ts`
- Create: `src/modules/planning/domain/material-requirement.test.ts`

**Interfaces:**

- Produces: `calculateBatchPlan(input: BatchPlanInput): ProductBatchPlan`.
- Produces: `resolveWasteAllowance(recipePercent, shopPercent): WasteSelection`.
- Produces: `calculateMaterialRequirement(input: MaterialRequirementInput): MaterialRequirementCalculation`.
- Consumes: `convertQuantity` and `UnitCode` from the existing units module.

- [ ] **Step 1: Write failing batch-plan tests**

~~~ts
import { describe, expect, it } from "vitest";
import { calculateBatchPlan } from "./batch-plan";

describe("planning batch calculation", () => {
  it("rounds the suggestion up and preserves an intentional decimal override", () => {
    expect(calculateBatchPlan({
      orderedQuantity: "10",
      baseYieldQuantity: "6",
      yieldUnit: "piece",
      sellingUnit: "piece",
      selectedBatchCount: "1.5",
    })).toEqual({
      orderedQuantity: "10",
      yieldInSellingUnit: "6",
      suggestedBatchCount: 2,
      selectedBatchCount: "1.5",
      plannedOutput: "9",
      outputDifference: "-1",
    });
  });

  it("converts same-dimension yield and rejects cross-dimension yield", () => {
    expect(calculateBatchPlan({
      orderedQuantity: "2",
      baseYieldQuantity: "1500",
      yieldUnit: "g",
      sellingUnit: "kg",
    }).suggestedBatchCount).toBe(2);
    expect(() => calculateBatchPlan({
      orderedQuantity: "2",
      baseYieldQuantity: "1",
      yieldUnit: "kg",
      sellingUnit: "piece",
    })).toThrow("Incompatible yield unit");
  });
});
~~~

- [ ] **Step 2: Write failing material tests**

~~~ts
import { describe, expect, it } from "vitest";
import {
  calculateMaterialRequirement,
  resolveWasteAllowance,
} from "./material-requirement";

describe("material requirement", () => {
  it("uses recipe waste and scales base plus waste quantities", () => {
    expect(resolveWasteAllowance("10", "3")).toEqual({
      percent: "10", source: "RECIPE",
    });
    expect(calculateMaterialRequirement({
      quantityPerBatch: "1000",
      selectedBatchCount: "1.5",
      wasteAllowancePercent: "10",
    })).toEqual({
      baseRequirement: "1500",
      wasteQuantity: "150",
      plannedRequirement: "1650",
    });
  });

  it("falls back to shop waste and rejects non-positive ingredient quantity", () => {
    expect(resolveWasteAllowance(null, "3")).toEqual({
      percent: "3", source: "SHOP_DEFAULT",
    });
    expect(() => calculateMaterialRequirement({
      quantityPerBatch: "0",
      selectedBatchCount: "1",
      wasteAllowancePercent: "3",
    })).toThrow("Ingredient quantity must be greater than zero");
  });
});
~~~

- [ ] **Step 3: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/domain/batch-plan.test.ts src/modules/planning/domain/material-requirement.test.ts
~~~

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 4: Implement focused decimal calculators**

Define these public contracts in `types.ts`:

~~~ts
export type BatchPlanInput = Readonly<{
  orderedQuantity: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  sellingUnit: UnitCode;
  selectedBatchCount?: string;
}>;
export type ProductBatchPlan = Readonly<{
  orderedQuantity: string;
  yieldInSellingUnit: string;
  suggestedBatchCount: number;
  selectedBatchCount: string;
  plannedOutput: string;
  outputDifference: string;
}>;
export type WasteSelection = Readonly<{
  percent: string;
  source: "RECIPE" | "SHOP_DEFAULT";
}>;
export type MaterialRequirementInput = Readonly<{
  quantityPerBatch: string;
  selectedBatchCount: string;
  wasteAllowancePercent: string;
}>;
export type MaterialRequirementCalculation = Readonly<{
  baseRequirement: string;
  wasteQuantity: string;
  plannedRequirement: string;
}>;
~~~

`calculateBatchPlan` converts base yield into selling units, validates every decimal is finite/positive with at most six places, uses `ceil()` only for the suggestion, rejects a suggestion above PostgreSQL integer range, defaults selected count to the suggestion, and returns canonical strings with no insignificant zeroes. `calculateMaterialRequirement` allows waste from zero through 100 with at most four decimal places and performs no binary floating-point conversion.

- [ ] **Step 5: Run focused and unit regression tests**

~~~bash
pnpm test:run -- src/modules/planning/domain/batch-plan.test.ts src/modules/planning/domain/material-requirement.test.ts src/modules/units/domain/units.test.ts
pnpm typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/modules/planning/domain/types.ts src/modules/planning/domain/batch-plan.ts src/modules/planning/domain/batch-plan.test.ts src/modules/planning/domain/material-requirement.ts src/modules/planning/domain/material-requirement.test.ts
git commit -m "feat: calculate production batches and materials"
~~~

### Task 3: Pure packaging and incomplete-cost calculations

**Files:**

- Modify: `src/modules/planning/domain/types.ts`
- Create: `src/modules/planning/domain/packaging-requirement.ts`
- Create: `src/modules/planning/domain/packaging-requirement.test.ts`
- Create: `src/modules/planning/domain/costing.ts`
- Create: `src/modules/planning/domain/costing.test.ts`

**Interfaces:**

- Produces: `calculatePackagingRequirement(input): PackagingRequirementCalculation`.
- Produces: `roundAtomicSatang(value: Decimal.Value): number` and `calculateRequirementCost(quantity: string, price: RequirementPrice): number | null`.
- Produces: `calculateLaborCost(laborMinutesPerBatch, selectedBatchCount, laborRateSatangPerHour): number` and `calculateUtilityCost(utilityCostSatangPerBatch, selectedBatchCount): number`.
- Produces: `calculateProductCost(input: ProductCostInput): ProductCostCalculation` and `calculateCycleCost(input: CostSummaryInput): CycleCostCalculation`.
- Consumes: canonical decimal strings from Task 2 and `calculateUnitCostSatang` from inventory cost domain.

- [ ] **Step 1: Write failing packaging tests**

~~~ts
import { describe, expect, it } from "vitest";
import { calculatePackagingRequirement } from "./packaging-requirement";

describe("packaging requirements", () => {
  it.each([
    ["PER_PRODUCT_UNIT", "0.5", "9", 0, "4.5"],
    ["PER_ORDER", "1", "0", 2, "2"],
    ["PER_DELIVERY", "2", "0", 3, "6"],
  ] as const)("calculates %s", (basis, ruleQuantity, plannedOutput, orderCount, expected) => {
    expect(calculatePackagingRequirement({
      basis,
      ruleQuantity,
      plannedOutput,
      distinctOrderCount: orderCount,
    })).toEqual({ multiplier: basis === "PER_PRODUCT_UNIT" ? plannedOutput : String(orderCount), plannedRequirement: expected });
  });
});
~~~

- [ ] **Step 2: Write failing cost-completeness tests**

~~~ts
import { describe, expect, it } from "vitest";
import {
  calculateLaborCost,
  calculateCycleCost,
  calculateRequirementCost,
  calculateUtilityCost,
  roundAtomicSatang,
} from "./costing";

describe("planning cost", () => {
  it("rounds each atomic component half up", () => {
    expect(roundAtomicSatang("10.5")).toBe(11);
    expect(calculateRequirementCost("1650", {
      packPriceSatang: 5500, packBaseQuantity: "1000",
    })).toBe(9075);
    expect(calculateLaborCost(30, "1.5", 12000)).toBe(9000);
    expect(calculateUtilityCost(2000, "1.5")).toBe(3000);
  });

  it("keeps known subtotal but nulls complete total when a price is missing", () => {
    expect(calculateCycleCost({
      baseIngredientCosts: [8250, null],
      wasteCosts: [825, null],
      productPackagingCosts: [90],
      deliveryPackagingCosts: [],
      laborCosts: [9000],
      utilityCosts: [3000],
      missingInventoryItemIds: ["22222222-2222-4222-8222-222222222222"],
    })).toEqual({
      knownBaseIngredientCostSatang: 8250,
      knownWasteCostSatang: 825,
      knownProductPackagingCostSatang: 90,
      knownDeliveryPackagingCostSatang: 0,
      laborCostSatang: 9000,
      utilityCostSatang: 3000,
      knownProductionCostSatang: 21165,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 1,
    });
  });

  it("treats a recorded zero price as complete", () => {
    expect(calculateRequirementCost("10", {
      packPriceSatang: 0, packBaseQuantity: "100",
    })).toBe(0);
  });
});
~~~

- [ ] **Step 3: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/domain/packaging-requirement.test.ts src/modules/planning/domain/costing.test.ts
~~~

Expected: FAIL because packaging and planning-cost modules do not exist.

- [ ] **Step 4: Implement exact packaging and cost contracts**

Add these core types:

~~~ts
export type RequirementPrice = Readonly<{
  packPriceSatang: number;
  packBaseQuantity: string;
}> | null;
export type PackagingRequirementCalculation = Readonly<{
  multiplier: string;
  plannedRequirement: string;
}>;
export type PackagingRequirementInput = Readonly<{
  basis: "PER_PRODUCT_UNIT" | "PER_ORDER" | "PER_DELIVERY";
  ruleQuantity: string;
  plannedOutput: string;
  distinctOrderCount: number;
}>;
export type CostComponentInput = ReadonlyArray<number | null>;
export type CostSummaryInput = Readonly<{
  baseIngredientCosts: CostComponentInput;
  wasteCosts: CostComponentInput;
  productPackagingCosts: CostComponentInput;
  deliveryPackagingCosts: CostComponentInput;
  laborCosts: ReadonlyArray<number>;
  utilityCosts: ReadonlyArray<number>;
  missingInventoryItemIds: ReadonlyArray<string>;
}>;
export type ProductCostInput = Omit<CostSummaryInput, "deliveryPackagingCosts">;
export type ProductCostCalculation = Readonly<{
  knownBaseIngredientCostSatang: number;
  knownWasteCostSatang: number;
  knownProductPackagingCostSatang: number;
  laborCostSatang: number;
  utilityCostSatang: number;
  knownProductionCostSatang: number;
  completeProductionCostSatang: number | null;
  costComplete: boolean;
  missingPriceCount: number;
}>;
export type CycleCostCalculation = ProductCostCalculation & Readonly<{
  knownDeliveryPackagingCostSatang: number;
}>;
~~~

For `PER_PRODUCT_UNIT`, multiply by planned output. For `PER_ORDER` and `PER_DELIVERY`, multiply by the provided distinct order count. Reject negative count, non-positive rule quantity, and unsupported basis.

`roundAtomicSatang` must call `toDecimalPlaces(0, Decimal.ROUND_HALF_UP)`, reject negative/unsafe/PostgreSQL-overflow values, and return a number. `calculateRequirementCost` returns `null` for missing price and otherwise multiplies exact quantity by `calculateUnitCostSatang` before rounding. Labor divides the hourly rate by 60 before multiplying minutes and selected batches; utility multiplies its per-batch satang value by selected batches; both round once at their atomic product component. Cost summary functions sum known values with checked PostgreSQL integers, mark incomplete when any direct requirement is null, and count distinct missing inventory item ids rather than null cost rows. Labor and utility are always known.

- [ ] **Step 5: Run focused and inventory-cost regression tests**

~~~bash
pnpm test:run -- src/modules/planning/domain/packaging-requirement.test.ts src/modules/planning/domain/costing.test.ts src/modules/inventory/domain/cost.test.ts
pnpm typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/modules/planning/domain
git commit -m "feat: calculate packaging and planning costs"
~~~

### Task 4: Planning preview orchestration, issues, fingerprint, and form schemas

**Files:**

- Modify: `src/modules/planning/domain/types.ts`
- Create: `src/modules/planning/domain/build-preview.ts`
- Create: `src/modules/planning/domain/build-preview.test.ts`
- Create: `src/modules/planning/domain/fingerprint.ts`
- Create: `src/modules/planning/domain/fingerprint.test.ts`
- Create: `src/modules/planning/domain/lock-form.ts`
- Create: `src/modules/planning/domain/lock-form.test.ts`

**Interfaces:**

- Produces: `buildPlanningPreview(source, overrides?): PlanningPreview`.
- Produces: `createPlanningFingerprint(source): string`.
- Produces: `lockCycleInputSchema`, `unlockCycleInputSchema`, `LockCycleInput`, and `UnlockCycleInput`.
- Consumes: calculators from Tasks 2 and 3.

- [ ] **Step 1: Define a failing representative preview test**

Use a source fixture with two non-cancelled orders for ten Focaccia, yield six pieces, one 1,000 g ingredient, 10% recipe waste, product-unit and delivery packaging rules, labor 30 minutes, utility ฿20, labor rate ฿120/hour, and effective ingredient price ฿55/1,000 g. Assert default suggestion is two batches, then override to 1.5 with a reason and assert planned output nine, shortfall warning, material 1,650 g, and recalculated costs.

~~~ts
const preview = buildPlanningPreview(source, [{
  productId: FOCACCIA_ID,
  selectedBatchCount: "1.5",
  reason: "ทดลองผลิตน้อยกว่ายอดสั่ง",
}]);
expect(preview.blockers).toEqual([]);
expect(preview.productPlans[0]).toMatchObject({
  orderedQuantity: "10",
  suggestedBatchCount: 2,
  selectedBatchCount: "1.5",
  plannedOutput: "9",
  outputDifference: "-1",
  overrideReason: "ทดลองผลิตน้อยกว่ายอดสั่ง",
});
expect(preview.materialRequirements[0]).toMatchObject({
  baseRequirement: "1500",
  wasteQuantity: "150",
  plannedRequirement: "1650",
});
expect(preview.warnings.map((issue) => issue.code)).toContain("PLANNED_SHORTFALL");
~~~

- [ ] **Step 2: Add failing blocker, warning, and missing-price cases**

Assert exact issue codes and Thai messages for:

~~~ts
export const PLANNING_ISSUE_MESSAGES = {
  CYCLE_NOT_OPEN: "รอบผลิตต้องอยู่ในสถานะเปิดก่อนล็อก",
  MISSING_PRIMARY_DELIVERY_DATE: "รอบผลิตยังไม่มีวันส่งหลัก",
  NO_ACTIVE_ORDERS: "ยังไม่มีออเดอร์ที่ใช้คำนวณ",
  ORDER_WITHOUT_ITEMS: "มีออเดอร์ที่ไม่มีรายการสินค้า",
  MISSING_ACTIVE_RECIPE: "สินค้ายังไม่มีสูตรที่เปิดใช้งาน",
  INVALID_RECIPE_YIELD: "ผลผลิตของสูตรต้องมากกว่า 0",
  INCOMPATIBLE_YIELD_UNIT: "หน่วยผลผลิตของสูตรแปลงเป็นหน่วยขายไม่ได้",
  INVALID_INGREDIENT_QUANTITY: "ปริมาณวัตถุดิบในสูตรต้องมากกว่า 0",
  INVALID_BATCH_OVERRIDE: "จำนวนแบตช์ที่เลือกต้องมากกว่า 0",
  MISSING_OVERRIDE_REASON: "กรุณาระบุเหตุผลที่เปลี่ยนจำนวนแบตช์",
  MISSING_INVENTORY_PRICE: "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
  ORDER_UNPAID: "มีออเดอร์ที่ยังไม่ชำระเงิน",
  ORDER_PARTIAL: "มีออเดอร์ที่ชำระเงินบางส่วน",
  MISSING_DELIVERY_LOCATION: "ออเดอร์ยังไม่มีสถานที่จัดส่ง",
  DELIVERY_DATE_MISMATCH: "วันส่งของออเดอร์ไม่ตรงกับวันส่งหลักของรอบ",
  PLANNED_SHORTFALL: "แผนนี้ผลิตได้น้อยกว่ายอดสั่ง",
} as const;
~~~

Missing price must create a warning and price record, leave relevant cost null, keep known labor/utility subtotal, and set both product and cycle completeness false. Duplicate missing requirements for the same inventory item must produce one missing-price warning and one missing-item count.

- [ ] **Step 3: Write failing fingerprint and form-schema tests**

~~~ts
it("is stable across input ordering and changes for a relevant value", () => {
  const first = createPlanningFingerprint(source);
  expect(createPlanningFingerprint({
    ...source,
    orders: [...source.orders].reverse(),
  })).toBe(first);
  expect(createPlanningFingerprint({
    ...source,
    orders: source.orders.map((order, index) => index === 0
      ? { ...order, amountPaidSatang: order.amountPaidSatang + 1 }
      : order),
  })).not.toBe(first);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
});

expect(lockCycleInputSchema.safeParse({
  cycleId: CYCLE_ID,
  inputFingerprint: "a".repeat(64),
  lockRequestId: REQUEST_ID,
  overrides: [{ productId: FOCACCIA_ID, selectedBatchCount: "1.5", reason: "ตั้งใจลด" }],
}).success).toBe(true);
expect(unlockCycleInputSchema.safeParse({
  cycleId: CYCLE_ID, reason: "เพิ่มออเดอร์ด่วน", confirmation: "ปลดล็อก",
}).success).toBe(true);
~~~

- [ ] **Step 4: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/domain/build-preview.test.ts src/modules/planning/domain/fingerprint.test.ts src/modules/planning/domain/lock-form.test.ts
~~~

Expected: FAIL because orchestration, fingerprint, and schemas are missing.

- [ ] **Step 5: Implement the source and preview contracts**

Define `PlanningSourceData` with cycle, settings, orders/items, ordered products with nullable active recipe and ingredients, relevant packaging rules, required inventory items, and at most one eligible price per required item. Every entity includes copied names/units and stable source ids. Define:

~~~ts
export type PlanningCycleSnapshot = Readonly<{
  id: string;
  cycleNumber: number;
  name: string;
  status: "DRAFT" | "OPEN" | "LOCKED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED";
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string | null;
}>;
export type PlanningSettingsSnapshot = Readonly<{
  laborRateSatangPerHour: number;
  defaultWasteAllowancePercent: string;
  timezone: string;
  currency: string;
}>;
export type PlanningSourceOrderItem = Readonly<{
  id: string;
  productId: string;
  productName: string;
  sellingUnit: UnitCode;
  quantity: number;
  unitPriceSatang: number;
  lineNote: string | null;
}>;
export type PlanningSourceOrder = Readonly<{
  id: string;
  customerId: string;
  customerName: string;
  deliveryMethodId: string | null;
  deliveryMethodName: string | null;
  deliveryRequiresLocation: boolean;
  requestedDeliveryDate: string | null;
  confirmedDeliveryDate: string | null;
  deliveryLocation: string | null;
  deliveryNote: string | null;
  specialInstructions: string | null;
  sourceChannel: "INSTAGRAM" | "FACEBOOK" | "PHONE" | "OTHER" | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  fulfillmentStatus: "NEW" | "CONFIRMED" | "IN_PRODUCTION" | "PACKED" | "DELIVERED" | "CANCELLED";
  deliveryFeePayer: "CUSTOMER" | "BAKERY" | "SHARED";
  deliveryFeeChargedSatang: number;
  deliveryCostSatang: number;
  discountSatang: number;
  amountPaidSatang: number;
  items: ReadonlyArray<PlanningSourceOrderItem>;
}>;
export type PlanningSourceRecipe = Readonly<{
  recipeId: string;
  recipeName: string;
  recipeVersionId: string;
  versionCode: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string | null;
  instructions: string;
  ingredients: ReadonlyArray<Readonly<{
    recipeIngredientId: string;
    inventoryItemId: string;
    quantityInBaseUnit: string;
  }>>;
}>;
export type PlanningSourceProduct = Readonly<{
  id: string;
  name: string;
  sellingUnit: UnitCode;
  activeRecipe: PlanningSourceRecipe | null;
}>;
export type PlanningSourcePackagingRule = Readonly<{
  id: string;
  scope: "PRODUCT" | "DELIVERY_METHOD";
  productId: string | null;
  deliveryMethodId: string | null;
  targetName: string;
  inventoryItemId: string;
  consumptionBasis: "PER_PRODUCT_UNIT" | "PER_ORDER" | "PER_DELIVERY";
  quantityInBaseUnit: string;
}>;
export type PlanningSourceInventoryItem = Readonly<{
  id: string;
  name: string;
  category: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
  baseUnit: UnitCode;
  price: Readonly<{
    id: string;
    packPriceSatang: number;
    packBaseQuantity: string;
    effectiveAt: Date;
  }> | null;
}>;
export type PlanningSourceData = Readonly<{
  calculatedAt: Date;
  cycle: PlanningCycleSnapshot;
  settings: PlanningSettingsSnapshot;
  orders: ReadonlyArray<PlanningSourceOrder>;
  products: ReadonlyArray<PlanningSourceProduct>;
  packagingRules: ReadonlyArray<PlanningSourcePackagingRule>;
  inventoryItems: ReadonlyArray<PlanningSourceInventoryItem>;
}>;
export type PlanningIssue = Readonly<{
  code: keyof typeof PLANNING_ISSUE_MESSAGES;
  scope: "CYCLE" | "ORDER" | "PRODUCT" | "INVENTORY_ITEM";
  sourceEntityId: string | null;
  message: string;
  context: Readonly<Record<string, string | number | boolean | null>>;
}>;
export type BatchOverride = Readonly<{
  productId: string;
  selectedBatchCount: string;
  reason: string;
}>;
export type PlanningOrderSnapshot = PlanningSourceOrder & Readonly<{
  subtotalSatang: number;
  grandTotalSatang: number;
  balanceSatang: number;
}>;
export type PlanningRecipePlan = Readonly<{
  productId: string;
  recipeId: string;
  recipeVersionId: string;
  recipeName: string;
  versionCode: string;
  instructions: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  yieldInSellingUnit: string;
  sellingUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string;
  wasteAllowanceSource: "RECIPE" | "SHOP_DEFAULT";
}>;
export type PlanningProductPlan = ProductBatchPlan & Readonly<{
  productId: string;
  productName: string;
  sellingUnit: UnitCode;
  overrideReason: string | null;
}>;
export type PlanningInventoryPrice = Readonly<{
  inventoryItemId: string;
  inventoryItemName: string;
  inventoryCategory: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
  baseUnit: UnitCode;
  sourcePriceId: string | null;
  packPriceSatang: number | null;
  packBaseQuantity: string | null;
  effectiveAt: Date | null;
  unitCostSatang: string | null;
}>;
export type PlanningMaterialRequirement = MaterialRequirementCalculation & Readonly<{
  productId: string;
  recipeIngredientId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  baseUnit: UnitCode;
  quantityPerBatch: string;
  selectedBatchCount: string;
  wasteAllowancePercent: string;
  baseCostSatang: number | null;
  wasteCostSatang: number | null;
}>;
export type PlanningPackagingRequirement = PackagingRequirementCalculation & Readonly<{
  packagingRuleId: string;
  scope: "PRODUCT" | "DELIVERY_METHOD";
  consumptionBasis: "PER_PRODUCT_UNIT" | "PER_ORDER" | "PER_DELIVERY";
  productId: string | null;
  deliveryMethodId: string | null;
  targetName: string;
  inventoryItemId: string;
  inventoryItemName: string;
  baseUnit: UnitCode;
  ruleQuantity: string;
  costSatang: number | null;
}>;
export type PlanningProductCost = ProductCostCalculation & Readonly<{
  productId: string;
}>;
export type PlanningCycleCost = CycleCostCalculation;
export type PlanningPreview = Readonly<{
  calculatedAt: Date;
  cycle: PlanningCycleSnapshot;
  inputFingerprint: string;
  blockers: ReadonlyArray<PlanningIssue>;
  warnings: ReadonlyArray<PlanningIssue>;
  orderSnapshots: ReadonlyArray<PlanningOrderSnapshot>;
  productPlans: ReadonlyArray<PlanningProductPlan>;
  recipePlans: ReadonlyArray<PlanningRecipePlan>;
  inventoryPrices: ReadonlyArray<PlanningInventoryPrice>;
  materialRequirements: ReadonlyArray<PlanningMaterialRequirement>;
  packagingRequirements: ReadonlyArray<PlanningPackagingRequirement>;
  productCosts: ReadonlyArray<PlanningProductCost>;
  cycleCost: PlanningCycleCost;
}>;
~~~

Sort issues and every output collection by stable ids before returning. Filter cancelled orders before aggregation. Count distinct orders for product packaging. Apply overrides before material, packaging, and cost calculation. Return blockers instead of throwing for correctable source-data problems; throw only for programmer-invalid contracts.

- [ ] **Step 6: Implement canonical fingerprint and form validation**

`createPlanningFingerprint` must recursively sort object keys, sort entity arrays by stable ids, canonicalize numeric strings with Decimal.js, encode dates with `toISOString()`, omit `calculatedAt`, and hash UTF-8 JSON with `createHash("sha256")`. Hash only relevant source data, not display ordering or batch overrides.

Use Zod schemas with UUID ids, exactly 64 lowercase hex fingerprint characters, positive decimal selected counts with six places, trimmed reasons from 1 through 2,000 characters when an override is sent, and exact unlock confirmation `z.literal("ปลดล็อก")`.

- [ ] **Step 7: Run the complete planning-domain suite**

~~~bash
pnpm test:run -- src/modules/planning/domain
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/modules/planning/domain
git commit -m "feat: build production planning previews"
~~~

### Task 5: Owner-scoped source loading and read-only preview service

**Files:**

- Create: `tests/fixtures/planning.ts`
- Create: `src/modules/planning/application/load-source.ts`
- Create: `src/modules/planning/application/planning-queries.ts`
- Create: `src/modules/planning/application/planning-queries.test.ts`

**Interfaces:**

- Produces: `loadPlanningSource(reader, ownerId, cycleId, asOf): Promise<PlanningSourceData>`.
- Produces: `createPlanningQueryService(db, clock?).preview(ownerId, cycleId): Promise<PlanningPreview>`.
- Consumes: existing master tables and `buildPlanningPreview`.

- [ ] **Step 1: Create a deterministic planning fixture and failing query tests**

Define this helper contract in `tests/fixtures/planning.ts`:

~~~ts
export async function seedPlanningScenario(
  db: DatabaseClient,
  input?: Readonly<{
    ownerId?: string;
    cycleStatus?: "DRAFT" | "OPEN" | "LOCKED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED";
    includeIngredientPrice?: boolean;
    includePackagingPrice?: boolean;
    orderQuantity?: number;
  }>,
): Promise<Readonly<{
  cycleId: string;
  productId: string;
  ingredientItemId: string;
  packagingItemId: string;
  orderIds: ReadonlyArray<string>;
}>>;
~~~

Default to `OWNER_ID`, cycle status `OPEN`, both prices present, and total active-order quantity 10. Use explicit overrides in missing-price and lifecycle tests.

Seed shop settings, ingredient, packaging item, price history with one future price and two eligible prices, product/recipe/version/ingredient, product and delivery packaging rules, delivery method, customer, open cycle, two active orders, and one cancelled order.

Write tests that assert:

- another owner receives `Cycle not found`;
- preview creates no planning rows;
- only non-cancelled order quantities contribute;
- the latest price with `effectiveAt <= asOf` wins, with created time/id tie-breaking;
- future and unrelated-owner prices are ignored;
- missing packaging price yields one warning and incomplete cost;
- unrelated master-data rows are absent from the source and therefore do not change the fingerprint.

- [ ] **Step 2: Run query tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/application/planning-queries.test.ts
~~~

Expected: FAIL because fixture, loader, and service do not exist.

- [ ] **Step 3: Implement the narrow source loader**

Load in this order:

1. owner-scoped cycle and shop settings;
2. all cycle order headers and items, retaining cancelled rows for filtering evidence;
3. customers and delivery methods referenced by those orders;
4. distinct ordered products and each active recipe/version/ingredient;
5. packaging rules only for ordered products and used delivery methods;
6. inventory items referenced by active recipe ingredients or applicable packaging rules;
7. eligible prices for those inventory ids at `asOf`, ordered by item id, effective time descending, created time descending, and id descending; keep the first row per item.

Use batched `inArray` queries, never one query per order or product. If settings are unexpectedly absent, throw `Shop settings not found`; Phase 1 bootstrap is responsible for creating them. Map database numeric values to canonical Decimal strings before returning.

- [ ] **Step 4: Implement the preview query service**

~~~ts
export type PlanningClock = Readonly<{ now(): Date }>;
const SYSTEM_CLOCK: PlanningClock = { now: () => new Date() };

export function createPlanningQueryService(
  db: DatabaseClient,
  clock: PlanningClock = SYSTEM_CLOCK,
) {
  return {
    async preview(ownerId: string, cycleId: string): Promise<PlanningPreview> {
      const asOf = clock.now();
      const source = await loadPlanningSource(db, ownerId, cycleId, asOf);
      return buildPlanningPreview(source);
    },
  };
}
~~~

Validate owner and cycle UUIDs with Zod and return the same `Cycle not found` for malformed, missing, or cross-owner ids.

- [ ] **Step 5: Run focused query and regression checks**

~~~bash
pnpm test:run -- src/modules/planning/application/planning-queries.test.ts src/modules/planning/domain
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add tests/fixtures/planning.ts src/modules/planning/application/load-source.ts src/modules/planning/application/planning-queries.ts src/modules/planning/application/planning-queries.test.ts
git commit -m "feat: load planning previews"
~~~

### Task 6: Atomic lock persistence, idempotency, and immutable reads

**Files:**

- Create: `src/modules/planning/application/snapshot-writer.ts`
- Create: `src/modules/planning/application/planning-commands.ts`
- Create: `src/modules/planning/application/planning-commands.test.ts`
- Modify: `src/modules/planning/application/planning-queries.ts`
- Modify: `src/modules/planning/application/planning-queries.test.ts`
- Modify: `src/lib/db/row-locks.ts`

**Interfaces:**

- Produces: `createPlanningCommandService(db, clock?).lock(ownerId, input): Promise<PlanningGenerationSummary>`.
- Produces: `PlanningStaleError`, `PlanningBlockedError`, and `PlanningStateError` for expected action mapping.
- Produces: `persistPlanningSnapshot(tx, ownerId, cycle, preview, input, generation, lockedAt)`.
- Produces: immutable `listGenerations(ownerId, cycleId)` and `getGeneration(ownerId, cycleId, generation?)` reads.
- Consumes: Task 1 schema, Task 4 lock input/preview, Task 5 loader, and `lockOwnedBakeCycle`.

- [ ] **Step 1: Write failing successful-lock and immutable-snapshot tests**

Seed a complete scenario, get a preview, and call:

~~~ts
const locked = await commands.lock(OWNER_ID, {
  cycleId: scenario.cycleId,
  inputFingerprint: preview.inputFingerprint,
  lockRequestId: "11111111-1111-4111-8111-111111111111",
  overrides: [{
    productId: scenario.productId,
    selectedBatchCount: "1.5",
    reason: "ตั้งใจลดหนึ่งชิ้น",
  }],
});
expect(locked).toMatchObject({ generation: 1, status: "ACTIVE", costComplete: true });
expect(await cycleService.get(OWNER_ID, scenario.cycleId)).toMatchObject({
  status: "LOCKED",
  activePlanningSnapshotId: locked.id,
});
~~~

Assert every normalized child table has expected rows and copied values. Edit source product name, active recipe, ingredient quantity, price, labor setting, and packaging rule. Then call `getGeneration(ownerId, cycleId, 1)` and assert every copied plan/requirement/cost value is unchanged.

- [ ] **Step 2: Write failing stale, idempotency, rollback, and concurrency tests**

Add these cases:

1. Change an order quantity after preview; lock throws `PlanningStaleError`, leaves cycle `OPEN`, and writes no snapshot.
2. Re-submit the same request id for the same cycle; return generation 1 without inserting rows again.
3. Use the same request id for a different cycle; throw `PlanningStateError("Lock request belongs to another cycle")`.
4. Create a temporary PostgreSQL trigger that raises on `cycle_cost_snapshots` insert, attempt lock, then assert no parent/child rows remain and cycle is still `OPEN`.
5. Run two distinct valid lock requests with `Promise.allSettled`; exactly one succeeds, one rejects, and only one active generation exists.
6. A preview containing blockers throws `PlanningBlockedError` and persists nothing.

Create the rollback trigger in the test database only:

~~~sql
CREATE FUNCTION fail_cycle_cost_insert() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'forced planning rollback'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER force_cycle_cost_failure
BEFORE INSERT ON cycle_cost_snapshots
FOR EACH ROW EXECUTE FUNCTION fail_cycle_cost_insert();
~~~

- [ ] **Step 3: Run command tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/application/planning-commands.test.ts
~~~

Expected: FAIL because lock persistence and command errors do not exist.

- [ ] **Step 4: Implement the repeatable-read lock command**

Use this public input and transaction configuration:

~~~ts
export type LockCycleInput = z.infer<typeof lockCycleInputSchema>;

return db.transaction(async (tx) => {
  const cycle = await lockOwnedBakeCycle(tx, ownerId, input.cycleId);
  if (!cycle) throw new Error("Cycle not found");

  const existing = await findByLockRequestId(tx, ownerId, input.lockRequestId);
  if (existing) {
    if (existing.bakeCycleId !== input.cycleId) {
      throw new PlanningStateError("Lock request belongs to another cycle");
    }
    return toGenerationSummary(existing);
  }
  if (cycle.status !== "OPEN" || cycle.activePlanningSnapshotId !== null) {
    throw new PlanningStateError("Cycle is not open for locking");
  }

  const lockedAt = clock.now();
  const source = await loadPlanningSource(tx, ownerId, input.cycleId, lockedAt);
  const authoritativeFingerprint = createPlanningFingerprint(source);
  if (authoritativeFingerprint !== input.inputFingerprint) {
    throw new PlanningStaleError();
  }
  const authoritative = buildPlanningPreview(source, input.overrides);
  if (authoritative.blockers.length > 0) {
    throw new PlanningBlockedError(authoritative.blockers);
  }
  const generation = await nextGeneration(tx, ownerId, input.cycleId);
  return persistPlanningSnapshot(
    tx, ownerId, cycle, authoritative, input, generation, lockedAt,
  );
}, { isolationLevel: "repeatable read" });
~~~

The fingerprint comparison uses the default-source preview before overrides; applying overrides must not cause a false stale result. Recompute downstream values using overrides after the source fingerprint matches.

- [ ] **Step 5: Implement normalized persistence and active pointer update**

Insert in dependency order: parent, warnings, order headers, order items, recipe plans, product plans, inventory price rows, materials, packaging, product costs, cycle cost. Build source-id-to-snapshot-id maps in memory and reject any missing map entry before inserting dependent rows.

Finish with a compare-and-swap cycle update:

~~~ts
const [updated] = await tx.update(bakeCycles).set({
  status: "LOCKED",
  lockedAt,
  activePlanningSnapshotId: planningSnapshot.id,
  updatedAt: lockedAt,
}).where(and(
  eq(bakeCycles.ownerId, ownerId),
  eq(bakeCycles.id, cycle.id),
  eq(bakeCycles.status, "OPEN"),
  isNull(bakeCycles.activePlanningSnapshotId),
)).returning({ id: bakeCycles.id });
if (!updated) throw new PlanningStateError("Cycle changed while locking");
~~~

Do not update or delete any child snapshot row after insert.

- [ ] **Step 6: Complete immutable generation reads**

Define:

~~~ts
export type PlanningGenerationSummary = Readonly<{
  id: string;
  cycleId: string;
  generation: number;
  status: "ACTIVE" | "SUPERSEDED";
  costComplete: boolean;
  lockedAt: Date;
  unlockedAt: Date | null;
  unlockReason: string | null;
  unlockedFromStatus: "LOCKED" | "IN_PRODUCTION" | null;
}>;
export type PlanningGenerationView = PlanningGenerationSummary & Readonly<{
  cycleName: string;
  warnings: ReadonlyArray<PlanningIssue>;
  orders: ReadonlyArray<PlanningOrderSnapshot>;
  productPlans: ReadonlyArray<PlanningProductPlan>;
  recipePlans: ReadonlyArray<PlanningRecipePlan>;
  materialRequirements: ReadonlyArray<PlanningMaterialRequirement>;
  packagingRequirements: ReadonlyArray<PlanningPackagingRequirement>;
  productCosts: ReadonlyArray<PlanningProductCost>;
  cycleCost: PlanningCycleCost;
}>;
~~~

`listGenerations` orders newest generation first. `getGeneration` uses the explicit generation when provided; otherwise it uses the cycle active pointer. Every child query includes owner and snapshot id. Missing/cross-owner records return `Planning generation not found`.

- [ ] **Step 7: Run command, query, and schema suites**

~~~bash
pnpm test:run -- src/modules/planning/application src/modules/planning/db/schema.test.ts
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/modules/planning/application src/lib/db/row-locks.ts
git commit -m "feat: lock immutable planning generations"
~~~

### Task 7: Unlock lifecycle and production-input mutation guards

**Files:**

- Modify: `src/modules/planning/application/planning-commands.ts`
- Modify: `src/modules/planning/application/planning-commands.test.ts`
- Modify: `src/lib/db/row-locks.ts`
- Modify: `src/modules/cycles/application/cycles.ts`
- Modify: `src/modules/cycles/application/cycles.test.ts`
- Modify: `src/modules/orders/application/orders.ts`
- Modify: `src/modules/orders/application/orders.test.ts`

**Interfaces:**

- Produces: `planningCommands.unlock(ownerId, input): Promise<PlanningGenerationSummary>`.
- Produces: full `BakeCycleStatus` and explicit cycle transition map.
- Produces: `lockOwnedBakeCycles(reader, ownerId, cycleIds)` with deterministic UUID ordering.
- Enforces: all order writes acquire cycle lock(s) before order locks.
- Consumes: Task 6 active snapshot and command error types.

- [ ] **Step 1: Write failing unlock and generation-progression tests**

Lock generation 1, then assert:

~~~ts
const unlocked = await commands.unlock(OWNER_ID, {
  cycleId: scenario.cycleId,
  reason: "เพิ่มออเดอร์ด่วน",
  confirmation: "ปลดล็อก",
});
expect(unlocked).toMatchObject({
  generation: 1,
  status: "SUPERSEDED",
  unlockReason: "เพิ่มออเดอร์ด่วน",
});
expect(await cycleService.get(OWNER_ID, scenario.cycleId)).toMatchObject({
  status: "OPEN",
  activePlanningSnapshotId: null,
  lockedAt: null,
});
~~~

Re-lock and assert generation 2, with generation 1 unchanged. Repeat from `IN_PRODUCTION`. Assert unlock from `OPEN`, `COMPLETED`, and `CANCELLED` rejects and does not modify snapshot metadata. Assert invalid confirmation/reason is rejected before transaction.

- [ ] **Step 2: Write failing cycle lifecycle tests**

Replace the Phase 2 permissive-status test with this transition contract:

~~~ts
const ALLOWED = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["DRAFT", "CANCELLED"],
  LOCKED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
} as const;
~~~

Locking through `changeStatus(..., "LOCKED")` remains rejected. Cycle metadata update succeeds only in `DRAFT` or `OPEN`; `LOCKED`, `IN_PRODUCTION`, `COMPLETED`, and `CANCELLED` return `Cycle must be open for editing`.

- [ ] **Step 3: Write failing order-guard tests**

For both `LOCKED` and `IN_PRODUCTION`, assert:

- create, production-field update, cycle move, and cancellation are rejected;
- changing only `amountPaidSatang` through the existing full input succeeds;
- refund, payment restore, and forward fulfillment status succeed;
- master/order rows remain unchanged after rejected writes;
- source and destination cycles are locked in sorted UUID order before an order move;
- every existing-order mutation acquires the cycle lock before the order lock, while create acquires its destination cycle lock before insert;
- a lock attempt racing an order quantity update sees either the old committed order or the new committed order, never a partially changed header/items set.

Repeat production-field and cancellation rejection for `COMPLETED` and `CANCELLED`; these terminal states have no unlock path. Payment/refund and non-cancellation fulfillment changes remain allowed there.

- [ ] **Step 4: Run tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/application/planning-commands.test.ts src/modules/cycles/application/cycles.test.ts src/modules/orders/application/orders.test.ts
~~~

Expected: FAIL until unlock, lifecycle, and mutation guards are implemented.

- [ ] **Step 5: Implement atomic unlock**

Inside one transaction, lock the cycle, require `LOCKED` or `IN_PRODUCTION`, lock the pointed snapshot, update it only when currently `ACTIVE`, then clear the cycle pointer and return to `OPEN` with compare-and-swap status.

~~~ts
await tx.update(cyclePlanningSnapshots).set({
  status: "SUPERSEDED",
  unlockedAt,
  unlockReason: input.reason.trim(),
  unlockedFromStatus: cycle.status,
}).where(and(
  eq(cyclePlanningSnapshots.ownerId, ownerId),
  eq(cyclePlanningSnapshots.id, cycle.activePlanningSnapshotId),
  eq(cyclePlanningSnapshots.status, "ACTIVE"),
));
~~~

Require exactly one updated snapshot and cycle row. Never touch child rows.

- [ ] **Step 6: Implement explicit cycle transitions**

Rename `Phase2CycleStatus` to `BakeCycleStatus` and derive it from `bakeCycleStatus`. Wrap cycle metadata update in a transaction, lock the cycle row, and require `DRAFT` or `OPEN` before writing. `changeStatus` checks the map above after locking the row. It never accepts `LOCKED` as a target because only planning lock may create that state. Moving `LOCKED -> IN_PRODUCTION` preserves active pointer/lock time; terminal transitions also preserve the planning generation for history.

Extend the public `BakeCycle` mapper/type with `lockedAt: Date | null` and `activePlanningSnapshotId: string | null` so cycle pages do not issue an unscoped planning lookup just to decide which action to show.

Extend `OrderDetail` with `cycleStatus: BakeCycleStatus`. Include status in the existing batched cycle-name lookup so order pages can choose frozen UI without an additional unscoped query.

- [ ] **Step 7: Implement cycle-first order serialization and frozen-field comparison**

Add `lockOwnedBakeCycles`, sorting unique ids lexicographically before `FOR UPDATE`. For existing-order mutations, first read the order id/cycle id without mutation, lock source and requested destination cycles, then lock the order and verify its cycle id still matches the first read.

Define a comparison that allows only `amountPaidSatang` to differ once a cycle is production-frozen:

~~~ts
function productionInputChanged(current: OrderDetail, next: OrderWriteInput): boolean {
  return current.customerId !== next.customerId ||
    current.bakeCycleId !== next.bakeCycleId ||
    current.sourceChannel !== next.sourceChannel ||
    current.requestedDeliveryDate !== next.requestedDeliveryDate ||
    current.confirmedDeliveryDate !== next.confirmedDeliveryDate ||
    current.deliveryMethodId !== next.deliveryMethodId ||
    (current.deliveryLocation ?? "") !== next.deliveryLocation ||
    (current.deliveryNote ?? "") !== next.deliveryNote ||
    (current.specialInstructions ?? "") !== next.specialInstructions ||
    current.deliveryFeeChargedSatang !== next.deliveryFeeChargedSatang ||
    current.deliveryCostSatang !== next.deliveryCostSatang ||
    current.deliveryFeePayer !== next.deliveryFeePayer ||
    current.discountSatang !== next.discountSatang ||
    !sameOrderItems(current.items, next.items);
}
~~~

`sameOrderItems` compares ordered product id, quantity, unit price, and normalized line note. For any cycle outside `DRAFT` and `OPEN`, reject when this returns true. Cancellation always rejects in those frozen states. Payment/refund and non-cancel fulfillment mutations still lock the cycle so preview/lock warning inputs serialize consistently.

- [ ] **Step 8: Run lifecycle and full regression suites**

~~~bash
pnpm test:run -- src/modules/planning/application src/modules/cycles src/modules/orders
pnpm test:run
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add src/modules/planning/application src/lib/db/row-locks.ts src/modules/cycles/application src/modules/orders/application
git commit -m "feat: enforce planning lifecycle"
~~~

### Task 8: Authenticated lock/unlock actions and preview UI

**Files:**

- Create: `src/app/(app)/cycles/[id]/planning/actions.ts`
- Create: `src/app/(app)/cycles/[id]/planning/actions.test.ts`
- Create: `src/app/(app)/cycles/[id]/planning/page.tsx`
- Create: `src/app/(app)/cycles/[id]/planning/page.test.tsx`
- Create: `src/modules/planning/ui/planning-preview-form.tsx`
- Create: `src/modules/planning/ui/planning-preview-form.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/page.tsx`
- Modify: `src/app/(app)/cycles/[id]/cycle-detail.tsx`
- Modify: `src/app/(app)/cycles/[id]/page.test.tsx`

**Interfaces:**

- Produces: `lockCycleAction` and `unlockCycleAction`.
- Produces: `PlanningActionState` and `UnlockActionState` serializable outcomes.
- Produces: `/cycles/[id]/planning` preview route and `PlanningPreviewForm`.
- Consumes: query/command services and authenticated owner session.

- [ ] **Step 1: Write failing Server Action tests**

Mock `requireOwner`, planning services, `revalidatePath`, and `redirect`. Assert lock parses JSON, calls command service with the verified owner, revalidates cycle/list/dashboard/planning/order paths, then redirects to the planning route. Assert invalid override decimals produce adjacent field errors and no mutation.

Use these states:

~~~ts
export type PlanningActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  stale: boolean;
}>;
export type UnlockActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;
~~~

Map expected errors exactly:

- `PlanningStaleError` -> `ข้อมูลรอบเปลี่ยนแล้ว กรุณาตรวจสอบแผนอีกครั้ง`, `stale: true`;
- `PlanningBlockedError` -> `ยังล็อกรอบไม่ได้ กรุณาแก้รายการที่ระบบแจ้ง`, `stale: false`;
- state/concurrency error -> `ล็อกรอบไม่สำเร็จ กรุณาเปิดแผนล่าสุดแล้วลองอีกครั้ง`;
- unknown database error -> `ระบบบันทึกแผนไม่สำเร็จ กรุณาลองอีกครั้ง`.

Unlock validates exact confirmation/reason and maps ineligible state to `ปลดล็อกรอบนี้ไม่ได้`.

- [ ] **Step 2: Write failing preview-form component tests**

Render a preview containing one blocker, one missing-price warning, and a product suggestion. Assert:

- blockers and warnings have `role="alert"` or labeled regions;
- `ต้นทุนไม่สมบูรณ์` and known subtotal appear;
- lock button is disabled while blockers exist;
- without blockers, changing selected count from `2` to `1.5` reveals required reason;
- submitting without a reason never calls action;
- a valid payload contains fingerprint, stable request UUID, and override;
- pending state disables duplicate submit;
- `stale: true` calls `router.refresh()` and a new fingerprint resets overrides/request id;
- the primary phone submit wrapper remains above the bottom navigation and every control has minimum 44px height.

- [ ] **Step 3: Run action/form/page tests and verify they fail**

~~~bash
pnpm test:run -- src/app/'(app)'/cycles/'[id]'/planning src/modules/planning/ui/planning-preview-form.test.tsx src/app/'(app)'/cycles/'[id]'/page.test.tsx
~~~

Expected: FAIL because the route, actions, form, and cycle link do not exist.

- [ ] **Step 4: Implement authenticated actions**

Both actions call `requireOwner` before parsing untrusted form values. Lock reads a `payload` JSON string and validates with `lockCycleInputSchema`. Unlock reads cycle id/reason/confirmation and validates with `unlockCycleInputSchema`. Successful lock redirects after `try/catch`; successful unlock returns serializable success so its client form can show feedback or navigate. Log unexpected failures server-side with operation, verified owner id, cycle id, and lock request id only; never log form notes, environment values, connection strings, or raw SQL errors to the browser.

Revalidate:

~~~ts
for (const path of [
  "/cycles",
  `/cycles/${cycleId}`,
  `/cycles/${cycleId}/planning`,
  "/orders",
  "/dashboard",
]) revalidatePath(path);
~~~

- [ ] **Step 5: Implement the phone-first preview form**

Use controlled state keyed by product id and a client-generated `crypto.randomUUID()` request id. Render blockers first, warnings second, then product cards with ordered quantity, suggested/selected batches, planned output, difference, and override reason. Render expandable ingredient/packaging lists and cost cards using `formatSatangAsBaht` only for non-null integer satang.

The hidden payload is:

~~~ts
JSON.stringify({
  cycleId: preview.cycle.id,
  inputFingerprint: preview.inputFingerprint,
  lockRequestId,
  overrides: preview.productPlans.flatMap((plan) => {
    const selected = selectedByProductId[plan.productId];
    return selected === String(plan.suggestedBatchCount)
      ? []
      : [{
          productId: plan.productId,
          selectedBatchCount: selected,
          reason: reasonByProductId[plan.productId]?.trim() ?? "",
        }];
  }),
})
~~~

Disable confirmation when blockers exist, a selected value is invalid, or an override reason is blank. Use Thai accessible labels such as `จำนวนแบตช์ ${productName}` and `เหตุผลที่ปรับ ${productName}`.

- [ ] **Step 6: Implement preview route and cycle entry point**

The page awaits `params`, authenticates, fetches cycle and generation summaries, and:

- renders preview only for `OPEN`;
- renders a concise `กรุณาเปิดรอบผลิตก่อน` message for `DRAFT`;
- delegates active/historical rendering to Task 9 for other states;
- calls `notFound()` only for exact owner-scoped not-found errors.

Add `ตรวจแผนและล็อกรอบ` to `CycleDetail` only for `OPEN`. When `activePlanningSnapshotId` is non-null, show `ดูแผนการผลิต` linking to the same planning route. Replace the old Phase 2 advanced-edit warning with a message that production inputs are frozen and require unlock.

- [ ] **Step 7: Run focused UI and full unit checks**

~~~bash
pnpm test:run -- src/app/'(app)'/cycles/'[id]' src/modules/planning/ui
pnpm test:run
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/app/'(app)'/cycles/'[id]' src/modules/planning/ui
git commit -m "feat: preview and lock production plans"
~~~

### Task 9: Immutable generation history, strong unlock UI, and frozen order UI

**Files:**

- Create: `src/modules/planning/ui/planning-generation-view.tsx`
- Create: `src/modules/planning/ui/planning-generation-view.test.tsx`
- Create: `src/modules/planning/ui/unlock-cycle-form.tsx`
- Create: `src/modules/planning/ui/unlock-cycle-form.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/planning/page.tsx`
- Modify: `src/app/(app)/cycles/[id]/planning/page.test.tsx`
- Modify: `src/modules/cycles/ui/cycle-status-form.tsx`
- Modify: `src/modules/cycles/ui/cycle-status-form.test.tsx`
- Modify: `src/modules/cycles/ui/cycle-form.tsx`
- Modify: `src/modules/cycles/ui/cycle-form.test.tsx`
- Modify: `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/(app)/orders/[id]/page.test.tsx`
- Modify: `src/modules/orders/ui/order-form.tsx`
- Modify: `src/modules/orders/ui/order-form.test.tsx`
- Modify: `src/modules/orders/ui/order-status-actions.tsx`
- Modify: `src/modules/orders/ui/order-status-actions.test.tsx`
- Modify: `src/app/(app)/orders/actions.ts`
- Modify: `src/app/(app)/orders/actions.test.ts`

**Interfaces:**

- Produces: `PlanningGenerationView`, history selector, and `UnlockCycleForm`.
- Produces: `productionFrozen` prop for order editing and cycle status controls.
- Consumes: Task 6 immutable reads and Task 8 actions.

- [ ] **Step 1: Write failing immutable-generation view tests**

Render generation 2 active with generation 1 superseded. Assert generation badge, lock time in Asia/Bangkok, accepted warnings, product batch/output/shortfall, ingredient and packaging quantities, complete or incomplete cost labels, and links for both generations.

For an incomplete generation assert:

~~~tsx
expect(screen.getByText("ต้นทุนไม่สมบูรณ์")).toBeInTheDocument();
expect(screen.getByText("ยอดต้นทุนที่ทราบแล้ว ฿211.65")).toBeInTheDocument();
expect(screen.queryByText(/ต้นทุนรวม ฿/)).toBeNull();
~~~

For a complete generation, assert total and derived per-batch/planned-unit/ordered-unit costs are shown only when denominators are positive.

- [ ] **Step 2: Write failing unlock form tests**

Assert the button remains disabled until reason is non-empty and confirmation equals `ปลดล็อก`; typing a different word never submits. Assert `IN_PRODUCTION` displays `รอบนี้เริ่มผลิตแล้ว การปลดล็อกจะคืนรอบไปวางแผนใหม่` and every control has accessible Thai labels.

- [ ] **Step 3: Write failing cycle/order frozen-UI tests**

Assert:

- `CycleStatusForm` never offers manual `LOCKED`; from `LOCKED` it offers only `IN_PRODUCTION` and `CANCELLED`; from `IN_PRODUCTION` it offers only `COMPLETED` and `CANCELLED`; terminal states offer no mutation form.
- `CycleForm` is editable only in `DRAFT`/`OPEN` and otherwise renders read-only values with a planning link.
- locked order detail shows `รอบผลิตถูกล็อกแล้ว แก้ได้เฉพาะยอดชำระและสถานะที่ไม่กระทบการผลิต`.
- `OrderForm` disables customer, cycle, delivery, product, quantity, price, discount, and notes but leaves amount-paid enabled and changes submit copy to `บันทึกยอดชำระ`.
- `OrderStatusActions` hides cancellation for production-frozen cycles but keeps forward fulfillment and refund controls.
- a server rejection due to frozen production data uses `รอบผลิตถูกล็อก กรุณาปลดล็อกรอบก่อนแก้ข้อมูลนี้` instead of a generic save error.

- [ ] **Step 4: Run UI tests and verify they fail**

~~~bash
pnpm test:run -- src/modules/planning/ui src/modules/cycles/ui src/modules/orders/ui src/app/'(app)'/orders src/app/'(app)'/cycles/'[id]'/planning
~~~

Expected: FAIL until generation, unlock, and frozen-input behavior exist.

- [ ] **Step 5: Implement generation and history rendering**

The planning page awaits optional `searchParams.generation`. Validate it as a positive integer. For `OPEN`, default to live preview unless an explicit historical generation is selected. For `LOCKED`, `IN_PRODUCTION`, `COMPLETED`, or `CANCELLED`, default to the active pointer and permit explicit history selection. A terminal cycle cancelled before its first lock has no pointer; render `รอบนี้ไม่มีแผนที่ล็อกไว้` instead of treating that legitimate state as a database error.

`PlanningGenerationView` uses copied snapshot data only. Do not join current master names or prices in the component/page. Group material rows by base unit/item for the cycle total while retaining per-product expandable contributions. Label superseded generations `แทนที่แล้ว` and show unlock reason/time.

- [ ] **Step 6: Implement strong unlock UI**

Use `useActionState(unlockCycleAction, INITIAL_STATE)`. Render only for `LOCKED` or `IN_PRODUCTION`. Submit exact hidden cycle id plus controlled reason and confirmation values. On success call `router.push(`/cycles/${cycleId}`)` and `router.refresh()`; on error retain both inputs and show the safe Thai action error.

- [ ] **Step 7: Implement lifecycle-aware cycle and order screens**

Pass `productionFrozen={cycle.status !== "DRAFT" && cycle.status !== "OPEN"}` from the order page. Also pass `cycleStatus` into `OrderStatusActions`. Keep the full order payload in client state so a payment-only submit sends unchanged frozen fields plus the new amount.

The application service remains authoritative: disabled controls are usability only. Catch exact `Cycle production inputs are locked` errors in `saveOrderAction` and `cancelOrderAction` for the specific Thai message; do not expose raw error messages.

- [ ] **Step 8: Run full component, action, and application regression checks**

~~~bash
pnpm test:run -- src/modules/planning src/modules/cycles src/modules/orders src/app/'(app)'/cycles src/app/'(app)'/orders
pnpm test:run
pnpm typecheck
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add src/modules/planning/ui src/modules/cycles/ui src/modules/orders/ui src/app/'(app)'/cycles src/app/'(app)'/orders
git commit -m "feat: show planning history and unlock controls"
~~~

### Task 10: End-to-end planning workflow, documentation, and release gate

**Files:**

- Modify: `tests/fixtures/owner.ts`
- Create: `tests/e2e/planning.spec.ts`
- Modify: `README.md`

**Interfaces:**

- Produces: browser helpers for selectable inventory base unit and packaging-rule creation.
- Verifies: the complete approved Phase 3A workflow on phone and desktop.
- Consumes: all prior tasks.

- [ ] **Step 1: Write the failing E2E workflow**

Create a unique `runId` and execute this owner workflow:

1. Sign in and configure labor at ฿120/hour and default waste at 3%.
2. Create ingredient flour in grams, add an effective ฿55/1,000 g price.
3. Create packaging box in pieces without a price.
4. Create product Focaccia, recipe yield six pieces, 1,000 g flour, labor 30 minutes, utility ฿20, and recipe waste 10%; activate the recipe.
5. Create KEX Same Day, a product `PER_PRODUCT_UNIT` box rule, customer, open cycle, and two-line order totaling ten pieces.
6. Open planning preview and assert suggested two batches, material requirement 2,200 g at default suggestion, missing box-price warning, and `ต้นทุนไม่สมบูรณ์`.
7. Override to 1.5 batches; assert output nine, shortfall one, reason is required, enter a reason, and lock.
8. Assert generation 1, incomplete cost, material 1,650 g, and accepted shortfall/missing-price warnings.
9. Open the order and assert production fields are disabled, amount paid remains editable, cancellation is hidden, and a payment-only save succeeds.
10. Return to planning, unlock with reason and exact typed confirmation.
11. Add the missing box price, change the order total to twelve pieces, and lock again with the new full-batch suggestion.
12. Assert generation 2 is active and complete; open generation 1 history and verify its copied quantity, missing price, and costs remain unchanged.

Use role/label selectors only. Do not inspect UUIDs or database tables from Playwright.

- [ ] **Step 2: Run phone E2E and verify it fails**

~~~bash
pnpm test:e2e --project=phone tests/e2e/planning.spec.ts
~~~

Expected: FAIL at the first missing Phase 3A UI behavior.

- [ ] **Step 3: Add reusable E2E fixture helpers**

Extend inventory creation without breaking existing callers:

~~~ts
export async function createInventoryItem(
  page: Page,
  input: Readonly<{
    name: string;
    category: "INGREDIENT" | "PACKAGING" | "CONSUMABLE";
    baseUnit?: "g" | "piece";
    purchaseLabel: string;
    packQuantity: string;
  }>,
): Promise<void>;

export async function createPackagingRule(
  page: Page,
  input: Readonly<{
    productName: string;
    inventoryItemName: string;
    basis: "PER_PRODUCT_UNIT" | "PER_ORDER";
    quantity: string;
  }>,
): Promise<void>;
~~~

Default `baseUnit` to `g` for existing master-data E2E. Packaging helper navigates to delivery, selects product scope, product, packaging item, basis, and quantity, then waits for `บันทึกกฎบรรจุภัณฑ์แล้ว`.

Extend `createRecipeVersion` input with optional string fields `laborMinutes`, `utilityCostBaht`, and `wastePercent`. Fill labor with `input.laborMinutes ?? "0"`, utility with `input.utilityCostBaht ?? "0.00"`, and leave the waste input blank when `wastePercent` is `undefined`, preserving every existing E2E caller.

- [ ] **Step 4: Make planning E2E deterministic and responsive**

Keep the test timeout at 240 seconds. Wait for URL or visible saved-state changes after every Server Action. Use unique master names because development fixture rows are intentionally not deleted. Run the same spec in both configured projects; do not branch behavior on viewport unless selecting an already-provided visible navigation link.

- [ ] **Step 5: Update README**

Add Phase 3A current features: preview, blockers/warnings, batch override reasons, recipe scaling, material/packaging requirements, effective-price/labor/utility snapshots, incomplete costs, atomic lock, unlock/re-lock history, and production-frozen orders. Document eleven planning tables and migration 0005.

Keep stock count, shortages, shopping quantities, purchase packs, inventory movements, tasks/timeline, final cost, and profit under later phases. State that E2E must use only a development/test Supabase project because fixture records persist.

- [ ] **Step 6: Run database and complete verification gates**

Run each command separately and inspect its final exit status:

~~~bash
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm test:e2e --project=phone
pnpm test:e2e --project=desktop
~~~

Expected:

- migration 0005 applies or reports already applied;
- lint exits 0;
- typecheck exits 0;
- all Vitest tests pass;
- Next production build completes;
- every phone Playwright test passes;
- every desktop Playwright test passes.

- [ ] **Step 7: Inspect migration and repository safety**

~~~bash
git diff --check
git status --short
git diff -- .env.local .env
~~~

Expected: no whitespace errors, only intended Phase 3A files changed, and no environment-file diff.

- [ ] **Step 8: Commit**

~~~bash
git add tests/fixtures/owner.ts tests/e2e/planning.spec.ts README.md
git commit -m "test: cover phase 3a planning workflow"
~~~

- [ ] **Step 9: Request review and finish the branch**

Use `superpowers:requesting-code-review` against the Phase 3A spec and this plan. Resolve findings with `superpowers:receiving-code-review`, rerun affected tests, then run the complete verification gate again. When all findings are resolved and the gate is green, use `superpowers:finishing-a-development-branch` to offer local merge, push/PR, keep, or discard choices.
