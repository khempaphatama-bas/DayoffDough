# Day Off Dough OS Phase 4B Operations Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่ม Operations Workspace ต่อ Bake Cycle ที่รวมงานตามเวลา การแพ็กระดับรายการ การรับเงิน การจัดส่งแบบกลุ่ม และ guarded cycle completion ไว้ใน mobile-first workflow เดียว

**Architecture:** เพิ่ม bounded module `operations` เป็น orchestration boundary เหนือ lifecycle ของ `cycles`, immutable generations ของ `planning`/`production` และ mutable fulfillment/payment ของ `orders` Packing progress เก็บใน relational table แยกจาก frozen Order Item ขณะที่ Server Actions เรียก owner-scoped transactional commands และ UI อ่าน current generation ผ่าน Operations read model เดียว

**Tech Stack:** Next.js 16.3.2 App Router, React 19.2, TypeScript 6 strict, Tailwind CSS 4, Supabase Auth/Postgres, Drizzle ORM 0.45, Zod 4.4, Decimal.js 10.6, Vitest 4.1 + Testing Library, PGlite 0.5, Playwright 1.62, pnpm 11

**Spec:** `docs/superpowers/specs/2026-09-22-day-off-dough-os-phase-4b-operations-design.md`

## Global Constraints

- อ่าน spec ข้างต้นครบก่อนเริ่มแต่ละ Task และรักษาคำตัดสินที่อนุมัติแล้วทั้งหมด
- ระบบเป็น single-owner back office; ทุก query/command รับ verified `ownerId` และทุก Server Action เรียก `requireOwner()` ภายใน action
- Browser ห้ามส่งหรือกำหนด `owner_id`; server derive จาก session เท่านั้น
- Operations แสดง Bake Cycle ทีละรอบและ current Task Generation เท่านั้น; generation เก่ายังคงอยู่หน้า Production Timeline เดิม
- ทุก status transition มาจากการยืนยันของเจ้าของ ไม่มี automatic cascade จาก Task, Packing หรือ Payment
- Packing เป็นจำนวนเต็มระดับ active Order Item ช่วง `0..quantity`; แก้ได้เฉพาะ Cycle/Order ที่ `IN_PRODUCTION` และต้อง reopen ออเดอร์ `PACKED` ก่อน
- Order fulfillment ปกติเดินทีละขั้น `NEW -> CONFIRMED -> IN_PRODUCTION -> PACKED -> DELIVERED`; correction เดียวคือ `PACKED -> IN_PRODUCTION` ก่อนส่ง
- Quick Payment ใช้ absolute cumulative target กับ expected current amount, ห้ามติดลบ/เกิน grand total, ห้ามแก้ `REFUNDED`, และยังใช้ได้หลัง `DELIVERED | COMPLETED`
- Cycle complete ได้เมื่อ current tasks ทุกงานเป็น `DONE | SKIPPED` และ non-cancelled orders ทุกใบเป็น `DELIVERED`; unpaid/partial เป็น warning เท่านั้น
- Unlock ยังทำได้ก่อนเริ่ม Order Operations; เมื่อ Order ใดเป็น `IN_PRODUCTION | PACKED | DELIVERED` หรือ Packing progress มากกว่าศูนย์ต้องบล็อกใน transaction
- Delivery date/time เป็น local `Asia/Bangkok`; `confirmedDeliveryTime` เป็น optional `HH:mm`/PostgreSQL `time without time zone` และค่า null ต้องไม่เปลี่ยน legacy planning fingerprint
- ใช้ owner-scoped composite foreign keys, `ON DELETE RESTRICT`, RLS โดยไม่มี anonymous Data API policy และ authoritative PostgreSQL triggers สำหรับ cross-table invariants
- Unknown UUID กับ UUID ของ owner อื่นต้องคืน error kind/message เดียวกันและไม่เปิดเผยว่าข้อมูลมีอยู่
- Batch command normalize duplicate IDs, lock ตาม UUID ที่ sort แล้ว และสำเร็จทั้งหมดหรือ rollback ทั้งหมด
- Next.js 16 dynamic route `params`/`searchParams` เป็น Promise; Server Actions เป็น POST ที่ตรวจ auth ภายใน action และใช้ `revalidatePath` เพื่อ read-your-own-writes ตาม local Next.js guides
- Client forms ใช้ `useActionState` pending/error state; ไม่แสดง optimistic success และเก็บค่าที่กรอกเมื่อ action ล้มเหลว
- ไม่เพิ่ม payment ledger, carrier API, stock consumption, actual cost/profit, CSV, offline sync, notifications หรือ multi-user roles ใน Phase 4B
- ใช้ TDD ทุก Task และห้ามทำ regression ให้ผ่านด้วยการลด assertion, skip test หรือเปลี่ยน requirement

## Review Focus

- Packing progress ที่ยังไม่มี row ต้องอ่านเป็น `0`; concurrent first writes จากค่าเดิมเดียวกันต้องมีผู้ชนะหนึ่งรายและอีกคำสั่งเป็น stale ไม่ใช่สร้าง row ซ้ำ — pin ใน Task 5
- Migration ต้อง backfill active items ของ legacy `PACKED | DELIVERED` ก่อนเปิด lifecycle triggers และต้องไม่แตะสถานะอื่น — pin ใน Task 2
- การเพิ่ม `confirmedDeliveryTime = null` ต้องไม่เปลี่ยน fingerprint ของ fixture เดิม แต่เวลาที่ต่างกันจริงต้องเปลี่ยน fingerprint — pin ใน Task 3
- Retry ที่ target เดิมของ Packing, Payment, Delivery และ Cycle start/complete ต้องสำเร็จแบบ idempotent ขณะที่ payload/state อื่นเป็น stale/invalid — pin ใน Tasks 5–6
- Unlock/complete ที่แข่งกับ task, order หรือ packing mutation ต้อง recheck current generation และ lifecycle ภายใต้ lock ไม่อาศัย readiness จาก UI — pin ใน Tasks 6–7

---

## File Map

### New operations module

- `src/modules/operations/domain/types.ts` — Operations view contracts, error kinds, command inputs
- `src/modules/operations/domain/forms.ts` and `.test.ts` — Zod schemas for batch/status/packing/payment/completion payloads
- `src/modules/operations/domain/rules.ts` and `.test.ts` — task buckets, order sort, packing/payment/completion predicates
- `src/modules/operations/db/schema.ts` — `order_item_packing_progress`
- `src/modules/operations/db/schema.test.ts` — column/index/RLS/trigger shape
- `src/modules/operations/db/schema.integrity.test.ts` — cross-table packing, fulfillment, cycle lifecycle invariants
- `src/modules/operations/db/phase-4b-migration.test.ts` — legacy backfill and migration ordering
- `src/modules/operations/application/operations-queries.ts` and `.test.ts` — per-cycle switcher/read model/current generation
- `src/modules/operations/application/order-commands.ts` and `.test.ts` — confirm/start/pack/reopen/deliver commands
- `src/modules/operations/application/payment-commands.ts` and `.test.ts` — compare-and-set Quick Payment
- `src/modules/operations/application/cycle-commands.ts` and `.test.ts` — start and guarded completion
- `src/modules/operations/application/unlock-guard.ts` and `.test.ts` — transactional unlock blocker
- `src/modules/operations/ui/operations-header.tsx` and `.test.tsx` — Cycle switcher/start/readiness/completion entry
- `src/modules/operations/ui/operations-task-timeline.tsx` and `.test.tsx` — overdue/today/future task view
- `src/modules/operations/ui/packing-progress-form.tsx` and `.test.tsx` — absolute item quantity editor
- `src/modules/operations/ui/quick-payment-form.tsx` and `.test.tsx` — receive/add/full/correct cumulative payment
- `src/modules/operations/ui/operations-payment-board.tsx` and `.test.tsx` — sorted Quick Payment section retained after delivery/completion
- `src/modules/operations/ui/operations-order-card.tsx` and `.test.tsx` — per-order fulfillment status, packing items, and correction controls
- `src/modules/operations/ui/operations-order-board.tsx` and `.test.tsx` — sorted groups and atomic bulk actions
- `src/modules/operations/ui/cycle-completion-form.tsx` and `.test.tsx` — blocker/warning confirmation

### New route, migration, and E2E

- `src/app/(app)/cycles/[id]/operations/actions.ts` and `actions.test.ts`
- `src/app/(app)/cycles/[id]/operations/page.tsx` and `page.test.tsx`
- `drizzle/0013_phase_4b_operations.sql`
- `drizzle/meta/0013_snapshot.json`
- `tests/e2e/operations.spec.ts`

### Existing integration files

- `src/lib/db/schema.ts`, `src/lib/db/row-locks.ts`, `drizzle/meta/_journal.json`
- `src/modules/orders/db/schema.ts`
- `src/modules/orders/domain/order-form.ts` and tests
- `src/modules/orders/application/orders.ts` and tests
- `src/modules/orders/ui/order-form.tsx`, `order-status-actions.tsx` and tests
- `src/app/(app)/orders/actions.ts`, order new/detail pages and tests
- `src/modules/planning/db/schema.ts` and schema tests
- `src/modules/planning/domain/types.ts`, `build-preview.ts`, `fingerprint.ts` and tests
- `src/modules/planning/application/load-source.ts`, `snapshot-writer.ts`, `planning-queries.ts`, `planning-commands.ts` and tests
- `src/modules/production/ui/cycle-task-list.tsx` and tests; new shared `cycle-task-card.tsx` and test
- `src/app/(app)/cycles/[id]/production/actions.ts` and test
- `src/modules/cycles/application/cycles.ts`, `cycle-status-form.tsx` and tests
- `src/app/(app)/cycles/actions.ts`, cycle detail/page tests
- `src/modules/cycles/ui/cycle-list.tsx` and test
- `src/app/(app)/dashboard/page.tsx`, `current-cycle-card.tsx` and test
- `tests/fixtures/planning.ts`, `tests/fixtures/owner.ts`
- `tests/e2e/orders.spec.ts`, `planning.spec.ts`, `production.spec.ts`
- `README.md`

---

### Task 1: Operations Domain Contracts, Forms, and Pure Rules

**Files:**
- Create: `src/modules/operations/domain/types.ts`
- Create: `src/modules/operations/domain/forms.ts`
- Create: `src/modules/operations/domain/forms.test.ts`
- Create: `src/modules/operations/domain/rules.ts`
- Create: `src/modules/operations/domain/rules.test.ts`

**Interfaces:**
- Produces: `OperationsErrorKind`, `OperationsStateError`, `OperationsClock`
- Produces: `CycleOperationsHeader`, `CycleOperationsOption`, `OperationsTask`, `OperationsTaskBuckets`, `OperationsOrderItem`, `OperationsOrder`, `OperationsCompletion`, `CycleOperationsView`
- Produces: `cycleOperationInputSchema`, `orderOperationInputSchema`, `batchOrderOperationInputSchema`, `packingQuantityInputSchema`, `paymentTargetInputSchema`, `completeCycleInputSchema`
- Produces: `bucketOperationsTasks(tasks, now)`, `compareOperationsOrders(left, right)`, `isPackingComplete(items)`, `buildOperationsCompletion(tasks, orders)`
- Consumes: no database, React, Next.js, or Server Action APIs

- [ ] **Step 1: Write failing form and rule tests**

```ts
it("normalizes duplicate batch ids and rejects an empty batch", () => {
  expect(batchOrderOperationInputSchema.parse({
    cycleId: CYCLE_ID,
    orderIds: [SECOND_ORDER_ID, FIRST_ORDER_ID, SECOND_ORDER_ID],
  }).orderIds).toEqual([FIRST_ORDER_ID, SECOND_ORDER_ID]);
  expect(batchOrderOperationInputSchema.safeParse({
    cycleId: CYCLE_ID,
    orderIds: [],
  }).success).toBe(false);
});

it("groups Bangkok overdue and today while keeping future collapsed data", () => {
  const buckets = bucketOperationsTasks(TASKS, new Date("2026-09-22T17:30:00.000Z"));
  expect(buckets.overdue.map(({ id }) => id)).toEqual(["late"]);
  expect(buckets.today.map(({ id }) => id)).toEqual(["midnight", "today"]);
  expect(buckets.future.map(({ id }) => id)).toEqual(["future"]);
});

it("sorts a timed delivery before an untimed delivery on the same date", () => {
  expect([UNTIMED_ORDER, TIMED_ORDER].sort(compareOperationsOrders))
    .toEqual([TIMED_ORDER, UNTIMED_ORDER]);
});

it("allows completion with unpaid warnings but not unfinished work", () => {
  expect(buildOperationsCompletion(DONE_TASKS, DELIVERED_PARTIAL_ORDERS)).toEqual({
    ready: true,
    remainingTaskCount: 0,
    remainingOrderCount: 0,
    unpaidOrderCount: 1,
    outstandingSatang: 42000,
  });
  expect(buildOperationsCompletion(PENDING_TASKS, DELIVERED_PARTIAL_ORDERS).ready)
    .toBe(false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/operations/domain/forms.test.ts src/modules/operations/domain/rules.test.ts`

Expected: FAIL because the Operations domain files do not exist.

- [ ] **Step 3: Add exact error and view contracts**

```ts
export const operationsErrorKinds = [
  "NOT_FOUND",
  "STALE_DATA",
  "INVALID_CYCLE_STATE",
  "INVALID_ORDER_STATE",
  "PACKING_INCOMPLETE",
  "PACKED_QUANTITY_OUT_OF_RANGE",
  "PAYMENT_OUT_OF_RANGE",
  "UNLOCK_BLOCKED_BY_OPERATIONS",
  "CYCLE_COMPLETION_BLOCKED",
] as const;

export class OperationsStateError extends Error {
  constructor(
    readonly kind: (typeof operationsErrorKinds)[number],
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "OperationsStateError";
  }
}

export type OperationsClock = Readonly<{ now(): Date }>;
```

Define `CycleOperationsView` as a `READY | NO_GENERATION` discriminated union. `READY` contains the selected Cycle, switcher options, active planning/task generation IDs, raw tasks, `OperationsTaskBuckets`, sorted active orders, cancelled orders, and `OperationsCompletion`. `NO_GENERATION` retains only the header/switcher and reason `NO_ACTIVE_PLAN | LEGACY_PLAN`.

- [ ] **Step 4: Implement strict Zod command schemas**

```ts
const postgresInteger = z.number().int().min(0).max(2_147_483_647);

export const packingQuantityInputSchema = z.object({
  cycleId: z.string().uuid(),
  orderItemId: z.string().uuid(),
  packedQuantity: postgresInteger,
  expectedPackedQuantity: postgresInteger,
});

export const paymentTargetInputSchema = z.object({
  orderId: z.string().uuid(),
  targetAmountPaidSatang: postgresInteger,
  expectedAmountPaidSatang: postgresInteger,
});
```

For batch IDs, reject empty and more than 100 entries, deduplicate, then sort lexically in a transform. Completion input must include `cycleId`, `expectedTaskGenerationId`, and literal confirmation `true`.

- [ ] **Step 5: Implement Bangkok task buckets, order sorting, packing, and completion rules**

Use `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", ... })` for date keys. Sort tasks by instant then ID. Sort orders by confirmed date, timed before null, time, delivery method, customer, then ID. `isPackingComplete` requires at least one item and exact equality for every item. Exclude `CANCELLED` from completion counts and sum balances with safe-integer checks.

- [ ] **Step 6: Run domain tests and verify GREEN**

Run: `pnpm test:run src/modules/operations/domain/forms.test.ts src/modules/operations/domain/rules.test.ts`

Expected: PASS for invalid integers/UUIDs, duplicate/oversized batches, Bangkok midnight, null delivery time ordering, deterministic ties, zero-item packing, cancelled exclusion, skipped tasks, unpaid warnings, and safe-integer overflow.

- [ ] **Step 7: Commit**

```bash
git add src/modules/operations/domain
git commit -m "feat: define operations domain rules"
```

---

### Task 2: Phase 4B Schema, Legacy Backfill, and Packing Integrity

**Files:**
- Create: `src/modules/operations/db/schema.ts`
- Create: `src/modules/operations/db/schema.test.ts`
- Create: `src/modules/operations/db/schema.integrity.test.ts`
- Create: `src/modules/operations/db/phase-4b-migration.test.ts`
- Create: `drizzle/0013_phase_4b_operations.sql`
- Create: `drizzle/meta/0013_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/modules/orders/db/schema.ts`
- Modify: `src/modules/planning/db/schema.ts`

**Interfaces:**
- Consumes: Task 1 contracts, `orders`, `orderItems`, `bakeCycles`, `cycleOrderSnapshots`, `cycleTasks`, `cycleTaskGenerations`
- Produces: `orderItemPackingProgress`
- Produces columns: `orders.confirmedDeliveryTime`, `cycleOrderSnapshots.confirmedDeliveryTime`
- Produces SQL function: `enforce_order_item_packing_progress()`
- Defers: Order fulfillment and Cycle lifecycle triggers to Task 7, after their guarded application commands exist

- [ ] **Step 1: Write failing schema and migration tests**

```ts
it("stores local delivery time and packing quantities with the required types", async () => {
  expect(await operationColumns(db)).toEqual([
    { tableName: "cycle_order_snapshots", columnName: "confirmed_delivery_time", dataType: "time without time zone" },
    { tableName: "order_item_packing_progress", columnName: "packed_quantity", dataType: "integer" },
    { tableName: "orders", columnName: "confirmed_delivery_time", dataType: "time without time zone" },
  ]);
});

it("backfills only active items belonging to packed or delivered legacy orders", async () => {
  await applyMigrations(db, migrations, 0, 12);
  await seedLegacyOrders(db);
  await applyMigrations(db, migrations, 13, 13);
  expect(await packedProgressRows(db)).toEqual([
    { orderItemId: PACKED_ITEM_ID, packedQuantity: 4 },
    { orderItemId: DELIVERED_ITEM_ID, packedQuantity: 2 },
  ]);
});
```

Add RED assertions for owner-scoped FK, unique owner/item, non-negative quantity, RLS enabled/no policies, Packing trigger installation, cross-owner insert, inactive item, overpack, update while `PACKED`, and hard delete. Fulfillment/Cycle trigger assertions belong to Task 7 so existing Phase 2 lifecycle tests remain green until guarded commands are ready.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/operations/db/schema.test.ts src/modules/operations/db/schema.integrity.test.ts src/modules/operations/db/phase-4b-migration.test.ts`

Expected: FAIL because migration 0013 and Operations schema are absent.

- [ ] **Step 3: Add Drizzle columns and Packing progress table**

```ts
export const orderItemPackingProgress = pgTable(
  "order_item_packing_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    packedQuantity: integer("packed_quantity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("order_item_packing_progress_owner_item_unique").on(table.ownerId, table.orderItemId),
    foreignKey({
      name: "order_item_packing_progress_owned_item_fk",
      columns: [table.ownerId, table.orderItemId],
      foreignColumns: [orderItems.ownerId, orderItems.id],
    }).onDelete("restrict"),
    index("order_item_packing_progress_owner_item_idx").on(table.ownerId, table.orderItemId),
    check("order_item_packing_progress_non_negative", sql`${table.packedQuantity} >= 0`),
  ],
).enableRLS();
```

Add `time("confirmed_delivery_time")` to both Order tables, export the new table from `src/lib/db/schema.ts`, and generate/update Drizzle metadata for migration 0013.

- [ ] **Step 4: Write migration ordering and legacy backfill SQL**

Migration order in this Task must be: nullable time columns → table/FK/index/RLS → legacy backfill → Packing trigger. Task 7 appends fulfillment/Cycle triggers after this block. Backfill exactly:

```sql
INSERT INTO order_item_packing_progress (
  owner_id, order_item_id, packed_quantity
)
SELECT item.owner_id, item.id, item.quantity
FROM order_items AS item
JOIN orders AS order_row
  ON order_row.owner_id = item.owner_id
 AND order_row.id = item.order_id
WHERE item.active = true
  AND order_row.fulfillment_status IN ('PACKED', 'DELIVERED')
ON CONFLICT (owner_id, order_item_id) DO NOTHING;
```

- [ ] **Step 5: Install the authoritative Packing trigger**

`enforce_order_item_packing_progress()` must reject owner/item changes, inactive/missing items, quantity above the active item quantity, Cycle not `IN_PRODUCTION`, Order not exactly `IN_PRODUCTION`, and all deletes. This trigger is created only after the legacy backfill so historical `PACKED | DELIVERED` rows can be initialized.

- [ ] **Step 6: Run schema/migration/integrity tests and verify GREEN**

Run: `pnpm test:run src/modules/operations/db/schema.test.ts src/modules/operations/db/schema.integrity.test.ts src/modules/operations/db/phase-4b-migration.test.ts src/modules/orders/db/schema.test.ts src/modules/planning/db/schema.test.ts`

Expected: PASS, including the Review Focus legacy backfill case and proof that the Packing trigger is installed after backfill.

- [ ] **Step 7: Commit**

```bash
git add drizzle src/lib/db/schema.ts src/modules/orders/db/schema.ts src/modules/planning/db/schema.ts src/modules/operations/db
git commit -m "feat: add operations schema integrity"
```

---

### Task 3: Delivery Time and Payment Ceiling Through Orders and Planning

**Files:**
- Modify: `src/modules/orders/domain/order-form.ts`
- Modify: `src/modules/orders/domain/order-form.test.ts`
- Modify: `src/modules/orders/application/orders.ts`
- Modify: `src/modules/orders/application/orders.test.ts`
- Modify: `src/modules/orders/ui/order-form.tsx`
- Modify: `src/modules/orders/ui/order-form.test.tsx`
- Modify: `src/app/(app)/orders/actions.ts`
- Modify: `src/app/(app)/orders/actions.test.ts`
- Modify: `src/app/(app)/orders/new/page.tsx`
- Modify: `src/app/(app)/orders/new/page.test.tsx`
- Modify: `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/(app)/orders/[id]/page.test.tsx`
- Modify: `src/modules/planning/domain/types.ts`
- Modify: `src/modules/planning/domain/build-preview.test.ts`
- Modify: `src/modules/planning/domain/fingerprint.ts`
- Modify: `src/modules/planning/domain/fingerprint.test.ts`
- Modify: `src/modules/planning/application/load-source.ts`
- Modify: `src/modules/planning/application/snapshot-writer.ts`
- Modify: `src/modules/planning/application/planning-queries.ts`
- Modify: `src/modules/planning/application/planning-queries.test.ts`
- Modify: `tests/fixtures/planning.ts`

**Interfaces:**
- Produces: `OrderFormValues.confirmedDeliveryTime: string`
- Produces: `OrderInput.confirmedDeliveryTime: string | null`, `OrderDetail.confirmedDeliveryTime: string | null`, canonicalized as `HH:mm`
- Produces: `normalizeConfirmedDeliveryTime(value): string` for Order, Planning, and Operations row mappers
- Produces: `PlanningSourceOrder.confirmedDeliveryTime: string | null`, snapshotted `PlanningOrderSnapshot.confirmedDeliveryTime`
- Preserves: identical legacy fingerprint whenever `confirmedDeliveryTime === null`

- [ ] **Step 1: Write failing Order form/service tests**

```ts
it("normalizes an optional local delivery time", () => {
  expect(normalizeOrderForm(orderFormSchema.parse({
    ...VALID_FORM,
    confirmedDeliveryTime: "14:30",
  })).confirmedDeliveryTime).toBe("14:30");
  expect(normalizeOrderForm(orderFormSchema.parse({
    ...VALID_FORM,
    confirmedDeliveryTime: "",
  })).confirmedDeliveryTime).toBeNull();
});

it("rejects amount paid above the computed grand total", () => {
  expect(orderFormSchema.safeParse({
    ...VALID_FORM,
    amountPaidBaht: "999999.00",
  }).error?.issues).toContainEqual(expect.objectContaining({ path: ["amountPaidBaht"] }));
});
```

Add application coverage proving `create` and `update` reject overpayment even when called without the form, time is frozen in `LOCKED | IN_PRODUCTION | COMPLETED`, and payment-only edits remain allowed in those states.

- [ ] **Step 2: Write failing Planning propagation and fingerprint tests**

```ts
it("keeps the legacy fingerprint when optional delivery time is null", () => {
  const legacy = sourceFixture();
  const withNull = { ...legacy, orders: legacy.orders.map((order) => ({
    ...order,
    confirmedDeliveryTime: null,
  })) } as PlanningSourceData;
  expect(createPlanningFingerprint(withNull))
    .toBe(createPlanningFingerprint(legacy));
});

it("changes the fingerprint when the confirmed delivery time changes", () => {
  expect(createPlanningFingerprint(sourceAt("09:00")))
    .not.toBe(createPlanningFingerprint(sourceAt("10:00")));
});
```

Also assert load-source, build-preview, snapshot writer, and generation query round-trip `14:30:00` without UTC conversion.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/orders/domain/order-form.test.ts src/modules/orders/application/orders.test.ts src/modules/orders/ui/order-form.test.tsx src/modules/planning/domain/fingerprint.test.ts src/modules/planning/domain/build-preview.test.ts src/modules/planning/application/planning-queries.test.ts`

Expected: FAIL because time contracts and payment ceilings are missing.

- [ ] **Step 4: Add strict local-time and overpayment validation**

```ts
const optionalLocalTimeSchema = z.union([
  z.literal(""),
  z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "เวลานัดส่งไม่ถูกต้อง"),
]);
```

Add `confirmedDeliveryTime` to form values/input schemas and normalize empty to null. In both form and application schemas, calculate totals after structural validation and add an `amountPaid` issue when `overpaidSatang > 0`; do not remove the existing totals fields used elsewhere.

Add one shared pure helper that accepts PostgreSQL `HH:mm:ss` or form `HH:mm`, validates hour/minute and zero seconds, and returns canonical `HH:mm`. Reject non-zero seconds rather than silently losing precision.

- [ ] **Step 5: Wire the optional time field through Order UI and read models**

Add a `<input type="time" name="confirmedDeliveryTime">` next to confirmed delivery date, disable it when `productionFrozen`, map Thai field errors, initialize empty on create, and initialize the canonical stored value on edit. Add time to `productionInputChanged`, Order list/detail types, insert/update values, row-to-detail mapping, and all fixtures.

- [ ] **Step 6: Wire time through Planning while preserving legacy hashes**

Add the field to Planning source/preview/snapshot/query mappings. In `canonicalize` skip only this null field:

```ts
for (const key of Object.keys(source).sort()) {
  if (
    key === "calculatedAt" ||
    source[key] === undefined ||
    (key === "confirmedDeliveryTime" && source[key] === null)
  ) continue;
  result[key] = canonicalize(source[key], key);
}
```

Store PostgreSQL time without timezone, normalize database `HH:mm:ss` to application `HH:mm` in Order/Planning/Operations row mappers, and never construct a `Date` for the time-only field.

- [ ] **Step 7: Run focused Order/Planning tests and verify GREEN**

Run: `pnpm test:run src/modules/orders/domain/order-form.test.ts src/modules/orders/application/orders.test.ts src/modules/orders/ui/order-form.test.tsx 'src/app/(app)/orders/actions.test.ts' 'src/app/(app)/orders/new/page.test.tsx' 'src/app/(app)/orders/[id]/page.test.tsx' src/modules/planning/domain/fingerprint.test.ts src/modules/planning/domain/build-preview.test.ts src/modules/planning/application/planning-queries.test.ts`

Expected: PASS for valid/invalid time, null compatibility, overpayment rejection, production freeze, fingerprint stability/change, and snapshot/query round-trip.

- [ ] **Step 8: Commit**

```bash
git add src/modules/orders src/app/'(app)'/orders src/modules/planning tests/fixtures/planning.ts
git commit -m "feat: add confirmed delivery time"
```

---

### Task 4: Per-Cycle Operations Read Model

**Files:**
- Create: `src/modules/operations/application/operations-queries.ts`
- Create: `src/modules/operations/application/operations-queries.test.ts`

**Interfaces:**
- Consumes: Task 1 view/rule contracts, Task 2 Packing schema, live Orders, active Planning Snapshot, current Task Generation
- Produces: `createOperationsQueryService(db, clock?)`
- Produces: `getCycleOperations(ownerId, cycleId): Promise<CycleOperationsView>`
- Preserves: Production history stays in `createProductionQueryService`; this query never accepts a historical generation parameter

- [ ] **Step 1: Write failing query tests for view modes and owner isolation**

```ts
it("loads only the active generation and frozen order membership", async () => {
  const view = await service.getCycleOperations(OWNER_ID, cycle.id);
  expect(view.kind).toBe("READY");
  if (view.kind !== "READY") throw new Error("Expected READY");
  expect(view.generation.id).toBe(currentGeneration.id);
  expect(view.tasks.map(({ id }) => id)).toEqual([CURRENT_TASK_ID]);
  expect(view.tasks.map(({ id }) => id)).not.toContain(HISTORICAL_TASK_ID);
  expect(view.orders.map(({ id }) => id)).toEqual([SNAPSHOTTED_ORDER_ID]);
});

it("coalesces a missing packing row to zero", async () => {
  const view = await readyView();
  expect(view.orders[0]?.items[0]?.packedQuantity).toBe(0);
});

it("returns the same not-found error for unknown and cross-owner cycles", async () => {
  const unknown = capture(() => service.getCycleOperations(OWNER_ID, UNKNOWN_ID));
  const foreign = capture(() => service.getCycleOperations(OWNER_ID, FOREIGN_CYCLE_ID));
  await expect(unknown).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations cycle not found" });
  await expect(foreign).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations cycle not found" });
});
```

Add cases for `NO_ACTIVE_PLAN`, `LEGACY_PLAN`, completed/cancelled read-only modes, switcher ordering, cancelled disclosure membership, a live non-cancelled Order missing from the active snapshot, timed/untimed Order sorting, `REFUNDED`, outstanding totals, task overdue/today/future buckets, and an owner with two simultaneous active Cycles.

- [ ] **Step 2: Run query tests and verify RED**

Run: `pnpm test:run src/modules/operations/application/operations-queries.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Resolve the selected Cycle and switcher deterministically**

Validate owner/cycle UUIDs, owner-scope the selected Cycle, and load switcher candidates with status `LOCKED | IN_PRODUCTION`. Sort `IN_PRODUCTION` before `LOCKED`, then primary delivery date, cycle number, and ID. If the selected Cycle is terminal, append it only as the selected read-only option.

```ts
const statusRank = { IN_PRODUCTION: 0, LOCKED: 1 } as const;
activeCycles.sort((left, right) =>
  statusRank[left.status] - statusRank[right.status] ||
  left.primaryDeliveryDate.localeCompare(right.primaryDeliveryDate) ||
  left.cycleNumber - right.cycleNumber ||
  left.id.localeCompare(right.id),
);
```

- [ ] **Step 4: Resolve active snapshot/generation and task buckets**

Use `cycle.activePlanningSnapshotId`, require owner/cycle match, and load its `cycle_task_generations` row. Return `NO_GENERATION` for a missing active snapshot or a legacy snapshot without a Task Generation. Load non-deleted tasks from exactly that generation, convert through a shared row mapper, then call `bucketOperationsTasks(tasks, clock.now())`.

- [ ] **Step 5: Build frozen-membership/live-state Order views**

Use `cycle_order_snapshots` and `cycle_order_item_snapshots` for membership, customer/product names, quantities, prices, delivery date/time, method and totals. Join their `sourceOrderId`/`sourceOrderItemId` to live `orders` and `order_items` for fulfillment/payment timestamps and to Packing progress for mutable quantities. Throw `STALE_DATA` if snapshotted lineage is missing rather than silently dropping it.

Load every live Order in the Cycle. Require the set of live non-cancelled IDs to equal active snapshot membership; return `STALE_DATA` rather than hiding an unsnapshotted active Order. Put live `CANCELLED` orders into `cancelledOrders` separately even though they are excluded from the active Planning Snapshot. Calculate current balance as `max(snapshot.grandTotalSatang - live.amountPaidSatang, 0)` and call `buildOperationsCompletion`.

- [ ] **Step 6: Run query and production regression tests**

Run: `pnpm test:run src/modules/operations/application/operations-queries.test.ts src/modules/production/application/production-queries.test.ts src/modules/planning/application/planning-queries.test.ts`

Expected: PASS for Operations modes/order and unchanged current/history Production behavior.

- [ ] **Step 7: Commit**

```bash
git add src/modules/operations/application/operations-queries.ts src/modules/operations/application/operations-queries.test.ts
git commit -m "feat: query cycle operations workspace"
```

---

### Task 5: Transactional Order Fulfillment and Packing Commands

**Files:**
- Create: `src/modules/operations/application/order-commands.ts`
- Create: `src/modules/operations/application/order-commands.test.ts`
- Modify: `src/lib/db/row-locks.ts`

**Interfaces:**
- Consumes: Task 1 command schemas/errors, Task 2 integrity guards, current Planning/Task generation lineage
- Produces: `createOrderOperationsCommandService(db, clock?)`
- Produces: `confirmOrders(ownerId, input)`, `startOrders(ownerId, input)`, `setPackedQuantity(ownerId, input)`, `confirmOrderPacked(ownerId, input)`, `reopenOrderPacking(ownerId, input)`, `deliverOrders(ownerId, input)`
- Produces row locks: `lockOwnedOrders`, `lockOwnedOrderItem`, `lockOwnedPackingProgress`

- [ ] **Step 1: Write failing batch confirmation/start tests**

```ts
it("confirms and starts sorted owner-scoped batches without partial writes", async () => {
  await service.confirmOrders(OWNER_ID, {
    cycleId: cycle.id,
    orderIds: [SECOND_ORDER_ID, FIRST_ORDER_ID],
  });
  await service.startOrders(OWNER_ID, {
    cycleId: cycle.id,
    orderIds: [FIRST_ORDER_ID, SECOND_ORDER_ID],
  });
  expect(await statuses()).toEqual([
    { id: FIRST_ORDER_ID, status: "IN_PRODUCTION" },
    { id: SECOND_ORDER_ID, status: "IN_PRODUCTION" },
  ]);
});

it("rolls back every order when one batch member is invalid", async () => {
  await setStatus(SECOND_ORDER_ID, "PACKED");
  await expect(service.startOrders(OWNER_ID, batchBoth))
    .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
  expect(await statusOf(FIRST_ORDER_ID)).toBe("CONFIRMED");
});
```

Include duplicate IDs, unknown/foreign IDs, wrong Cycle membership, no current generation, exact retry at target, and a Cycle that changed after the UI read.

- [ ] **Step 2: Write failing Packing and Delivery tests**

```ts
it("treats the first missing progress row as zero and makes a repeated target idempotent", async () => {
  const input = {
    cycleId: cycle.id,
    orderItemId: item.id,
    packedQuantity: 3,
    expectedPackedQuantity: 0,
  };
  await expect(service.setPackedQuantity(OWNER_ID, input)).resolves.toMatchObject({ packedQuantity: 3 });
  await expect(service.setPackedQuantity(OWNER_ID, input)).resolves.toMatchObject({ packedQuantity: 3 });
  expect(await progressRowCount(item.id)).toBe(1);
});

it("rejects a stale competing first write", async () => {
  await service.setPackedQuantity(OWNER_ID, { ...base, packedQuantity: 2, expectedPackedQuantity: 0 });
  await expect(service.setPackedQuantity(OWNER_ID, { ...base, packedQuantity: 1, expectedPackedQuantity: 0 }))
    .rejects.toMatchObject({ kind: "STALE_DATA" });
});

it("requires exact packing before PACKED and PACKED before atomic delivery", async () => {
  await expect(service.confirmOrderPacked(OWNER_ID, singleOrder))
    .rejects.toMatchObject({ kind: "PACKING_INCOMPLETE" });
  await packEveryItem();
  await service.confirmOrderPacked(OWNER_ID, singleOrder);
  await expect(service.deliverOrders(OWNER_ID, batchBoth))
    .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
  expect(await statusOf(FIRST_ORDER_ID)).toBe("PACKED");
});
```

Also cover out-of-range quantities, inactive/non-snapshotted items, `PACKED` edit rejection until reopen, reopen retry, delivered/cancelled immutability, bulk delivery exact retry, and cross-owner non-disclosure.

- [ ] **Step 3: Run command tests and verify RED**

Run: `pnpm test:run src/modules/operations/application/order-commands.test.ts`

Expected: FAIL because the command service and row-lock helpers are absent.

- [ ] **Step 4: Add deterministic row-lock helpers**

```ts
export async function lockOwnedOrders(
  reader: LockingReader,
  ownerId: string,
  orderIds: ReadonlyArray<string>,
) {
  const rows: Array<typeof orders.$inferSelect> = [];
  for (const orderId of [...new Set(orderIds)].sort()) {
    const order = await lockOwnedOrder(reader, ownerId, orderId);
    if (order) rows.push(order);
  }
  return rows;
}
```

Add owner-scoped item/progress locks. Always lock Cycle first, then Orders, Items, and Packing rows. For a missing Packing row, lock the Order Item before insert so concurrent first writes serialize on an existing row.

- [ ] **Step 5: Implement current-generation and membership guards**

Inside each transaction, require:

- selected Cycle belongs to owner
- active Planning Snapshot belongs to that Cycle
- matching current Task Generation exists
- every Order belongs to Cycle and appears in its active Order Snapshot
- every item appears in the matching Order Item Snapshot and is still active

Use the same `OperationsStateError("NOT_FOUND", "Operations record not found")` for missing and cross-owner entities.

- [ ] **Step 6: Implement explicit batch transitions**

`confirmOrders` accepts only `NEW | CONFIRMED` and targets `CONFIRMED`; it works in `LOCKED | IN_PRODUCTION`. `startOrders` accepts only `CONFIRMED | IN_PRODUCTION`, targets `IN_PRODUCTION`, and requires Cycle `IN_PRODUCTION`. Normalize/sort inputs before locking and update all rows inside one transaction.

- [ ] **Step 7: Implement absolute Packing, confirm, reopen, and Delivery**

For `setPackedQuantity`, read missing progress as zero; if current equals target return success, otherwise require current equals expected and target `<= item.quantity`. Insert/upsert the absolute value and timestamp.

`confirmOrderPacked` locks all active items/progress and requires exact completeness before `IN_PRODUCTION -> PACKED`. `reopenOrderPacking` performs only `PACKED -> IN_PRODUCTION` and treats current `IN_PRODUCTION` as retry. `deliverOrders` accepts only `PACKED | DELIVERED`, targets `DELIVERED`, and rolls back the entire batch on any other status.

- [ ] **Step 8: Run command/integrity tests and verify GREEN**

Run: `pnpm test:run src/modules/operations/application/order-commands.test.ts src/modules/operations/db/schema.integrity.test.ts`

Expected: PASS for the full Review Focus missing-row/concurrency/idempotency cases and database backstops.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/row-locks.ts src/modules/operations/application/order-commands.ts src/modules/operations/application/order-commands.test.ts
git commit -m "feat: manage packing and fulfillment"
```

---

### Task 6: Quick Payment, Cycle Start, and Guarded Completion Commands

**Files:**
- Create: `src/modules/operations/application/payment-commands.ts`
- Create: `src/modules/operations/application/payment-commands.test.ts`
- Create: `src/modules/operations/application/cycle-commands.ts`
- Create: `src/modules/operations/application/cycle-commands.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas/errors/readiness, Task 2 triggers, Task 5 lock order
- Produces: `createPaymentOperationsCommandService(db, clock?)`
- Produces: `setOrderAmountPaid(ownerId, input)`
- Produces: `createCycleOperationsCommandService(db, clock?)`
- Produces: `startCycle(ownerId, input)`, `completeCycle(ownerId, input)`

- [ ] **Step 1: Write failing Payment compare-and-set tests**

```ts
it("sets an absolute cumulative target and derives status", async () => {
  await expect(payment.setOrderAmountPaid(OWNER_ID, {
    orderId: order.id,
    targetAmountPaidSatang: 20000,
    expectedAmountPaidSatang: 0,
  })).resolves.toMatchObject({ amountPaidSatang: 20000, paymentStatus: "PARTIAL" });
});

it("returns an exact retry but rejects a different stale target", async () => {
  await payment.setOrderAmountPaid(OWNER_ID, FIRST_PAYMENT);
  await expect(payment.setOrderAmountPaid(OWNER_ID, FIRST_PAYMENT)).resolves.toMatchObject({ amountPaidSatang: 20000 });
  await expect(payment.setOrderAmountPaid(OWNER_ID, {
    ...FIRST_PAYMENT,
    targetAmountPaidSatang: 30000,
  })).rejects.toMatchObject({ kind: "STALE_DATA" });
});
```

Add target zero correction, exact full amount, one-satang overpayment, safe-integer total, `REFUNDED`, unknown/foreign, and successful payment after Order `DELIVERED` plus Cycle `COMPLETED`.

- [ ] **Step 2: Write failing Cycle start/completion tests**

```ts
it("starts only a locked cycle with the current task generation", async () => {
  await expect(cycles.startCycle(OWNER_ID, { cycleId: cycle.id }))
    .resolves.toMatchObject({ status: "IN_PRODUCTION" });
  await expect(cycles.startCycle(OWNER_ID, { cycleId: cycle.id }))
    .resolves.toMatchObject({ status: "IN_PRODUCTION" });
});

it("blocks incomplete work but permits an unpaid warning", async () => {
  await expect(cycles.completeCycle(OWNER_ID, completionInput))
    .rejects.toMatchObject({ kind: "CYCLE_COMPLETION_BLOCKED" });
  await finishTasksAndDeliverOrders({ leavePaymentPartial: true });
  await expect(cycles.completeCycle(OWNER_ID, completionInput)).resolves.toMatchObject({
    cycleStatus: "COMPLETED",
    unpaidOrderCount: 1,
    outstandingSatang: 42000,
  });
});
```

Add wrong expected generation, superseded generation, soft-deleted manual task exclusion, `SKIPPED` reason integrity, cancelled Order exclusion, exact completion retry, cross-owner non-disclosure, and a race simulation where state changes after a readiness read but before the command.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/operations/application/payment-commands.test.ts src/modules/operations/application/cycle-commands.test.ts`

Expected: FAIL because the services do not exist.

- [ ] **Step 4: Implement atomic Payment target updates**

Lock the Order and its Cycle, load active items, calculate authoritative `grandTotalSatang`, reject `REFUNDED`, and compare current/expected/target in that order:

```ts
if (input.targetAmountPaidSatang > total.grandTotalSatang) paymentOutOfRange();
if (existing.amountPaidSatang === input.targetAmountPaidSatang) return toPaymentResult(existing, total);
if (existing.amountPaidSatang !== input.expectedAmountPaidSatang) stalePayment();
```

Set `paymentStatus` to `UNPAID | PARTIAL | PAID`, update timestamp, and return the new balance. Do not require Cycle to be active so COD corrections work after completion.

- [ ] **Step 5: Implement idempotent Cycle start**

Lock the Cycle, return success if already `IN_PRODUCTION`, otherwise require `LOCKED`, active Planning Snapshot, and matching Task Generation. Update using an old-state predicate so a concurrent change becomes `STALE_DATA`.

- [ ] **Step 6: Implement guarded Cycle completion**

Lock Cycle → active Snapshot → expected Task Generation → non-deleted Tasks → all Cycle Orders sorted by ID. Recompute readiness inside the transaction. Reject blockers with counts in `OperationsStateError.details`; ignore `CANCELLED` for readiness; retain unpaid/partial count and balance as result warnings. Update only `IN_PRODUCTION -> COMPLETED`. If already completed with the same active generation, return the current warning summary as an exact retry.

- [ ] **Step 7: Run command, integrity, and totals regressions**

Run: `pnpm test:run src/modules/operations/application/payment-commands.test.ts src/modules/operations/application/cycle-commands.test.ts src/modules/operations/db/schema.integrity.test.ts src/modules/orders/domain/totals.test.ts`

Expected: PASS for Payment/cycle commands, Review Focus retries/races, and existing total calculations.

- [ ] **Step 8: Commit**

```bash
git add src/modules/operations/application/payment-commands.ts src/modules/operations/application/payment-commands.test.ts src/modules/operations/application/cycle-commands.ts src/modules/operations/application/cycle-commands.test.ts
git commit -m "feat: guard operations payment and completion"
```

---

### Task 7: Unlock Guard and Legacy Mutation Bypass Closure

**Files:**
- Create: `src/modules/operations/application/unlock-guard.ts`
- Create: `src/modules/operations/application/unlock-guard.test.ts`
- Modify: `src/modules/planning/application/planning-commands.ts`
- Modify: `src/modules/planning/application/planning-commands.test.ts`
- Modify: `src/app/(app)/cycles/[id]/planning/actions.ts`
- Modify: `src/app/(app)/cycles/[id]/planning/actions.test.ts`
- Modify: `src/modules/orders/application/orders.ts`
- Modify: `src/modules/orders/application/orders.test.ts`
- Modify: `src/modules/cycles/application/cycles.ts`
- Modify: `src/modules/cycles/application/cycles.test.ts`
- Modify: `src/modules/cycles/ui/cycle-status-form.tsx`
- Modify: `src/modules/cycles/ui/cycle-status-form.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/production/actions.ts`
- Modify: `src/app/(app)/cycles/[id]/production/actions.test.ts`
- Modify: `drizzle/0013_phase_4b_operations.sql`
- Modify: `src/modules/operations/db/schema.test.ts`
- Modify: `src/modules/operations/db/schema.integrity.test.ts`
- Modify: `src/modules/operations/db/phase-4b-migration.test.ts`

**Interfaces:**
- Produces: `assertCycleOperationsUnlockAllowed(reader, ownerId, cycleId): Promise<void>`
- Changes: Planning unlock invokes this guard after locking Cycle and active Snapshot, before superseding
- Changes: generic Order service retains only dedicated pre-freeze `NEW -> CONFIRMED` plus cancellation/refund; Operations owns locked/production transitions
- Produces SQL functions: `enforce_order_fulfillment_transition()`, `enforce_cycle_operations_lifecycle()`

- [ ] **Step 1: Write failing unlock guard tests**

```ts
it.each(["IN_PRODUCTION", "PACKED", "DELIVERED"] as const)(
  "blocks unlock after an order reaches %s",
  async (status) => {
    await setOrderStatus(status);
    await expect(assertCycleOperationsUnlockAllowed(db, OWNER_ID, cycle.id))
      .rejects.toMatchObject({
        kind: "UNLOCK_BLOCKED_BY_OPERATIONS",
        message: "Cycle operations have started",
      });
  },
);

it("allows unlock after payment or task progress alone", async () => {
  await recordPayment();
  await markTaskInProgress();
  await expect(assertCycleOperationsUnlockAllowed(db, OWNER_ID, cycle.id))
    .resolves.toBeUndefined();
});
```

Add positive Packing progress, a zero Packing row, cancelled orders, cross-owner rows, and Planning unlock rollback proof.

- [ ] **Step 2: Write failing bypass tests**

Assert that `createOrderService(db).updateFulfillmentStatus(...)` cannot perform generic forward jumps, dedicated `confirmBeforeProduction(...)` permits only `NEW -> CONFIRMED` while Cycle is `DRAFT | OPEN`, `createCycleService(db).changeStatus(..., "IN_PRODUCTION" | "COMPLETED")` rejects, Cycle status form omits those targets, and Production task actions revalidate `/cycles/${cycleId}/operations`.

Add database assertions that direct Order/Cycle updates cannot jump fulfillment, pack incomplete Orders, deliver unpacked Orders, start without a current generation, complete unfinished work, or unlock after Operations began.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/operations/application/unlock-guard.test.ts src/modules/planning/application/planning-commands.test.ts src/modules/orders/application/orders.test.ts src/modules/cycles/application/cycles.test.ts src/modules/cycles/ui/cycle-status-form.test.tsx 'src/app/(app)/cycles/[id]/production/actions.test.ts'`

Expected: FAIL because old services still bypass Operations and unlock has no operational guard.

- [ ] **Step 4: Implement the unlock predicate and inject it into Planning**

```ts
export async function assertCycleOperationsUnlockAllowed(
  reader: Pick<DatabaseClient, "select">,
  ownerId: string,
  cycleId: string,
): Promise<void> {
  const operationalOrders = await reader.select({ id: orders.id })
    .from(orders)
    .where(and(
      eq(orders.ownerId, ownerId),
      eq(orders.bakeCycleId, cycleId),
      inArray(orders.fulfillmentStatus, ["IN_PRODUCTION", "PACKED", "DELIVERED"]),
    )).limit(1);
  // Also join Packing progress -> Order Item -> Order and reject packed_quantity > 0.
  if (operationalOrders.length > 0 || positiveProgress.length > 0) {
    throw new OperationsStateError(
      "UNLOCK_BLOCKED_BY_OPERATIONS",
      "Cycle operations have started",
    );
  }
}
```

Call inside the existing Planning transaction after Cycle/Snapshot locks and before updating snapshot status. Preserve test dependency injection so Planning unit tests can prove the guard call and rollback.

- [ ] **Step 5: Close application/UI bypasses**

- keep order cancellation/refund behavior in `orders`; replace generic forward mutation with `confirmBeforeProduction(ownerId, orderId)` that locks the authoritative Cycle and accepts only `NEW | CONFIRMED` while Cycle is `DRAFT | OPEN`
- make every locked/production fulfillment transition use Operations commands; no pre-freeze service may pack or deliver
- make generic Cycle service reject targets `LOCKED | IN_PRODUCTION | COMPLETED`; Operations owns the latter two
- filter Operations-managed targets from `CycleStatusForm`, leaving cancellation where legal
- add exact Operations route revalidation to every Cycle Task mutation
- map unlock blocker to “ปลดล็อกรอบไม่ได้ เพราะเริ่มทำออเดอร์แล้ว” without hiding other Planning errors

- [ ] **Step 6: Append authoritative fulfillment and Cycle triggers after the backfill/Packing trigger**

`enforce_order_fulfillment_transition()` permits no-op updates plus exactly:

```text
NEW -> CONFIRMED                    cycle DRAFT|OPEN|LOCKED|IN_PRODUCTION
CONFIRMED -> IN_PRODUCTION          cycle IN_PRODUCTION
IN_PRODUCTION -> PACKED             cycle IN_PRODUCTION + every active item complete
PACKED -> DELIVERED                 cycle IN_PRODUCTION
PACKED -> IN_PRODUCTION             cycle IN_PRODUCTION (explicit correction path)
NEW|CONFIRMED|IN_PRODUCTION|PACKED
                  -> CANCELLED      cycle DRAFT|OPEN (preserve the existing pre-freeze cancellation rule)
```

`enforce_cycle_operations_lifecycle()` requires the current Task Generation for start; checks current non-deleted Tasks and non-cancelled Orders for completion; and rejects `LOCKED|IN_PRODUCTION -> OPEN` after operational Order/Packing progress. Use stable message markers tested in `schema.integrity.test.ts`.

- [ ] **Step 7: Run guard/bypass regressions and verify GREEN**

Run the focused command from Step 3 plus `pnpm test:run src/modules/operations/db/schema.test.ts src/modules/operations/db/schema.integrity.test.ts src/modules/operations/db/phase-4b-migration.test.ts`.

Expected: PASS; Planning unlock remains valid with task/payment-only changes, every operational blocker rejects, and old UI/service paths cannot start/complete/pack/deliver.

- [ ] **Step 8: Commit**

```bash
git add drizzle/0013_phase_4b_operations.sql src/modules/operations/db src/modules/operations/application/unlock-guard.ts src/modules/operations/application/unlock-guard.test.ts src/modules/planning src/modules/orders/application src/modules/cycles src/app/'(app)'/cycles/'[id]'/planning src/app/'(app)'/cycles/'[id]'/production
git commit -m "fix: close operations lifecycle bypasses"
```

---

### Task 8: Authenticated Operations Server Actions and Existing Order Action Integration

**Files:**
- Create: `src/app/(app)/cycles/[id]/operations/actions.ts`
- Create: `src/app/(app)/cycles/[id]/operations/actions.test.ts`
- Modify: `src/app/(app)/orders/actions.ts`
- Modify: `src/app/(app)/orders/actions.test.ts`

**Interfaces:**
- Consumes: Tasks 5–6 command services and Task 1 Zod schemas/errors
- Produces: `OperationsActionState`
- Produces actions: `startCycleAction`, `confirmOrdersAction`, `startOrdersAction`, `setPackedQuantityAction`, `confirmOrderPackedAction`, `reopenOrderPackingAction`, `setOrderAmountPaidAction`, `deliverOrdersAction`, `completeCycleAction`
- Changes: existing `updateFulfillmentStatusAction` uses dedicated pre-freeze confirmation for `DRAFT | OPEN` and guarded Operations commands after lock

- [ ] **Step 1: Write failing auth/parse/delegation tests**

```ts
it.each([
  ["startCycleAction", startCycleAction],
  ["confirmOrdersAction", confirmOrdersAction],
  ["startOrdersAction", startOrdersAction],
  ["setPackedQuantityAction", setPackedQuantityAction],
  ["setOrderAmountPaidAction", setOrderAmountPaidAction],
  ["deliverOrdersAction", deliverOrdersAction],
  ["completeCycleAction", completeCycleAction],
])("%s authenticates before mutation", async (_name, action) => {
  await action(INITIAL_STATE, validFormData());
  expect(mocks.requireOwner).toHaveBeenCalledOnce();
});

it("does not call a command for invalid JSON or invalid UUIDs", async () => {
  const data = new FormData();
  data.set("payload", "not-json");
  const result = await deliverOrdersAction(INITIAL_STATE, data);
  expect(result).toMatchObject({ saved: false, kind: "INVALID_INPUT" });
  expect(mocks.deliverOrders).not.toHaveBeenCalled();
});
```

Add one success/error test per action, typed error Thai mapping, unexpected-error logging without payload/customer data, and proof that auth failure is not swallowed.

- [ ] **Step 2: Write failing revalidation and Order detail delegation tests**

Assert successful operations revalidate exact selected Cycle operations/production/planning/detail paths, `/cycles`, `/orders`, affected `/orders/${orderId}`, and `/dashboard`. Assert existing Order action maps `CONFIRMED`, `IN_PRODUCTION`, `PACKED`, and `DELIVERED` to the corresponding guarded command and cannot jump because the command rejects it.

- [ ] **Step 3: Run action tests and verify RED**

Run: `pnpm test:run 'src/app/(app)/cycles/[id]/operations/actions.test.ts' 'src/app/(app)/orders/actions.test.ts'`

Expected: FAIL because Operations actions do not exist and Order actions still use the old generic service.

- [ ] **Step 4: Implement stable action state and error mapping**

```ts
export type OperationsActionState = Readonly<{
  error: string | null;
  kind: "INVALID_INPUT" | OperationsErrorKind | null;
  fieldErrors: Readonly<Record<string, string>>;
  saved: boolean;
}>;

function operationsErrorState(error: unknown): OperationsActionState {
  if (!(error instanceof OperationsStateError)) {
    return { error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง", kind: null, fieldErrors: {}, saved: false };
  }
  return {
    error: THAI_OPERATIONS_ERRORS[error.kind],
    kind: error.kind,
    fieldErrors: fieldErrorsFromDetails(error),
    saved: false,
  };
}
```

Use a strict `readPayload(formData)` helper; never trust `ownerId`, status, totals, quantity limits, or readiness sent by the browser.

- [ ] **Step 5: Implement actions and cache revalidation**

Each action calls `requireOwner()`, parses one Task 1 schema, calls exactly one command, then revalidates affected paths. Do not redirect; React Server Actions must return state so Client Components retain input and selection on failure.

```ts
function revalidateOperationsViews(cycleId: string, orderIds: readonly string[] = []) {
  for (const path of [
    `/cycles/${cycleId}/operations`,
    `/cycles/${cycleId}/production`,
    `/cycles/${cycleId}/planning`,
    `/cycles/${cycleId}`,
    "/cycles",
    "/orders",
    "/dashboard",
  ]) revalidatePath(path);
  for (const orderId of orderIds) revalidatePath(`/orders/${orderId}`);
}
```

- [ ] **Step 6: Route existing Order fulfillment actions through Operations**

Extend the form schema with `cycleId`, but re-read the Order and Cycle authoritatively instead of trusting it. Dispatch only the requested adjacent target:

```ts
switch (parsed.data.status) {
  case "CONFIRMED":
    if (authoritativeOrder.cycleStatus === "DRAFT" || authoritativeOrder.cycleStatus === "OPEN") {
      await orderService.confirmBeforeProduction(owner.id, authoritativeOrder.id);
    } else {
      await orderOperations.confirmOrders(owner.id, authoritativeBatchInput);
    }
    break;
  case "IN_PRODUCTION":
    await orderOperations.startOrders(owner.id, batchInput);
    break;
  case "PACKED":
    await orderOperations.confirmOrderPacked(owner.id, singleInput);
    break;
  case "DELIVERED":
    await orderOperations.deliverOrders(owner.id, batchInput);
    break;
  default:
    return invalidStatusState;
}
```

Cancellation/refund/restore remain in the Order service. Map Packing incomplete to a useful link/message instead of a generic failure.

- [ ] **Step 7: Run action tests and verify GREEN**

Run the command from Step 3.

Expected: PASS for auth, validation, service dispatch, typed errors, logs, revalidation, and no legacy status bypass.

- [ ] **Step 8: Commit**

```bash
git add src/app/'(app)'/cycles/'[id]'/operations/actions.ts src/app/'(app)'/cycles/'[id]'/operations/actions.test.ts src/app/'(app)'/orders/actions.ts src/app/'(app)'/orders/actions.test.ts
git commit -m "feat: add operations server actions"
```

---

### Task 9: Shared Task Card, Cycle Header, and Today-First Timeline

**Files:**
- Create: `src/modules/production/ui/cycle-task-card.tsx`
- Create: `src/modules/production/ui/cycle-task-card.test.tsx`
- Modify: `src/modules/production/ui/cycle-task-list.tsx`
- Modify: `src/modules/production/ui/cycle-task-list.test.tsx`
- Create: `src/modules/operations/ui/operations-header.tsx`
- Create: `src/modules/operations/ui/operations-header.test.tsx`
- Create: `src/modules/operations/ui/operations-task-timeline.tsx`
- Create: `src/modules/operations/ui/operations-task-timeline.test.tsx`

**Interfaces:**
- Consumes: Task 4 header/switcher/task buckets, Task 8 `startCycleAction`, existing Production task actions
- Produces: `CycleTaskCard` reusable by Production and Operations
- Produces: `OperationsHeader`, `OperationsTaskTimeline`

- [ ] **Step 1: Write failing extraction regression tests**

```tsx
it("keeps all existing task controls after extracting the shared card", () => {
  render(<CycleTaskCard {...CURRENT_TASK_PROPS} />);
  expect(screen.getByRole("button", { name: "ทำเสร็จแล้ว" })).toBeVisible();
  expect(screen.getByRole("button", { name: "ข้ามงาน" })).toBeVisible();
  expect(screen.getByRole("button", { name: "แก้ไขงาน" })).toBeVisible();
});
```

Preserve generated/manual delete rules, skip reason, batch count, edit form, and history read-only behavior from existing `CycleTaskList` tests.

- [ ] **Step 2: Write failing Header and task-bucket component tests**

```tsx
it("shows overdue and today while future work starts collapsed", () => {
  render(<OperationsTaskTimeline buckets={TASK_BUCKETS} {...actions} />);
  expect(screen.getByRole("heading", { name: "เลยกำหนด" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "วันนี้" })).toBeVisible();
  const future = screen.getByRole("group", { name: /วันถัดไป/ });
  expect(future).not.toHaveAttribute("open");
});

it("switches one cycle at a time and shows start only while locked", () => {
  render(<OperationsHeader view={LOCKED_HEADER} />);
  expect(screen.getByLabelText("เลือกรอบผลิต")).toHaveValue(CYCLE_ID);
  expect(screen.getByRole("button", { name: "เริ่มรอบผลิต" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "จบรอบผลิต" })).toBeNull();
});
```

Also test terminal read-only badges, selected completed Cycle in switcher, empty overdue/today state, and phone-accessible labels/touch targets.

- [ ] **Step 3: Run focused UI tests and verify RED**

Run: `pnpm test:run src/modules/production/ui/cycle-task-card.test.tsx src/modules/production/ui/cycle-task-list.test.tsx src/modules/operations/ui/operations-header.test.tsx src/modules/operations/ui/operations-task-timeline.test.tsx`

Expected: FAIL because new components do not exist.

- [ ] **Step 4: Extract `CycleTaskCard` without changing Production behavior**

Move Task rendering, quick status actions, edit state and manual deletion from `cycle-task-list.tsx` into the new component. Keep Product Timeline responsible only for date grouping, generation history, and “เพิ่มงานเอง”. Run old tests before adding Operations-specific behavior.

- [ ] **Step 5: Implement the one-Cycle header and explicit start form**

Use a labelled `<select>` with `useRouter().push(`/cycles/${id}/operations`)`, status badge, delivery date, current generation, links to Production/Planning, and a `useActionState(startCycleAction, INITIAL_STATE)` form for `LOCKED`. `COMPLETED | CANCELLED` display read-only text; completion controls are provided by Task 10.

- [ ] **Step 6: Implement overdue/today/future task rendering**

Render `CycleTaskCard` in the order provided by Task 4. Overdue and today are always expanded. Future tasks live in `<details aria-label="งานวันถัดไป">`. Pass `writable` only when the generation is active and Cycle is `LOCKED | IN_PRODUCTION`; terminal Cycles remain read-only.

- [ ] **Step 7: Run UI/Production regressions and verify GREEN**

Run the command from Step 3 plus `pnpm test:run 'src/app/(app)/cycles/[id]/production/page.test.tsx'`.

Expected: PASS with unchanged Production Timeline and new today-first Operations behavior.

- [ ] **Step 8: Commit**

```bash
git add src/modules/production/ui src/modules/operations/ui/operations-header.tsx src/modules/operations/ui/operations-header.test.tsx src/modules/operations/ui/operations-task-timeline.tsx src/modules/operations/ui/operations-task-timeline.test.tsx
git commit -m "feat: add operations timeline header"
```

---

### Task 10: Mobile Packing, Quick Payment, Bulk Delivery, and Completion UI

**Files:**
- Create: `src/modules/operations/ui/packing-progress-form.tsx`
- Create: `src/modules/operations/ui/packing-progress-form.test.tsx`
- Create: `src/modules/operations/ui/quick-payment-form.tsx`
- Create: `src/modules/operations/ui/quick-payment-form.test.tsx`
- Create: `src/modules/operations/ui/operations-payment-board.tsx`
- Create: `src/modules/operations/ui/operations-payment-board.test.tsx`
- Create: `src/modules/operations/ui/operations-order-card.tsx`
- Create: `src/modules/operations/ui/operations-order-card.test.tsx`
- Create: `src/modules/operations/ui/operations-order-board.tsx`
- Create: `src/modules/operations/ui/operations-order-board.test.tsx`
- Create: `src/modules/operations/ui/cycle-completion-form.tsx`
- Create: `src/modules/operations/ui/cycle-completion-form.test.tsx`

**Interfaces:**
- Consumes: Task 4 sorted `OperationsOrder[]`/completion state and Task 8 actions
- Produces: `PackingProgressForm`, `QuickPaymentForm`, `OperationsPaymentBoard`, `OperationsOrderCard`, `OperationsOrderBoard`, `CycleCompletionForm`
- Preserves: Client-entered quantities/payment and checkbox selection after action failure

- [ ] **Step 1: Write failing Packing and Payment form tests**

```tsx
it("submits an absolute packed target and keeps it after a server error", async () => {
  action.mockResolvedValue({ ...ERROR_STATE, kind: "STALE_DATA", error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่" });
  const user = userEvent.setup();
  render(<PackingProgressForm item={ITEM_AT_TWO_OF_TEN} action={action} />);
  await user.clear(screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia"));
  await user.type(screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia"), "6");
  await user.click(screen.getByRole("button", { name: "บันทึกจำนวนแพ็ก Focaccia" }));
  expect(payloadOf(action)).toMatchObject({ packedQuantity: 6, expectedPackedQuantity: 2 });
  expect(screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia")).toHaveValue(6);
});

it("computes receive-more and pay-full as cumulative targets", async () => {
  const user = userEvent.setup();
  render(<QuickPaymentForm order={PARTIAL_ORDER} action={action} />);
  await user.type(screen.getByLabelText("รับเพิ่ม"), "220.00");
  await user.click(screen.getByRole("button", { name: "บันทึกรับเงิน" }));
  expect(payloadOf(action).targetAmountPaidSatang).toBe(42000);
  await user.click(screen.getByRole("button", { name: "ชำระครบ" }));
  expect(lastPayloadOf(action).targetAmountPaidSatang).toBe(PARTIAL_ORDER.grandTotalSatang);
});
```

Cover decrement/increment boundaries, invalid baht, overpayment client guard, target correction to zero, pending disable, `REFUNDED` read-only, and Payment enabled on delivered/completed views.

- [ ] **Step 2: Write failing Order board/bulk/completion tests**

```tsx
it("shows confirm packed only after every item is complete", () => {
  const { rerender } = render(<OperationsOrderCard order={PARTIAL_PACKING_ORDER} {...actions} />);
  expect(screen.queryByRole("button", { name: "ยืนยันแพ็กครบ" })).toBeNull();
  rerender(<OperationsOrderCard order={FULL_PACKING_ORDER} {...actions} />);
  expect(screen.getByRole("button", { name: "ยืนยันแพ็กครบ" })).toBeVisible();
});

it("keeps selected packed orders after an atomic delivery error", async () => {
  deliverAction.mockResolvedValue({ ...ERROR_STATE, kind: "STALE_DATA" });
  const user = userEvent.setup();
  render(<OperationsOrderBoard orders={PACKED_ORDERS} {...actions} />);
  await user.click(screen.getByLabelText(`เลือกจัดส่ง ${FIRST_CUSTOMER}`));
  await user.click(screen.getByLabelText(`เลือกจัดส่ง ${SECOND_CUSTOMER}`));
  await user.click(screen.getByRole("button", { name: "ยืนยันส่งสำเร็จ 2 ออเดอร์" }));
  expect(screen.getByLabelText(`เลือกจัดส่ง ${FIRST_CUSTOMER}`)).toBeChecked();
  expect(screen.getByLabelText(`เลือกจัดส่ง ${SECOND_CUSTOMER}`)).toBeChecked();
});
```

Also test batch NEW confirm, batch CONFIRMED start, explicit reopen, delivered packing read-only, cancelled disclosure, a separate sorted “รับชำระเงิน” section, delivery/payment warnings, disabled completion with reasons, unpaid confirmation, and completed read-only except Payment.

Add a repeated-success regression: submit the same form twice with two distinct successful action-state objects whose `saved` value remains `true`, and prove the second success still clears its current input/selection.

- [ ] **Step 3: Run component tests and verify RED**

Run: `pnpm test:run src/modules/operations/ui/packing-progress-form.test.tsx src/modules/operations/ui/quick-payment-form.test.tsx src/modules/operations/ui/operations-payment-board.test.tsx src/modules/operations/ui/operations-order-card.test.tsx src/modules/operations/ui/operations-order-board.test.tsx src/modules/operations/ui/cycle-completion-form.test.tsx`

Expected: FAIL because the UI components do not exist.

- [ ] **Step 4: Implement absolute Packing and Quick Payment forms**

Use controlled local inputs plus hidden JSON payloads. `+/-` modifies only local state; one explicit submit writes the absolute target. Use `startTransition(() => formAction(formData))` when constructing FormData programmatically, disable during pending, and show action errors with `role="alert"`.

For Quick Payment, parse baht with the existing money helper, calculate `target = current + received`, and expose a correction mode that edits the cumulative target directly. Render “ชำระครบ” only when balance is positive.

`OperationsPaymentBoard` renders one compact Quick Payment row per non-cancelled Order in the same delivery date/time/method/customer order as Task 4. Keep it active for delivered Orders and completed Cycles; render `REFUNDED` as read-only with a link to Order detail.

- [ ] **Step 5: Implement status-aware Order cards**

- `NEW`: selectable for “ยืนยันออเดอร์”
- `CONFIRMED`: selectable for “เริ่มทำออเดอร์”; disabled until Cycle `IN_PRODUCTION`
- `IN_PRODUCTION`: Packing forms plus “ยืนยันแพ็กครบ” only when every item matches
- `PACKED`: summary, explicit “เปิดแก้ไขการแพ็ก”, and delivery selection
- `DELIVERED`: read-only packing/fulfillment; Quick Payment remains available in the separate Payment board
- `CANCELLED`: read-only card inside the cancelled disclosure

Always display confirmed date/time (`ยังไม่กำหนดเวลา` for null), delivery method, customer, payment badge, totals, and special delivery notes.

- [ ] **Step 6: Implement bulk action board and atomic selection UX**

Keep a local `Set<string>` per eligible group and preserve it on errors. Observe the entire returned action-state object (`useEffect(..., [state])`), not only `[state.saved]`, so consecutive successful submissions whose boolean remains `true` still clear the current selection. Render active orders in Task 4 sort order inside workflow sections and send normalized ID arrays in one payload. Confirm Delivery with customer/method summary and outstanding warning.

- [ ] **Step 7: Implement guarded completion confirmation**

When not ready, disable the button and list task/order blocker counts. When ready, submit expected Task Generation ID only after confirmation. If `unpaidOrderCount > 0`, the dialog must show count, formatted outstanding amount, and “หลังจบรอบยังบันทึกยอดชำระได้”. Do not disable completion for Payment warnings.

- [ ] **Step 8: Run component tests and verify GREEN**

Run the command from Step 3.

Expected: PASS for all states, local-value retention, batch selection retention, accessible controls, completion blockers/warnings, and terminal behavior.

- [ ] **Step 9: Commit**

```bash
git add src/modules/operations/ui
git commit -m "feat: build mobile operations controls"
```

---

### Task 11: Operations Page, Navigation, Dashboard, and Order Detail Integration

**Files:**
- Create: `src/app/(app)/cycles/[id]/operations/page.tsx`
- Create: `src/app/(app)/cycles/[id]/operations/page.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/cycle-detail.tsx`
- Modify: `src/app/(app)/cycles/[id]/page.test.tsx`
- Modify: `src/modules/cycles/ui/cycle-list.tsx`
- Modify: `src/modules/cycles/ui/cycle-list.test.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/dashboard/current-cycle-card.tsx`
- Modify: `src/app/(app)/dashboard/current-cycle-card.test.tsx`
- Modify: `src/modules/orders/ui/order-status-actions.tsx`
- Modify: `src/modules/orders/ui/order-status-actions.test.tsx`
- Modify: `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/(app)/orders/[id]/page.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/production/page.tsx`
- Modify: `src/app/(app)/cycles/[id]/production/page.test.tsx`
- Modify: `src/components/app-shell.test.tsx`

**Interfaces:**
- Consumes: Task 4 query, Tasks 9–10 UI, Task 8 actions
- Produces route: `/cycles/[id]/operations`
- Produces: `selectCurrentOperatingCycle(cycles)` with priority `IN_PRODUCTION`, `LOCKED`, then `OPEN`

- [ ] **Step 1: Write failing Operations page tests**

```tsx
it("awaits Next 16 params, loads the owner-scoped view, and renders all sections", async () => {
  mocks.getCycleOperations.mockResolvedValue(READY_VIEW);
  render(await OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
  expect(mocks.requireOwner).toHaveBeenCalledOnce();
  expect(mocks.getCycleOperations).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
  expect(screen.getByRole("heading", { name: "Operations" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "ต้องทำอะไรต่อ" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "เตรียมและแพ็กออเดอร์" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "รับชำระเงิน" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "พร้อมจัดส่ง" })).toBeVisible();
});
```

Add `NO_GENERATION`, not-found, completed Payment-only, cancelled read-only, and no cross-Cycle timeline cases. Scope render assertions to each test container so one render cannot satisfy another.

- [ ] **Step 2: Write failing navigation/dashboard/detail tests**

Assert:

- Cycle detail/list show “เปิด Operations” for `LOCKED | IN_PRODUCTION` and “ดู Operations” for terminal history where available
- dashboard prioritizes an `IN_PRODUCTION` Cycle over earlier `LOCKED`/`OPEN`, links to Operations, and only shows “เพิ่มออเดอร์” for `OPEN`
- Order detail includes `cycleId` in guarded status forms, offers only the next legal action, links to its Cycle Operations, and shows reopen only for `PACKED`
- Production Timeline links current generation to Operations
- `/cycles/[id]/operations` keeps the “รอบผลิต” shell navigation active

- [ ] **Step 3: Run page/navigation tests and verify RED**

Run: `pnpm test:run 'src/app/(app)/cycles/[id]/operations/page.test.tsx' 'src/app/(app)/cycles/[id]/page.test.tsx' src/modules/cycles/ui/cycle-list.test.tsx 'src/app/(app)/dashboard/current-cycle-card.test.tsx' src/modules/orders/ui/order-status-actions.test.tsx 'src/app/(app)/orders/[id]/page.test.tsx' 'src/app/(app)/cycles/[id]/production/page.test.tsx' src/components/app-shell.test.tsx`

Expected: FAIL because the route and links do not exist and current dashboard/status UI reflects Phase 4A.

- [ ] **Step 4: Compose the Server Component route**

```tsx
export default async function OperationsPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const owner = await requireOwner();
  const { id } = await params;
  let view: CycleOperationsView;
  try {
    view = await createOperationsQueryService(db).getCycleOperations(owner.id, id);
  } catch (error) {
    if (error instanceof OperationsStateError && error.kind === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-8">
      <h1 className="text-3xl font-bold">Operations</h1>
      <OperationsHeader view={view} />
      {view.kind === "READY" ? (
        <>
          <OperationsTaskTimeline view={view} />
          <OperationsOrderBoard view={view} />
          <OperationsPaymentBoard view={view} />
          <CycleCompletionForm view={view} />
        </>
      ) : (
        <p className="rounded-2xl border border-stone-200 bg-white p-5">
          รอบนี้ยังไม่มี Operations generation กรุณาตรวจแผนการผลิต
        </p>
      )}
    </main>
  );
}
```

Compose Header, Timeline, Order Board, Delivery and Completion in semantic sections. For `NO_GENERATION`, render links to Planning/Production and no mutation controls.

- [ ] **Step 5: Add Cycle and Production entry points**

Add Operations links to Cycle detail/list and current Production page without changing historical generation links. Use Operations as the primary CTA for `LOCKED | IN_PRODUCTION`; retain Planning, Production and Shopping as secondary links.

- [ ] **Step 6: Make dashboard represent the current operating Cycle**

Load candidate Cycles, select by status priority then delivery date/cycle number, and fetch only the selected summary. Render:

- `IN_PRODUCTION`: “กำลังผลิต” + primary “เปิด Operations”
- `LOCKED`: “พร้อมเริ่มผลิต” + primary “เปิด Operations”
- `OPEN`: existing “เพิ่มออเดอร์”/detail actions
- no candidate: existing create Cycle empty state

- [ ] **Step 7: Restrict Order detail to the next guarded action**

Replace the “all later statuses” filter with exactly one next transition. Include hidden `cycleId`; route forward actions through Task 8. For `PACKED`, show “เปิดแก้ไขการแพ็ก” and “จัดส่งแล้ว”; for any active frozen Order show a visible Operations link. Do not restore cancellation after production freeze.

- [ ] **Step 8: Run page/navigation tests and verify GREEN**

Run the command from Step 3.

Expected: PASS for route modes, dynamic params, active navigation, dashboard priority, legal next actions, and all entry points.

- [ ] **Step 9: Commit**

```bash
git add src/app/'(app)'/cycles src/app/'(app)'/dashboard src/app/'(app)'/orders/'[id]' src/modules/cycles/ui src/modules/orders/ui src/components/app-shell.test.tsx
git commit -m "feat: connect operations workspace"
```

---

### Task 12: Authenticated E2E, Documentation, and Release Verification

**Files:**
- Create: `tests/e2e/operations.spec.ts`
- Modify: `tests/fixtures/owner.ts`
- Modify: `tests/e2e/orders.spec.ts`
- Modify: `tests/e2e/planning.spec.ts`
- Modify: `tests/e2e/production.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: all Phase 4B routes/actions and authenticated Playwright environment
- Produces: owner fixture support for optional confirmed delivery time and Phase 4B release evidence

- [ ] **Step 1: Extend the Order fixture and write the failing E2E scenario**

```ts
export async function createOrder(
  page: Page,
  input: Readonly<{
    customerName: string;
    cycleName: string;
    productName: string;
    totalQuantity: number;
    discountBaht: string;
    amountPaidBaht: string;
    confirmedDeliveryTime?: string;
  }>,
): Promise<void>;
```

Create two customers/orders in one Cycle with different optional times, required Product Templates, and enough Tasks to prove ordering and completion gates. The Playwright scenario must cover:

1. lock Cycle and open Operations
2. verify timed Order ordering before untimed
3. start Cycle explicitly
4. batch-confirm NEW Orders if present and batch-start both Orders
5. pack one item partially, receive a validation error for overpack, then pack all items
6. confirm both Orders packed
7. receive partial payment on one Order and full payment on the other
8. prove Planning unlock is blocked after Order Operations start
9. mark/skip every current Task with a valid skip reason where used
10. bulk-deliver both packed Orders
11. complete Cycle despite the partial-payment warning
12. receive the remaining balance after Cycle completion

- [ ] **Step 2: Apply migration 0013 to the configured development/test database**

Resolve the configured database target from the existing environment, confirm it is the non-production Day Off Dough development/test project, then run:

```bash
pnpm db:migrate
```

Expected: migration 0013 applies once; both delivery-time columns and `order_item_packing_progress` exist; the migration journal records 0013. Do not run against an unidentified or production database.

- [ ] **Step 3: Run phone E2E and verify RED**

Run: `pnpm test:e2e tests/e2e/operations.spec.ts --project=phone`

Expected: FAIL until selectors and the completed UI are wired; fix waits/selectors without reducing lifecycle assertions.

- [ ] **Step 4: Complete mobile-safe helpers and regression setup**

Use role/label selectors, current-page Server Action response waits, and uniquely prefixed data. Update prior Order/Planning/Production E2E inputs for the new optional time field and next-only status controls. Do not reuse another test's Cycle or rely on execution order.

- [ ] **Step 5: Run focused phone and desktop E2E**

Run:

```bash
pnpm test:e2e tests/e2e/operations.spec.ts --project=phone
pnpm test:e2e tests/e2e/operations.spec.ts --project=desktop
pnpm test:e2e tests/e2e/orders.spec.ts tests/e2e/planning.spec.ts tests/e2e/production.spec.ts
```

Expected: Operations passes on phone and desktop; Phase 2/3A/4A regression flows remain green.

- [ ] **Step 6: Update README and migration instructions**

Document `/cycles/[id]/operations`, confirmed delivery time, Packing semantics, guarded unlock/completion, Payment after completion, migration `0013_phase_4b_operations.sql`, Supabase apply procedure, and Phase 5 exclusions.

- [ ] **Step 7: Run complete verification**

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm test:e2e
git diff --check
git status --short
```

Expected: all commands exit 0; lint has no new errors/warnings; build includes the Operations route; full unit/integration/E2E suites pass; status contains only intended release documentation/test edits.

- [ ] **Step 8: Inspect migration/security markers**

Run:

```bash
rg -n 'confirmed_delivery_time|ENABLE ROW LEVEL SECURITY|CREATE TRIGGER|ON DELETE RESTRICT|packing progress|fulfillment transition|cycle completion' drizzle/0013_phase_4b_operations.sql
```

Expected: both time columns, Packing RLS/FK, legacy backfill before three trigger families, and stable error markers are present.

- [ ] **Step 9: Commit release slice**

```bash
git add README.md tests/fixtures/owner.ts tests/e2e/operations.spec.ts tests/e2e/orders.spec.ts tests/e2e/planning.spec.ts tests/e2e/production.spec.ts
git commit -m "test: verify phase 4b operations"
```

- [ ] **Step 10: Perform completion review**

Map every Acceptance Criterion in the Phase 4B spec to a passing domain, migration/integrity, command, component, page/action, or E2E test. Run `git log --oneline -15` and `git status --short`; confirm all Phase 4B commits exist and the worktree is clean before claiming completion.
