# Day Off Dough OS Phase 3B Inventory Count and Shopping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้เจ้าของร้านยืนยันสต๊อกของ Planning Generation ที่ล็อกแล้ว สร้างรายการของขาดและจำนวนแพ็กแนะนำ บันทึกการซื้อบางส่วนหลายครั้ง และเก็บ stock/price history โดยไม่เปลี่ยนประวัติ generation เก่า

**Architecture:** เพิ่มโมดูล shopping ที่อ่าน material/packaging requirements จาก immutable Phase 3A snapshot แล้วสร้าง immutable cycle counts และ shopping recommendations ต่อ generation ส่วนการซื้อจริงเป็น append-only events ที่เขียน PURCHASE movement และ price history ใน transaction เดียว Query, command, action และ UI แยกขอบเขตกัน และทุก write ยืนยัน active generation/lifecycle ซ้ำภายใน transaction

**Tech Stack:** Node.js 24.x, pnpm 11.x, Next.js 16.3.2 App Router, React 19, TypeScript strict, Tailwind CSS, Supabase PostgreSQL/Auth, Drizzle ORM 0.45, Zod 4, Decimal.js 10, Vitest 4, Testing Library, Playwright 1.62

**Spec:** `docs/superpowers/specs/2026-09-05-day-off-dough-os-phase-3b-inventory-shopping-design.md`

## Global Constraints

- ผู้ใช้หลักเป็นเจ้าของร้านหนึ่งคน ห้ามเพิ่ม role หรือ multi-user workflow
- ใช้ requirement จาก active Phase 3A planning snapshot เท่านั้น ห้ามคำนวณใหม่จาก mutable orders, recipes หรือ packaging rules
- สูตรของขาดคือ `max(required - counted, 0)` และไม่รวม minimum stock
- จำนวนและ conversion ใช้ Decimal.js; money persist เป็น integer satang
- Missing price ต้องคงเป็น null และแสดงว่าไม่ครบ ห้ามแทนด้วยศูนย์
- Stock balance มาจากผลรวม inventory movements เท่านั้น
- Count/shopping ต่อ Planning Generation เป็น immutable; purchases เป็น append-only
- ซื้อเกินต้องเพิ่ม stock เต็มจำนวนและแสดง overage
- ทุก query และ mutation ต้อง owner-scoped จาก verified session
- ทุกตารางใหม่เปิด RLS และใช้ owner-scoped composite foreign keys
- ทุก business rule เริ่มด้วย failing test และต้องเห็น RED ก่อนแก้ production code
- ทุก task จบด้วย targeted tests และ diff check แล้วผ่าน spec-compliance review กับ code-quality review ก่อน commit
- UI ต้องใช้งานได้ทั้ง phone และ desktop โดย controls สำคัญสูงอย่างน้อย 44px
- E2E ใช้เฉพาะ configured development/test Supabase และไม่ลบ persistent fixtures อัตโนมัติ
- ก่อนแก้ Next.js route หรือ Server Action ให้อ่าน `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` และ `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md` จบทั้งไฟล์

---

## File structure

### New shopping module

- `src/modules/shopping/db/schema.ts` — สามตาราง Phase 3B, constraints, indexes และ RLS-compatible exports
- `src/modules/shopping/db/schema.test.ts` — happy-path และ local constraint coverage
- `src/modules/shopping/db/schema.integrity.test.ts` — cross-owner/cycle/snapshot/item lineage และ RLS coverage
- `src/modules/shopping/domain/types.ts` — immutable DTOs และ discriminated view states
- `src/modules/shopping/domain/calculations.ts` — aggregate, shortfall, pack rounding, estimate และ purchase progress
- `src/modules/shopping/domain/calculations.test.ts` — pure Decimal/money boundary tests
- `src/modules/shopping/domain/forms.ts` — Zod schemas ของ count และ purchase commands
- `src/modules/shopping/domain/forms.test.ts` — exact-set-independent field validation
- `src/modules/shopping/application/load-shopping-source.ts` — narrow immutable requirement/current-stock loader
- `src/modules/shopping/application/load-shopping-source.test.ts` — batching, tenant scope และ immutable source boundary
- `src/modules/shopping/application/shopping-queries.ts` — active/history view queries
- `src/modules/shopping/application/shopping-queries.test.ts` — COUNT_REQUIRED/SHOPPING/HISTORY/NO_PLAN views
- `src/modules/shopping/application/shopping-commands.ts` — confirmStock และ recordPurchase transactions
- `src/modules/shopping/application/shopping-commands.test.ts` — atomicity, idempotency, concurrency และ lifecycle
- `src/modules/shopping/ui/stock-count-form.tsx` — client form สำหรับยืนยันยอดครบทุก item
- `src/modules/shopping/ui/stock-count-form.test.tsx` — form payload, confirmation และ accessible errors
- `src/modules/shopping/ui/purchase-form.tsx` — client form บันทึกจำนวนแพ็กและเงินจริง
- `src/modules/shopping/ui/purchase-form.test.tsx` — validation, idempotency request และ pending state
- `src/modules/shopping/ui/shopping-view.tsx` — summary/cards/history/no-shortfall/read-only states
- `src/modules/shopping/ui/shopping-view.test.tsx` — status, remaining, overage และ mobile controls

### New route

- `src/app/(app)/cycles/[id]/shopping/actions.ts`
- `src/app/(app)/cycles/[id]/shopping/actions.test.ts`
- `src/app/(app)/cycles/[id]/shopping/page.tsx`
- `src/app/(app)/cycles/[id]/shopping/page.test.tsx`

### Existing boundaries changed

- `src/modules/inventory/db/schema.ts` — movement composite unique keys สำหรับ owner/item FK
- `src/lib/db/schema.ts` — export shopping tables
- `src/lib/db/row-locks.ts` — deterministic inventory-item row locking
- `src/app/(app)/cycles/[id]/cycle-detail.tsx` และ page test — active shopping entry point
- `src/modules/planning/ui/planning-generation-view.tsx` และ test — link ไป shopping generation
- `tests/fixtures/planning.ts` — reusable locked-generation fixture IDs
- `tests/fixtures/owner.ts` — browser helpers สำหรับ stock count และ purchase
- `tests/e2e/shopping.spec.ts` — critical Phase 3B workflow
- `README.md` — current features, schema และ deferred boundaries
- `drizzle/0011_phase_3b_inventory_shopping.sql`
- `drizzle/meta/0011_snapshot.json`
- `drizzle/meta/_journal.json`

---

### Task 1: Phase 3B schema and forward-only migration

**Files:**
- Create: `src/modules/shopping/db/schema.ts`
- Create: `src/modules/shopping/db/schema.test.ts`
- Create: `src/modules/shopping/db/schema.integrity.test.ts`
- Modify: `src/modules/inventory/db/schema.ts`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0011_phase_3b_inventory_shopping.sql`
- Create: `drizzle/meta/0011_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `cyclePlanningSnapshots`, `cycleInventoryPriceSnapshots`, `bakeCycles`, `inventoryItems`, `inventoryMovements`, `inventoryPrices`
- Produces: `cycleInventoryCounts`, `cycleShoppingItems`, `cyclePurchaseEntries`
- Produces: `inventory_movements(owner_id, id)` and `inventory_movements(owner_id, inventory_item_id, id)` unique keys

- [ ] **Step 1: Write failing local schema tests**

Create tests that insert one count, one shopping item and two purchase entries. Assert zero-price purchase remains distinct from missing price and over-purchase is accepted.

Define these test-local helpers in the same file before the test. `seedLockedPlanningFixture` calls the existing `seedPlanningScenario`, real planning preview and real planning lock, then returns the IDs needed by the shopping foreign keys. The three insert helpers create their required movement/price source rows before the Phase 3B child row and return the inserted row.

~~~ts
type SchemaFixture = Readonly<{
  cycleId: string;
  planningSnapshotId: string;
  inventoryItemId: string;
  priceSnapshotId: string;
}>;

async function seedLockedPlanningFixture(db: DatabaseClient): Promise<SchemaFixture>;
async function insertCycleCount(
  db: DatabaseClient,
  fixture: SchemaFixture,
  quantities: Readonly<{
    requiredQuantity: string;
    countedQuantity: string;
    countDeltaQuantity: string;
  }>,
): Promise<typeof cycleInventoryCounts.$inferSelect>;
async function insertShoppingItem(
  db: DatabaseClient,
  count: typeof cycleInventoryCounts.$inferSelect,
  recommendation: Readonly<{
    shortfallQuantity: string;
    suggestedPackCount: number;
    suggestedPurchaseQuantity: string;
  }>,
): Promise<typeof cycleShoppingItems.$inferSelect>;
async function insertPurchase(
  db: DatabaseClient,
  shopping: typeof cycleShoppingItems.$inferSelect,
  purchase: Readonly<{
    purchaseRequestId: string;
    packCount: number;
    purchasedQuantity: string;
    totalPriceSatang: number;
  }>,
): Promise<typeof cyclePurchaseEntries.$inferSelect>;
~~~

~~~ts
it('stores one count and multiple purchases for the same shopping item', async () => {
  const fixture = await seedLockedPlanningFixture(context.db);
  const count = await insertCycleCount(context.db, fixture, {
    requiredQuantity: '2200',
    countedQuantity: '1000',
    countDeltaQuantity: '1000',
  });
  const shopping = await insertShoppingItem(context.db, count, {
    shortfallQuantity: '1200',
    suggestedPackCount: 2,
    suggestedPurchaseQuantity: '2000',
  });

  await insertPurchase(context.db, shopping, {
    purchaseRequestId: PURCHASE_REQUEST_1,
    packCount: 1,
    purchasedQuantity: '1000',
    totalPriceSatang: 5500,
  });
  await insertPurchase(context.db, shopping, {
    purchaseRequestId: PURCHASE_REQUEST_2,
    packCount: 1,
    purchasedQuantity: '1000',
    totalPriceSatang: 0,
  });

  const rows = await context.db.select().from(cyclePurchaseEntries);
  expect(rows).toHaveLength(2);
  expect(rows[1]?.totalPriceSatang).toBe(0);
});
~~~

- [ ] **Step 2: Write failing integrity tests**

Cover each rule independently:

~~~ts
await expect(
  db.insert(cycleInventoryCounts).values({
    ...validCount,
    ownerId: OTHER_OWNER_ID,
  }),
).rejects.toThrow();

await expect(
  db.insert(cyclePurchaseEntries).values({
    ...validPurchase,
    planningSnapshotId: otherSnapshot.id,
  }),
).rejects.toThrow();

await expect(
  db.insert(cyclePurchaseEntries).values({
    ...validPurchase,
    purchaseRequestId: validPurchase.purchaseRequestId,
  }),
).rejects.toThrow();
~~~

Also query `pg_class`, `pg_constraint`, `pg_indexes` and `pg_tables` to assert named checks, owner indexes and `rowsecurity = true` for all three tables.

Build `validCount` and `validPurchase` from the rows returned by the Step 1 helpers; do not hard-code unrelated foreign IDs in these integrity cases.

- [ ] **Step 3: Run schema tests to verify RED**

Run:

~~~bash
pnpm test:run -- src/modules/shopping/db
~~~

Expected: FAIL because the shopping schema module and tables do not exist.

- [ ] **Step 4: Add exact Drizzle schema**

Define the three tables with these persisted column types:

~~~ts
export const cycleInventoryCounts = pgTable('cycle_inventory_counts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  bakeCycleId: uuid('bake_cycle_id').notNull(),
  planningSnapshotId: uuid('planning_snapshot_id').notNull(),
  inventoryItemId: uuid('inventory_item_id').notNull(),
  priceSnapshotId: uuid('price_snapshot_id').notNull(),
  inventoryItemName: varchar('inventory_item_name', { length: 160 }).notNull(),
  inventoryCategory: inventoryCategoryEnum('inventory_category').notNull(),
  baseUnit: varchar('base_unit', { length: 16 }).notNull(),
  requiredQuantity: numeric('required_quantity', { precision: 18, scale: 6 }).notNull(),
  systemBalanceBeforeCount: numeric('system_balance_before_count', { precision: 18, scale: 6 }).notNull(),
  countedQuantity: numeric('counted_quantity', { precision: 18, scale: 6 }).notNull(),
  countDeltaQuantity: numeric('count_delta_quantity', { precision: 18, scale: 6 }).notNull(),
  purchaseUnitLabel: varchar('purchase_unit_label', { length: 160 }).notNull(),
  baseQuantityPerPurchasePack: numeric('base_quantity_per_purchase_pack', { precision: 18, scale: 6 }).notNull(),
  countMovementId: uuid('count_movement_id').notNull(),
  countedAt: timestamp('counted_at', { withTimezone: true, mode: 'date' }).notNull(),
  confirmationRequestId: uuid('confirmation_request_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => [
  unique('cycle_inventory_counts_owner_id_id_unique').on(table.ownerId, table.id),
  unique('cycle_inventory_counts_owner_snapshot_item_unique').on(
    table.ownerId,
    table.planningSnapshotId,
    table.inventoryItemId,
  ),
  check(
    'cycle_inventory_counts_required_category',
    sql`${table.inventoryCategory} IN ('INGREDIENT', 'PACKAGING')`,
  ),
]);
~~~

Add all composite keys and checks named in the spec. Define `cycleShoppingItems` with integer `suggestedPackCount` and nullable integer `estimatedCostSatang`. Define `cyclePurchaseEntries` with integer `packCount` and `totalPriceSatang`, numeric pack/purchased quantities, unique request ID, movement ID and price ID.

Add both movement uniqueness constraints:

~~~ts
unique('inventory_movements_owner_id_id_unique').on(table.ownerId, table.id),
unique('inventory_movements_owner_item_id_unique').on(
  table.ownerId,
  table.inventoryItemId,
  table.id,
),
~~~

Use composite foreign keys that include owner, cycle, snapshot and item wherever the child carries those fields. Enable RLS in the generated SQL for all three tables without adding Data API policies.

- [ ] **Step 5: Export the tables**

Add exact exports to `src/lib/db/schema.ts`:

~~~ts
export {
  cycleInventoryCounts,
  cyclePurchaseEntries,
  cycleShoppingItems,
} from '@/modules/shopping/db/schema';
~~~

- [ ] **Step 6: Generate and inspect migration 0011**

Run:

~~~bash
pnpm db:generate --name phase_3b_inventory_shopping
~~~

If Drizzle chooses a generated suffix, rename only the SQL file to `0011_phase_3b_inventory_shopping.sql` and update the journal tag. Inspect SQL to ensure it creates all three tables, constraints, indexes and these statements:

~~~sql
ALTER TABLE "cycle_inventory_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cycle_shopping_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cycle_purchase_entries" ENABLE ROW LEVEL SECURITY;
~~~

- [ ] **Step 7: Run focused schema tests**

Run:

~~~bash
pnpm test:run -- src/modules/shopping/db src/modules/planning/db/schema.test.ts src/modules/inventory/application/inventory.test.ts
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 1**

~~~bash
git add drizzle src/lib/db/schema.ts src/modules/inventory/db/schema.ts src/modules/shopping/db
git commit -m "feat: add phase 3b shopping schema"
~~~

---

### Task 2: Exact shopping calculations and command form contracts

**Files:**
- Create: `src/modules/shopping/domain/types.ts`
- Create: `src/modules/shopping/domain/calculations.ts`
- Create: `src/modules/shopping/domain/calculations.test.ts`
- Create: `src/modules/shopping/domain/forms.ts`
- Create: `src/modules/shopping/domain/forms.test.ts`

**Interfaces:**
- Produces: `aggregateSnapshotRequirements(input): ReadonlyArray<StockRequirement>`
- Produces: `calculateShoppingRecommendation(input): ShoppingRecommendation`
- Produces: `calculatePurchaseProgress(shortfallQuantity, purchasedQuantities): ShoppingItemProgress`
- Produces: `confirmStockInputSchema` and `recordPurchaseInputSchema`
- Produces: `CycleStockShoppingView` discriminated union used by Tasks 3, 6, 7 and 8

- [ ] **Step 1: Write failing aggregate and boundary tests**

~~~ts
it('aggregates material and packaging rows by inventory item exactly', () => {
  expect(
    aggregateSnapshotRequirements({
      materials: [
        requirement('flour', 'INGREDIENT', 'g', '1100.123456'),
        requirement('flour', 'INGREDIENT', 'g', '0.876544'),
      ],
      packaging: [
        requirement('box', 'PACKAGING', 'piece', '12'),
      ],
    }),
  ).toEqual([
    expect.objectContaining({ inventoryItemId: 'box', requiredQuantity: '12' }),
    expect.objectContaining({ inventoryItemId: 'flour', requiredQuantity: '1101' }),
  ]);
});

it('rejects inconsistent copied units for the same item', () => {
  expect(() =>
    aggregateSnapshotRequirements({
      materials: [
        requirement('flour', 'INGREDIENT', 'g', '1000'),
        requirement('flour', 'INGREDIENT', 'kg', '1'),
      ],
      packaging: [],
    }),
  ).toThrow('Planning requirement identity mismatch');
});
~~~

- [ ] **Step 2: Write failing recommendation and progress tests**

~~~ts
expect(calculateShoppingRecommendation({
  requiredQuantity: '2200',
  countedQuantity: '1000',
  packBaseQuantity: '1000',
  unitCostSatang: '5.5',
})).toEqual({
  shortfallQuantity: '1200',
  suggestedPackCount: 2,
  suggestedPurchaseQuantity: '2000',
  estimatedCostSatang: 11000,
});

expect(calculatePurchaseProgress('1200', ['1000'])).toEqual({
  status: 'PARTIAL',
  purchasedQuantity: '1000',
  remainingQuantity: '200',
  overageQuantity: '0',
});

expect(calculatePurchaseProgress('1200', ['1000', '1000'])).toEqual({
  status: 'COMPLETE',
  purchasedQuantity: '2000',
  remainingQuantity: '0',
  overageQuantity: '800',
});
~~~

Add cases for no shortfall, exact completion, missing price, zero price, six-decimal inputs, invalid negative values and pack-count overflow beyond `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 3: Write failing Zod form tests**

~~~ts
expect(confirmStockInputSchema.safeParse({
  cycleId: CYCLE_ID,
  planningSnapshotId: SNAPSHOT_ID,
  confirmationRequestId: REQUEST_ID,
  countedAt: new Date('2026-09-05T03:00:00Z'),
  counts: [{ inventoryItemId: ITEM_ID, countedQuantity: '0' }],
}).success).toBe(true);

expect(recordPurchaseInputSchema.safeParse({
  cycleId: CYCLE_ID,
  planningSnapshotId: SNAPSHOT_ID,
  shoppingItemId: SHOPPING_ID,
  purchaseRequestId: REQUEST_ID,
  packCount: 0,
  totalPriceSatang: 5500,
  occurredAt: new Date('2026-09-05T03:00:00Z'),
}).success).toBe(false);
~~~

Assert trimmed optional text is at most 200 characters for `purchasedFrom` and 2,000 for notes.

- [ ] **Step 4: Run domain tests to verify RED**

~~~bash
pnpm test:run -- src/modules/shopping/domain
~~~

Expected: FAIL because domain files do not exist.

- [ ] **Step 5: Implement immutable types**

Define these exact public shapes:

~~~ts
export type ShoppingStatus = 'TO_BUY' | 'PARTIAL' | 'COMPLETE';

export type ShoppingRecommendation = Readonly<{
  shortfallQuantity: string;
  suggestedPackCount: number;
  suggestedPurchaseQuantity: string;
  estimatedCostSatang: number | null;
}>;

export type ShoppingItemProgress = Readonly<{
  status: ShoppingStatus;
  purchasedQuantity: string;
  remainingQuantity: string;
  overageQuantity: string;
}>;

export type CycleStockShoppingView =
  | CountRequiredView
  | ShoppingView
  | HistoryView
  | NoPlanView;
~~~

Define the discriminants and shared fields exactly:

~~~ts
export type CycleShoppingHeader = Readonly<{
  cycleId: string;
  cycleNumber: number;
  cycleName: string;
  cycleStatus: BakeCycleStatus;
  planningSnapshotId: string | null;
  generation: number | null;
  planningStatus: 'ACTIVE' | 'SUPERSEDED' | null;
}>;

export type CountRequiredView = Readonly<{
  kind: 'COUNT_REQUIRED';
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  items: ReadonlyArray<StockCountCandidate>;
  writable: true;
}>;

export type ShoppingView = Readonly<{
  kind: 'SHOPPING';
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  confirmedAt: Date;
  counts: ReadonlyArray<CycleInventoryCountView>;
  items: ReadonlyArray<CycleShoppingItemView>;
  writable: boolean;
}>;

export type HistoryView = Readonly<{
  kind: 'HISTORY';
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  confirmedAt: Date | null;
  counts: ReadonlyArray<CycleInventoryCountView>;
  items: ReadonlyArray<CycleShoppingItemView>;
  writable: false;
}>;

export type NoPlanView = Readonly<{
  kind: 'NO_PLAN';
  cycle: CycleShoppingHeader;
  generations: ReadonlyArray<PlanningGenerationSummary>;
  writable: false;
}>;
~~~

Define `StockCountCandidate`, `CycleInventoryCountView`, `CyclePurchaseEntryView` and `CycleShoppingItemView` with the exact persisted IDs, copied labels/units, canonical quantity strings, nullable estimated money, `ShoppingItemProgress`, and readonly purchase arrays required by the spec. Reuse `BakeCycleStatus` and `PlanningGenerationSummary` rather than introducing duplicate status vocabularies. All arrays and objects exposed to UI are readonly.

- [ ] **Step 6: Implement calculations with Decimal.js**

~~~ts
export function calculateShoppingRecommendation(
  input: ShoppingRecommendationInput,
): ShoppingRecommendation {
  const required = exactNonNegative(input.requiredQuantity);
  const counted = exactNonNegative(input.countedQuantity);
  const pack = exactPositive(input.packBaseQuantity);
  const shortfall = Decimal.max(required.minus(counted), 0);
  if (shortfall.isZero()) {
    return {
      shortfallQuantity: '0',
      suggestedPackCount: 0,
      suggestedPurchaseQuantity: '0',
      estimatedCostSatang: input.unitCostSatang === null ? null : 0,
    };
  }
  const packs = shortfall.div(pack).ceil();
  if (!packs.isSafeInteger()) throw new Error('Suggested pack count is too large');
  const purchaseQuantity = packs.mul(pack);
  const estimate = input.unitCostSatang === null
    ? null
    : purchaseQuantity.mul(input.unitCostSatang).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return {
    shortfallQuantity: shortfall.toString(),
    suggestedPackCount: packs.toNumber(),
    suggestedPurchaseQuantity: purchaseQuantity.toString(),
    estimatedCostSatang: estimate,
  };
}
~~~

Aggregate with a Map keyed by inventory item ID, sort output by copied name then ID, and throw if the same ID disagrees on name, category, base unit or price snapshot.

- [ ] **Step 7: Implement form schemas**

Use a six-decimal non-negative string refinement for counts, positive safe integer for pack count, non-negative safe integer for satang and valid Dates:

~~~ts
export const recordPurchaseInputSchema = z.object({
  cycleId: z.string().uuid(),
  planningSnapshotId: z.string().uuid(),
  shoppingItemId: z.string().uuid(),
  purchaseRequestId: z.string().uuid(),
  packCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  totalPriceSatang: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  purchasedFrom: z.string().trim().max(200).optional(),
  occurredAt: z.date(),
  notes: z.string().trim().max(2000).optional(),
});
~~~

- [ ] **Step 8: Run focused domain verification**

~~~bash
pnpm test:run -- src/modules/shopping/domain
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 9: Commit Task 2**

~~~bash
git add src/modules/shopping/domain
git commit -m "feat: calculate shopping requirements"
~~~

---

### Task 3: Immutable source loader and active/history query service

**Files:**
- Create: `src/modules/shopping/application/load-shopping-source.ts`
- Create: `src/modules/shopping/application/load-shopping-source.test.ts`
- Create: `src/modules/shopping/application/shopping-queries.ts`
- Create: `src/modules/shopping/application/shopping-queries.test.ts`
- Modify: `tests/fixtures/planning.ts`

**Interfaces:**
- Consumes: Task 1 tables and Task 2 domain functions/types
- Produces: `loadShoppingSource(reader, ownerId, snapshotId): Promise<ReadonlyArray<StockCountCandidate>>`
- Produces: `createShoppingQueryService(db).getCycleStockCheck(ownerId, cycleId, generation?): Promise<CycleStockShoppingView>`

- [ ] **Step 1: Extend the planning fixture with locked generation IDs**

Make `seedPlanningScenario` keep its current return values and add a helper that locks through the real planning command:

~~~ts
export async function seedLockedPlanningScenario(
  db: DatabaseClient,
  input: NonNullable<Parameters<typeof seedPlanningScenario>[0]> = {},
) {
  const source = await seedPlanningScenario(db, input);
  const preview = await createPlanningQueryService(db, FIXED_CLOCK).preview(
    input.ownerId ?? OWNER_ID,
    source.cycleId,
  );
  const generation = await createPlanningCommandService(db, FIXED_CLOCK).lock(
    input.ownerId ?? OWNER_ID,
    {
      cycleId: source.cycleId,
      lockRequestId: LOCK_REQUEST_ID,
      inputFingerprint: preview.inputFingerprint,
      overrides: [],
    },
  );
  return { ...source, planningSnapshotId: generation.id, generation: generation.generation };
}
~~~

Define `FIXED_CLOCK` as `2026-08-23T03:00:00.000Z` and select `LOCK_REQUEST_ID` from distinct PRIMARY/SECONDARY UUID constants before calling the lock command. Give PRIMARY and SECONDARY fixtures distinct lock request IDs.

- [ ] **Step 2: Write failing source-loader tests**

Seed a locked plan where flour appears in two material rows and packaging appears in product plus delivery rules. Assert:

- results aggregate per inventory item;
- name/category/unit/price come from planning snapshot rows;
- purchase label/pack size come from current inventory item;
- balances come from one grouped inventory movement query;
- another owner's movements never contribute;
- mutable order/recipe/packaging tables are never queried.

Use a Drizzle logger and mutation-sensitive query assertions:

~~~ts
expect(selects.filter(query => query.includes('cycle_material_requirements'))).toHaveLength(1);
expect(selects.filter(query => query.includes('cycle_packaging_requirements'))).toHaveLength(1);
expect(selects.filter(query => query.includes('cycle_inventory_price_snapshots'))).toHaveLength(1);
expect(selects.filter(query => query.includes('inventory_movements'))).toHaveLength(1);
expect(selects.some(query => query.includes('recipe_ingredients'))).toBe(false);
~~~

- [ ] **Step 3: Write failing query-view tests**

~~~ts
it('returns COUNT_REQUIRED for an active locked generation without counts', async () => {
  const fixture = await seedLockedPlanningScenario(db);
  const view = await service.getCycleStockCheck(OWNER_ID, fixture.cycleId);
  expect(view.kind).toBe('COUNT_REQUIRED');
  if (view.kind !== 'COUNT_REQUIRED') throw new Error('Expected count view');
  expect(view.items.map(item => item.inventoryItemName)).toEqual([
    'ถุงขนม',
    'แป้งขนมปัง',
  ]);
});
~~~

Also cover:

- DRAFT/OPEN cycle without a selected historical generation returns `NO_PLAN`;
- explicit invalid or missing generation throws `Shopping generation not found`;
- superseded generation without counts returns `HISTORY` with `confirmedAt: null`;
- persisted counts plus purchases return `SHOPPING` for active and `HISTORY` for superseded;
- historical view performs no inventory master or current balance query;
- all purchases load in one query, not one query per shopping item.

- [ ] **Step 4: Run query tests to verify RED**

~~~bash
pnpm test:run -- src/modules/shopping/application/load-shopping-source.test.ts src/modules/shopping/application/shopping-queries.test.ts
~~~

Expected: FAIL because loader and query service do not exist.

- [ ] **Step 5: Implement the narrow source loader**

Load immutable rows and current operational rows in constant query count:

~~~ts
const [materialRows, packagingRows, priceRows] = await Promise.all([
  reader.select().from(cycleMaterialRequirements).where(snapshotScope),
  reader.select().from(cyclePackagingRequirements).where(snapshotScope),
  reader.select().from(cycleInventoryPriceSnapshots).where(snapshotScope),
]);
const priceByItemId = new Map(
  priceRows.map(price => [price.inventoryItemId, price]),
);
const requirements = aggregateSnapshotRequirements({
  materials: materialRows.map(row => toRequirementInput(row, priceByItemId)),
  packaging: packagingRows.map(row => toRequirementInput(row, priceByItemId)),
});
if (requirements.length === 0) return [];

const itemIds = requirements.map(row => row.inventoryItemId);
const [itemRows, balanceRows] = await Promise.all([
  reader.select({
    id: inventoryItems.id,
    purchaseUnitLabel: inventoryItems.purchaseUnitLabel,
    baseQuantityPerPurchasePack: inventoryItems.baseQuantityPerPurchasePack,
  }).from(inventoryItems).where(and(
    eq(inventoryItems.ownerId, ownerId),
    inArray(inventoryItems.id, itemIds),
  )),
  reader.select({
    inventoryItemId: inventoryMovements.inventoryItemId,
    balance: sql<string>`coalesce(sum(${inventoryMovements.quantityDeltaInBaseUnit}), 0)::text`,
  }).from(inventoryMovements).where(and(
    eq(inventoryMovements.ownerId, ownerId),
    inArray(inventoryMovements.inventoryItemId, itemIds),
  )).groupBy(inventoryMovements.inventoryItemId),
]);
~~~

Fail with `Shopping inventory profile missing` if any required item no longer resolves. Do not filter on inventory active state.

- [ ] **Step 6: Implement the query service**

Validate UUID/generation, load cycle and generation summaries, resolve active pointer or explicit generation, then:

~~~ts
if (countRows.length === 0) {
  if (isWritableActiveGeneration(cycle, snapshot)) {
    return {
      kind: 'COUNT_REQUIRED',
      cycle: toCycleHeader(cycle, snapshot),
      generations,
      items: await loadShoppingSource(db, ownerId, snapshot.id),
    };
  }
  return {
    kind: 'HISTORY',
    cycle: toCycleHeader(cycle, snapshot),
    generations,
    confirmedAt: null,
    counts: [],
    items: [],
  };
}
~~~

For persisted history, load counts, shopping items and purchase entries in batched queries; map Decimal strings through `.toString()`; derive statuses through `calculatePurchaseProgress`. Historical reads must use copied count/shopping/purchase values only.

- [ ] **Step 7: Run query verification**

~~~bash
pnpm test:run -- src/modules/shopping/application
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 3**

~~~bash
git add tests/fixtures/planning.ts src/modules/shopping/application
git commit -m "feat: load cycle shopping views"
~~~

---

### Task 4: Atomic stock confirmation

**Files:**
- Modify: `src/lib/db/row-locks.ts`
- Create: `src/modules/shopping/application/shopping-commands.ts`
- Create: `src/modules/shopping/application/shopping-commands.test.ts`

**Interfaces:**
- Consumes: `confirmStockInputSchema`, `loadShoppingSource`, Task 1 tables
- Produces: `ShoppingStateError`, `ShoppingValidationError`
- Produces: `createShoppingCommandService(db, clock).confirmStock(ownerId, input): Promise<CycleStockShoppingView>`

- [ ] **Step 1: Write failing row-lock tests**

Add deterministic item locking:

~~~ts
const locked = await lockOwnedInventoryItems(reader, OWNER_ID, [
  SECOND_ITEM_ID,
  FIRST_ITEM_ID,
  SECOND_ITEM_ID,
]);
expect(locked.map(item => item.id)).toEqual([FIRST_ITEM_ID, SECOND_ITEM_ID]);
~~~

Assert another owner's item is omitted.

- [ ] **Step 2: Write failing confirmation behavior tests**

Cover:

- exact input set creates one COUNT movement and one count row per requirement;
- count delta uses balance read inside the transaction;
- no-shortfall count creates no Shopping item;
- shortfall creates immutable recommendation;
- minimum stock does not affect shortfall;
- repeated identical confirmation returns existing view without new movement;
- repeated different confirmation throws `ShoppingValidationError`;
- missing, extra and duplicate input IDs write nothing;
- owner/cycle/snapshot mismatch throws;
- OPEN, SUPERSEDED, COMPLETED and CANCELLED states reject;
- LOCKED and IN_PRODUCTION accept;
- forced failure after movement insert rolls back movement/count/shopping rows;
- two concurrent confirmations produce one set only.

Use exact evidence without a custom count helper:

~~~ts
const countMovements = await db
  .select()
  .from(inventoryMovements)
  .where(eq(inventoryMovements.type, 'COUNT'));
const persistedCounts = await db.select().from(cycleInventoryCounts);
const shoppingRows = await db.select().from(cycleShoppingItems);
expect(countMovements).toHaveLength(2);
expect(persistedCounts).toHaveLength(2);
expect(shoppingRows).toHaveLength(1);
~~~

- [ ] **Step 3: Run command test to verify RED**

~~~bash
pnpm test:run -- src/modules/shopping/application/shopping-commands.test.ts
~~~

Expected: FAIL because `confirmStock` and the row-lock helper do not exist.

- [ ] **Step 4: Implement deterministic item locking**

~~~ts
export async function lockOwnedInventoryItems(
  reader: LockingReader,
  ownerId: string,
  itemIds: ReadonlyArray<string>,
) {
  const rows = [];
  for (const itemId of [...new Set(itemIds)].sort()) {
    const [item] = await reader
      .select()
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.ownerId, ownerId),
        eq(inventoryItems.id, itemId),
      ))
      .limit(1)
      .for('update');
    if (item) rows.push(item);
  }
  return rows;
}
~~~

- [ ] **Step 5: Implement command errors and lifecycle guard**

~~~ts
export class ShoppingStateError extends Error {}
export class ShoppingValidationError extends Error {}

function isShoppingWritable(cycle: LockedCycle, snapshotId: string): boolean {
  return (
    (cycle.status === 'LOCKED' || cycle.status === 'IN_PRODUCTION') &&
    cycle.activePlanningSnapshotId === snapshotId
  );
}
~~~

Lock the cycle first through `lockOwnedBakeCycle`; then verify the snapshot is ACTIVE and belongs to the same owner/cycle.

- [ ] **Step 6: Implement confirmStock transaction**

Parse input before opening the transaction. Inside:

~~~ts
const existingCounts = await loadExistingCounts(
  tx,
  ownerId,
  input.planningSnapshotId,
);
if (existingCounts.length > 0) {
  assertSameCanonicalCountSet(existingCounts, input.counts);
  return createShoppingQueryService(tx).getCycleStockCheck(
    ownerId,
    input.cycleId,
  );
}
const source = await loadShoppingSource(tx, ownerId, input.planningSnapshotId);
assertExactCountSet(source, input.counts);
const lockedItems = await lockOwnedInventoryItems(
  tx,
  ownerId,
  source.map(item => item.inventoryItemId),
);
if (lockedItems.length !== source.length) {
  throw new ShoppingStateError('Shopping inventory profile changed');
}
const refreshed = await loadShoppingSource(tx, ownerId, input.planningSnapshotId);
~~~

Check existing counts immediately after the cycle/snapshot lifecycle guard and before reading mutable inventory profiles. This lets an identical retry return the persisted result even if an inventory master record changed after confirmation. For each refreshed row generate the count row UUID, insert a COUNT movement with:

~~~ts
{
  ownerId,
  inventoryItemId: row.inventoryItemId,
  type: 'COUNT',
  quantityDeltaInBaseUnit: counted.minus(row.systemBalance).toString(),
  countedQuantityInBaseUnit: counted.toString(),
  referenceType: 'CYCLE_INVENTORY_COUNT',
  referenceId: countId,
  occurredAt: input.countedAt,
}
~~~

Insert count and optional shopping recommendation. If existing count rows are found after the cycle lock, compare canonical `inventoryItemId/countedQuantity` sets. Return the existing view only when identical.

- [ ] **Step 7: Run confirmation verification**

~~~bash
pnpm test:run -- src/modules/shopping/application/shopping-commands.test.ts src/modules/inventory/application/inventory.test.ts
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 4**

~~~bash
git add src/lib/db/row-locks.ts src/modules/shopping/application/shopping-commands.ts src/modules/shopping/application/shopping-commands.test.ts
git commit -m "feat: confirm cycle stock atomically"
~~~

---

### Task 5: Idempotent partial and over-purchase ledger

**Files:**
- Modify: `src/modules/shopping/application/shopping-commands.ts`
- Modify: `src/modules/shopping/application/shopping-commands.test.ts`
- Modify: `src/modules/inventory/application/inventory.test.ts`

**Interfaces:**
- Consumes: `recordPurchaseInputSchema`, Shopping item/count rows and inventory ledger
- Produces: `createShoppingCommandService(db, clock).recordPurchase(ownerId, input): Promise<ShoppingItemProgress>`

- [ ] **Step 1: Write failing partial, complete and overage tests**

~~~ts
const first = await service.recordPurchase(OWNER_ID, {
  cycleId,
  planningSnapshotId,
  shoppingItemId,
  purchaseRequestId: PURCHASE_1,
  packCount: 1,
  totalPriceSatang: 5500,
  occurredAt: NOW,
});
expect(first).toMatchObject({
  status: 'PARTIAL',
  purchasedQuantity: '1000',
  remainingQuantity: '200',
  overageQuantity: '0',
});

const second = await service.recordPurchase(OWNER_ID, {
  cycleId,
  planningSnapshotId,
  shoppingItemId,
  purchaseRequestId: PURCHASE_2,
  packCount: 1,
  totalPriceSatang: 5700,
  occurredAt: LATER,
});
expect(second).toMatchObject({
  status: 'COMPLETE',
  purchasedQuantity: '2000',
  remainingQuantity: '0',
  overageQuantity: '800',
});
~~~

- [ ] **Step 2: Write failing ledger and idempotency tests**

Assert each purchase creates exactly one entry, movement and price:

~~~ts
expect(movement).toMatchObject({
  type: 'PURCHASE',
  quantityDeltaInBaseUnit: '1000.000000',
  referenceType: 'CYCLE_PURCHASE_ENTRY',
  referenceId: entry.id,
});
expect(price).toMatchObject({
  packPriceSatang: 5500,
  packBaseQuantity: '1000.000000',
  purchasedFrom: 'ร้านวัตถุดิบ',
  effectiveAt: NOW,
});
~~~

Retry the same request/payload and assert counts remain one. Retry the same request with different pack count, money, date or shopping item and assert `ShoppingValidationError`.

- [ ] **Step 3: Write failing lifecycle, isolation and rollback tests**

Cover:

- purchase works in LOCKED and IN_PRODUCTION;
- purchase still works after status is already COMPLETE, increasing overage;
- OPEN after unlock rejects;
- superseded/terminal generation rejects;
- cross-owner, cross-cycle and cross-item shopping ID rejects;
- missing Shopping item rejects;
- zero price succeeds and remains a real price;
- forced error after price insert rolls back entry/movement/price;
- two concurrent calls with the same request ID produce one purchase only.

- [ ] **Step 4: Run purchase tests to verify RED**

~~~bash
pnpm test:run -- src/modules/shopping/application/shopping-commands.test.ts
~~~

Expected: FAIL because `recordPurchase` is absent.

- [ ] **Step 5: Implement idempotent purchase transaction**

Lock in this order: cycle, inventory item, Shopping item. Resolve an existing request immediately after the cycle lock and before enforcing the current writable lifecycle; returning an already-committed matching request is not a new write and must remain recoverable after unlock. A request ID with any mismatched payload still fails:

~~~ts
const [existing] = await tx
  .select()
  .from(cyclePurchaseEntries)
  .where(and(
    eq(cyclePurchaseEntries.ownerId, ownerId),
    eq(cyclePurchaseEntries.purchaseRequestId, input.purchaseRequestId),
  ))
  .limit(1);
if (existing) {
  assertSamePurchasePayload(existing, input);
  return loadShoppingItemProgress(tx, ownerId, existing.shoppingItemId);
}
~~~

Read copied `baseQuantityPerPurchasePack` from the linked count and calculate:

~~~ts
const purchasedQuantity = new Decimal(input.packCount)
  .mul(count.baseQuantityPerPurchasePack)
  .toString();
~~~

Generate the entry UUID before related inserts. Insert PURCHASE movement and inventory price first, capture their IDs, then insert the purchase entry that references both. Use actual total money as `packPriceSatang` and total purchased quantity as `packBaseQuantity`.

- [ ] **Step 6: Preserve current inventory price semantics**

Add an inventory regression proving `getItemDetail(ownerId, itemId, asOf)` selects the newest effective purchase-created price and calculates unit cost from total price/total quantity. The test must include a later-created row with an earlier `effectiveAt` so ordering is based on effective time first.

- [ ] **Step 7: Run purchase verification**

~~~bash
pnpm test:run -- src/modules/shopping/application/shopping-commands.test.ts src/modules/inventory/application/inventory.test.ts
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 5**

~~~bash
git add src/modules/shopping/application src/modules/inventory/application/inventory.test.ts
git commit -m "feat: record cycle purchases"
~~~

---

### Task 6: Authenticated Server Actions

**Files:**
- Create: `src/app/(app)/cycles/[id]/shopping/actions.ts`
- Create: `src/app/(app)/cycles/[id]/shopping/actions.test.ts`

**Interfaces:**
- Consumes: `requireOwner`, Task 2 schemas and Task 4/5 commands
- Produces: `confirmCycleStockAction(previousState, formData): Promise<StockActionState>`
- Produces: `recordCyclePurchaseAction(previousState, formData): Promise<PurchaseActionState>`

- [ ] **Step 1: Read installed Next.js guidance**

Read both complete files:

~~~bash
sed -n '1,999p' node_modules/next/dist/docs/01-app/02-guides/server-actions.md
sed -n '1,999p' node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md
~~~

Record any API/deprecation difference in the task ledger before editing.

- [ ] **Step 2: Write failing action authentication and parsing tests**

Mock `requireOwner`, `db`, command service and `revalidatePath`. Assert owner always comes from session:

~~~ts
await confirmCycleStockAction(INITIAL_STOCK_STATE, formData);
expect(command.confirmStock).toHaveBeenCalledWith(OWNER_ID, {
  cycleId: CYCLE_ID,
  planningSnapshotId: SNAPSHOT_ID,
  confirmationRequestId: REQUEST_ID,
  countedAt: NOW,
  counts: [{ inventoryItemId: ITEM_ID, countedQuantity: '1000' }],
});
~~~

Malformed JSON, missing count, invalid decimal, non-integer pack count and invalid Baht input must return adjacent field/form errors without calling commands.

- [ ] **Step 3: Write failing safe-error and revalidation tests**

Map exact command errors:

~~~ts
expect(await invokeWith(new ShoppingStateError('raw'))).toMatchObject({
  error: 'แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด',
  stale: true,
});
expect(await invokeWith(new ShoppingValidationError('raw'))).toMatchObject({
  error: 'กรุณาตรวจสอบข้อมูลที่กรอก',
  stale: false,
});
~~~

Unexpected errors must log operation/owner/cycle/request IDs without logging price notes or secrets. Successful actions revalidate:

~~~ts
[
  '/cycles',
  '/cycles/' + CYCLE_ID,
  '/cycles/' + CYCLE_ID + '/planning',
  '/cycles/' + CYCLE_ID + '/shopping',
  '/inventory',
  '/dashboard',
]
~~~

The action also revalidates `/inventory`; individual inventory detail pages read fresh server data when opened and are not part of the command return contract.

- [ ] **Step 4: Run action tests to verify RED**

~~~bash
pnpm test:run -- src/app/'(app)'/cycles/'[id]'/shopping/actions.test.ts
~~~

Expected: FAIL because actions do not exist.

- [ ] **Step 5: Implement serializable action states**

~~~ts
export type StockActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
  stale: boolean;
}>;

export type PurchaseActionState = Readonly<{
  error: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
  stale: boolean;
}>;
~~~

Parse count payload from one JSON form field. Parse purchase fields individually, converting Baht through `parseBahtToSatang`. Call `requireOwner()` before touching any user-supplied identifier.

- [ ] **Step 6: Implement safe actions and path revalidation**

Use operation-specific structured logs:

~~~ts
console.error('shopping_action_failed', {
  operation,
  ownerId,
  cycleId,
  requestId,
});
~~~

Never include raw error messages in returned state. Set `saved: true` only after the command resolves. Do not redirect; the form should show success and the route should render persisted state after revalidation.

- [ ] **Step 7: Run action verification**

~~~bash
pnpm test:run -- src/app/'(app)'/cycles/'[id]'/shopping/actions.test.ts
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 6**

~~~bash
git add src/app/'(app)'/cycles/'[id]'/shopping/actions.ts src/app/'(app)'/cycles/'[id]'/shopping/actions.test.ts
git commit -m "feat: add shopping server actions"
~~~

---

### Task 7: Phone-first stock and purchase UI

**Files:**
- Create: `src/modules/shopping/ui/stock-count-form.tsx`
- Create: `src/modules/shopping/ui/stock-count-form.test.tsx`
- Create: `src/modules/shopping/ui/purchase-form.tsx`
- Create: `src/modules/shopping/ui/purchase-form.test.tsx`
- Create: `src/modules/shopping/ui/shopping-view.tsx`
- Create: `src/modules/shopping/ui/shopping-view.test.tsx`

**Interfaces:**
- Consumes: Task 2 view DTOs and Task 6 actions/states
- Produces: `StockCountForm`, `PurchaseForm`, `ShoppingView`

- [ ] **Step 1: Write failing StockCountForm tests**

Render two count candidates and assert:

- inputs have labels `จำนวนที่นับจริง {itemName}`;
- defaults equal current balance;
- all inputs are required and accept step `any`, min `0`;
- submit shows confirmation copy;
- cancel does not call action;
- confirm sends one canonical JSON payload containing every item exactly once;
- pending action disables the sticky submit button;
- field errors render next to the matching item;
- stale state exposes a link/reload instruction.

~~~tsx
await user.clear(screen.getByLabelText('จำนวนที่นับจริง แป้งขนมปัง'));
await user.type(screen.getByLabelText('จำนวนที่นับจริง แป้งขนมปัง'), '1000');
await user.click(screen.getByRole('button', { name: 'ยืนยันสต๊อกและสร้างรายการซื้อ' }));
expect(window.confirm).toHaveBeenCalledWith(
  'ยืนยันยอดนับสำหรับแผนรุ่น 1 และปรับยอดสต๊อกตามจำนวนจริงหรือไม่?',
);
~~~

- [ ] **Step 2: Write failing PurchaseForm tests**

Assert accessible labels, integer pack input, Baht input, store/date/notes, stable request UUID across rerenders, new UUID only after a successful submission, pending state and error placement.

~~~tsx
await user.type(screen.getByLabelText('จำนวนแพ็กที่ซื้อ'), '1');
await user.type(screen.getByLabelText('ราคารวม (บาท)'), '55.00');
await user.click(screen.getByRole('button', { name: 'บันทึกการซื้อ' }));
expect(action).toHaveBeenCalledTimes(1);
expect(submitted.get('purchaseRequestId')).toMatch(UUID_PATTERN);
~~~

- [ ] **Step 3: Write failing ShoppingView tests**

Cover:

- summary counts and known estimated total;
- missing estimate label is not zero;
- no-shortfall success state;
- TO_BUY, PARTIAL and COMPLETE badges;
- remaining quantity and overage;
- purchase history entries including zero-price purchase;
- button label changes to `เพิ่มการซื้ออีกครั้ง` after COMPLETE;
- HISTORY without counts states `ไม่มีการยืนยันสต๊อกสำหรับรุ่นนี้`;
- read-only generation renders no purchase form;
- links between generation histories use accessible names.

- [ ] **Step 4: Run UI tests to verify RED**

~~~bash
pnpm test:run -- src/modules/shopping/ui
~~~

Expected: FAIL because UI components do not exist.

- [ ] **Step 5: Implement StockCountForm**

Use `useActionState` and keep the request ID stable:

~~~tsx
const [confirmationRequestId] = useState(() => crypto.randomUUID());
const [state, formAction, pending] = useActionState(
  confirmCycleStockAction,
  INITIAL_STOCK_ACTION_STATE,
);
~~~

Build the JSON payload in the submit handler from controlled input state. Do not accept owner ID. Every card shows required quantity, system balance, base unit and one input. Use `min-h-11` for controls and a phone sticky action container that does not cover bottom navigation.

- [ ] **Step 6: Implement PurchaseForm**

Keep one request ID for a logical submission, reset form/request ID only when state changes from unsaved to saved. Submit exact fields expected by Task 6. Use `inputMode='decimal'` for Baht and `inputMode='numeric'` for integer pack count.

- [ ] **Step 7: Implement ShoppingView**

Render cards, not dense mobile tables. Format quantities through Decimal `.toString()`, money through `formatSatangAsBaht`, and units through `formatUnitLabel`. Overage is informative:

~~~tsx
{item.progress.overageQuantity !== '0' ? (
  <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900">
    ซื้อเกินความต้องการ {item.progress.overageQuantity} {unitLabel}
  </p>
) : null}
~~~

Do not infer writable state in the client; consume `view.writable` from the server query.

- [ ] **Step 8: Run UI verification**

~~~bash
pnpm test:run -- src/modules/shopping/ui src/app/'(app)'/cycles/'[id]'/shopping/actions.test.ts
pnpm lint
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 9: Commit Task 7**

~~~bash
git add src/modules/shopping/ui
git commit -m "feat: show stock and shopping workflow"
~~~

---

### Task 8: Shopping route, generation history and cycle entry points

**Files:**
- Create: `src/app/(app)/cycles/[id]/shopping/page.tsx`
- Create: `src/app/(app)/cycles/[id]/shopping/page.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/cycle-detail.tsx`
- Modify: `src/app/(app)/cycles/[id]/page.test.tsx`
- Modify: `src/modules/planning/ui/planning-generation-view.tsx`
- Modify: `src/modules/planning/ui/planning-generation-view.test.tsx`

**Interfaces:**
- Consumes: `createShoppingQueryService(db).getCycleStockCheck` and Task 7 components
- Produces: `/cycles/[id]/shopping?generation=N`
- Produces: active and historical shopping navigation from cycle/planning pages

- [ ] **Step 1: Write failing route tests**

Mock `requireOwner` and shopping query service. Assert:

~~~tsx
expect(mocks.getCycleStockCheck).toHaveBeenCalledWith(
  OWNER_ID,
  CYCLE_ID,
  2,
);
expect(screen.getByRole('heading', { name: 'เช็กสต๊อกและรายการซื้อ' })).toBeVisible();
~~~

Cover active generation without query parameter, valid positive generation, invalid `0`, negative, decimal, array and unsafe integer going to `notFound()`; missing cycle/generation errors also go to notFound while unexpected errors rethrow.

- [ ] **Step 2: Write failing entry-point tests**

For Cycle Detail:

~~~tsx
expect(screen.getByRole('link', { name: 'เช็กสต๊อกและรายการซื้อ' }))
  .toHaveAttribute('href', '/cycles/' + CYCLE_ID + '/shopping');
~~~

Assert the link exists only when `activePlanningSnapshotId` is non-null. For PlanningGenerationView, active generation links to the route without query; superseded generation links with `?generation={N}` and uses copy `ดูประวัติเช็กสต๊อกและรายการซื้อ`.

- [ ] **Step 3: Run route tests to verify RED**

~~~bash
pnpm test:run -- src/app/'(app)'/cycles/'[id]'/shopping/page.test.tsx src/app/'(app)'/cycles/'[id]'/page.test.tsx src/modules/planning/ui/planning-generation-view.test.tsx
~~~

Expected: FAIL because the route and links do not exist.

- [ ] **Step 4: Implement generation parsing and server page**

Use the same positive-safe-integer rule as Planning page:

~~~ts
function parseGeneration(raw: string | ReadonlyArray<string> | undefined) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const generation = Number(raw);
  return Number.isSafeInteger(generation) ? generation : null;
}
~~~

Await owner, params and searchParams. Call the query service once. Render a back link, copied cycle number/name, generation badge/history nav and exactly one of StockCountForm, ShoppingView, history empty state or no-plan state.

- [ ] **Step 5: Add cycle and planning links**

Cycle Detail active link:

~~~tsx
{cycle.activePlanningSnapshotId !== null ? (
  <Link
    className="inline-flex min-h-12 items-center justify-center rounded-xl border border-amber-800 px-6 text-lg font-bold text-amber-900"
    href={'/cycles/' + cycle.id + '/shopping'}
  >
    เช็กสต๊อกและรายการซื้อ
  </Link>
) : null}
~~~

Planning history link uses the displayed generation number and preserves read-only selection.

- [ ] **Step 6: Run route/integration verification**

~~~bash
pnpm test:run -- src/app/'(app)'/cycles/'[id]' src/modules/planning/ui src/modules/shopping/ui
pnpm lint
pnpm typecheck
git diff --check
~~~

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 8**

~~~bash
git add src/app/'(app)'/cycles/'[id]' src/modules/planning/ui
git commit -m "feat: add cycle shopping route"
~~~

---

### Task 9: Browser workflow, documentation and release gate

**Files:**
- Modify: `tests/fixtures/owner.ts`
- Create: `tests/e2e/shopping.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete Phase 3B UI and configured authenticated owner
- Produces: phone/desktop acceptance evidence and operator documentation

- [ ] **Step 1: Add reusable browser helpers**

Add role/label-only helpers:

~~~ts
export async function confirmCycleStock(
  page: Page,
  counts: ReadonlyArray<{ itemName: string; quantity: string }>,
): Promise<void> {
  for (const count of counts) {
    const input = page.getByLabel('จำนวนที่นับจริง ' + count.itemName);
    await input.fill(count.quantity);
  }
  page.once('dialog', dialog => dialog.accept());
  const response = page.waitForResponse(isCurrentPageServerAction, {
    timeout: SERVER_ACTION_TIMEOUT,
  });
  await page.getByRole('button', {
    name: 'ยืนยันสต๊อกและสร้างรายการซื้อ',
  }).press('Enter');
  expect((await response).ok()).toBe(true);
  await page.goto(page.url());
}
~~~

Add `recordCyclePurchase` with pack count, total Baht, store and action-response-plus-fresh-GET waiting. Never use forced coordinate clicks or database reads.

- [ ] **Step 2: Write the phone/desktop E2E workflow**

Use a project-qualified unique run ID:

~~~ts
const runId = 'shopping-' + testInfo.project.name + '-' + Date.now();
~~~

Create one ingredient with 1,000 g pack and one packaging item with a 100-piece pack. Build a locked plan requiring 2,200 g ingredient and 12 packaging pieces. On shopping page:

1. confirm ingredient count 1,000 g and packaging count 12 pieces;
2. assert one Shopping item, shortfall 1,200 g and suggestion 2 packs;
3. assert packaging has count history but no Shopping card;
4. buy one pack for 55.00 Baht and assert PARTIAL/remaining 200 g;
5. buy another pack for 57.00 Baht and assert COMPLETE/overage 800 g;
6. open Inventory and assert stock balance 3,000 g and latest price 57.00 Baht per 1,000 g purchase lot;
7. unlock and re-lock without changing requirements;
8. open generation 1 history and assert read-only count/purchases;
9. open generation 2, confirm current 3,000 g and assert no shortage.

Keep every individual navigation/action at 30 seconds. Set only the complete workflow timeout from measured isolated RED evidence, starting at 300 seconds.

- [ ] **Step 3: Run E2E test registration and observe RED**

~~~bash
pnpm exec playwright test --list tests/e2e/shopping.spec.ts
pnpm exec playwright test --project=phone tests/e2e/shopping.spec.ts
~~~

Expected before final fixture/UI adjustments: registration exits 0 and the phone workflow exposes any remaining selector or persistence gap. Record exact failure evidence before editing.

- [ ] **Step 4: Update README**

Move these items into current features:

- cycle stock confirmation from active Planning Generation;
- non-negative shortfall and suggested purchase packs;
- partial/multiple/over purchase capture;
- COUNT/PURCHASE movement and actual price history;
- immutable shopping history across unlock/re-lock.

Document the three new tables and migration 0011. Keep consumption, production tasks, final cost and profit under later phases. Preserve the development/test-only persistent E2E fixture warning.

- [ ] **Step 5: Run focused browser tests**

After applying only evidence-backed fixture/selector fixes:

~~~bash
pnpm exec playwright test --project=phone tests/e2e/shopping.spec.ts
pnpm exec playwright test --project=desktop tests/e2e/shopping.spec.ts
~~~

Expected: both commands exit 0.

- [ ] **Step 6: Run migration with explicit backend authorization**

Verify only presence, never values, of `OWNER_EMAIL`, `SUPABASE_DATABASE_URL`, `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Confirm the configured target is development/test, then run:

~~~bash
pnpm db:migrate
~~~

Expected: exit 0. Do not run against a production project.

- [ ] **Step 7: Run every release gate separately**

~~~bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm exec playwright test --project=phone
pnpm exec playwright test --project=desktop
git diff --check
git diff -- .env.local .env next-env.d.ts
~~~

Expected:

- lint, typecheck and build exit 0;
- every Vitest file/test passes;
- phone and desktop projects pass with configured `workers: 1`;
- diff check is empty;
- environment and generated Next env files have no diff.

- [ ] **Step 8: Request independent final review**

Reviewer checks spec coverage, transaction/idempotency correctness, owner/cycle/snapshot lineage, immutable historical reads, accessibility, and persistent-backend E2E safety. Resolve every Important+ finding with RED/GREEN evidence and re-review until unresolved count is zero.

- [ ] **Step 9: Commit Task 9**

~~~bash
git add README.md tests/fixtures/owner.ts tests/e2e/shopping.spec.ts
git commit -m "test: cover phase 3b shopping workflow"
~~~

- [ ] **Step 10: Verify branch handoff**

~~~bash
git status --short --branch
git log --oneline --decorate main..HEAD
~~~

Expected: worktree clean and the Phase 3B branch contains only reviewed Task 1–9 commits after the approved spec commit.
