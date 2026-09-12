# Day Off Dough OS Phase 4A Production Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่ม Production Templates และ Production Timeline ที่สร้าง task generation แบบ atomic เมื่อ lock รอบผลิต แก้ current tasks ได้ และเก็บ generation เก่าเป็นประวัติอ่านอย่างเดียว

**Architecture:** เพิ่ม bounded module `production` ที่แยก pure domain rules, Drizzle schema, query/command services และ responsive UI ออกจาก planning เดิม Planning source จะรวม active templates ใน fingerprint และ planning lock transaction จะสร้าง planning snapshot กับ cycle task generation ใน transaction เดียวกัน ส่วน lifecycle และสิทธิ์แก้ไข derive จาก active planning snapshot กับสถานะ Bake Cycle เพื่อไม่สร้างสถานะซ้ำ

**Tech Stack:** Next.js 16.3.2 App Router, React 19.2, TypeScript 6 strict, Tailwind CSS 4, Supabase Auth/Postgres, Drizzle ORM 0.45, Zod 4.4, Decimal.js 10.6, Vitest 4.1 + Testing Library, PGlite, Playwright 1.62, pnpm 11 / Node 24

**Spec:** `docs/superpowers/specs/2026-09-12-day-off-dough-os-phase-4a-production-timeline-design.md`

## Global Constraints

- อ่าน spec ข้างต้นครบก่อนเริ่มแต่ละ task และรักษาคำตัดสินที่อนุมัติแล้วทั้งหมด
- ระบบเป็น single-owner back office; ทุก query/command รับ verified `ownerId` และทุก Server Action เรียก `requireOwner()` ภายใน action
- Browser ห้ามส่งหรือกำหนด `owner_id`; server derive จาก session เท่านั้น
- ใช้ normalized relational rows, immutable generation history, owner-scoped composite foreign keys, `ON DELETE RESTRICT`, RLS และไม่มี anonymous Data API write policy
- Product Template ที่ active และมี active activity อย่างน้อยหนึ่งรายการเป็น lock requirement ของทุก planned product; Cycle Template เป็น optional
- Task แก้ได้เฉพาะ active planning generation ขณะที่ cycle เป็น `LOCKED | IN_PRODUCTION`
- Generated task ห้ามลบ; manual task ลบแบบ soft delete ได้เฉพาะ `PENDING`
- Status คือ `PENDING | IN_PROGRESS | DONE | SKIPPED`; `SKIPPED` ต้องมีเหตุผล และสถานะอื่นต้องมี `skipReason = null`
- Schedule ใช้ calendar date ใน snapshotted `Asia/Bangkok` แล้วแปลงเป็น UTC; ห้ามบวก offset ด้วย 24 ชั่วโมงบน UTC timestamp
- ห้ามเพิ่ม timezone dependency ใน Phase 4A เพราะ shop settings ปัจจุบันรองรับ `Asia/Bangkok` เท่านั้น
- Next.js 16 route `params` และ `searchParams` เป็น Promise; Server Actions เป็น POST, ตรวจ auth ภายใน action, เรียก `revalidatePath` ก่อน `redirect`, และ dynamic route pattern ต้องระบุ `"page"` หรือ `"layout"`
- Template/Activity ใช้ active/archive semantics ไม่มี hard-delete command
- Re-lock สร้าง task generation ใหม่จาก template/plan ล่าสุด และไม่คัดลอก task edits หรือ manual tasks จาก generation เก่า
- Planning snapshots ก่อน Phase 4A ไม่ถูก backfill และแสดง legacy empty state
- ไม่ทำ dependency graph, automatic reschedule, inventory consumption, notifications, calendar sync, automatic cycle transitions หรือ Phase 4B operation hub
- ใช้ TDD ทุก task และห้ามแก้ regression ด้วยการลด assertion, skip test หรือเปลี่ยน requirement

---

## File Map

### New production module

- `src/modules/production/domain/types.ts` — template/task contracts and view unions
- `src/modules/production/domain/forms.ts` — Zod validation and normalized inputs
- `src/modules/production/domain/forms.test.ts` — form and lifecycle rules
- `src/modules/production/domain/task-generation.ts` — Bangkok scheduling, expansion, deterministic sort
- `src/modules/production/domain/task-generation.test.ts` — date, batch, lineage, no-merge cases
- `src/modules/production/db/schema.ts` — four production tables, enums, FKs, checks, RLS, indexes
- `src/modules/production/db/schema.test.ts` — Drizzle shape and RLS assertions
- `src/modules/production/db/schema.integrity.test.ts` — database trigger/check/FK behavior
- `src/modules/production/application/template-service.ts` — template queries and commands
- `src/modules/production/application/template-service.test.ts` — template lifecycle/concurrency
- `src/modules/production/application/task-generation-writer.ts` — lock-time task persistence
- `src/modules/production/application/task-generation-writer.test.ts` — generation snapshots/idempotency
- `src/modules/production/application/production-queries.ts` — current/history/legacy views
- `src/modules/production/application/production-queries.test.ts` — query modes/isolation/order
- `src/modules/production/application/production-commands.ts` — edit/manual/status/delete commands
- `src/modules/production/application/production-commands.test.ts` — lifecycle/idempotency/lineage
- `src/modules/production/ui/template-form.tsx` and `.test.tsx` — accessible activity editor
- `src/modules/production/ui/template-list.tsx` and `.test.tsx` — groups/readiness/actions
- `src/modules/production/ui/cycle-task-form.tsx` and `.test.tsx` — task mutation controls
- `src/modules/production/ui/cycle-task-list.tsx` and `.test.tsx` — day-grouped cards/history

### New routes and migration

- `src/app/(app)/production/templates/actions.ts` and `actions.test.ts`
- `src/app/(app)/production/templates/page.tsx` and `page.test.tsx`
- `src/app/(app)/production/templates/new/page.tsx`
- `src/app/(app)/production/templates/[id]/page.tsx`
- `src/app/(app)/cycles/[id]/production/actions.ts` and `actions.test.ts`
- `src/app/(app)/cycles/[id]/production/page.tsx` and `page.test.tsx`
- `drizzle/0012_phase_4a_production_timeline.sql`
- `drizzle/meta/0012_snapshot.json`
- `tests/e2e/production.spec.ts`

### Existing integration files

- `drizzle/meta/_journal.json`, `src/lib/db/schema.ts`, `src/lib/db/row-locks.ts`
- `src/modules/planning/domain/types.ts`, `build-preview.ts`, `fingerprint.ts` and focused tests
- `src/modules/planning/application/load-source.ts`, `planning-commands.ts` and focused tests
- `src/modules/planning/ui/planning-preview-form.tsx`, `planning-generation-view.tsx` and tests
- `src/app/(app)/cycles/[id]/planning/actions.ts` and test
- `src/app/(app)/cycles/[id]/cycle-detail.tsx` and `page.test.tsx`
- `src/components/app-shell.tsx` and its existing test
- `src/app/(app)/more/page.tsx` and test
- `tests/fixtures/planning.ts`, `tests/fixtures/owner.ts`
- `tests/e2e/planning.spec.ts`, `tests/e2e/shopping.spec.ts`, `README.md`

---

### Task 1: Production Domain Contracts and Task Expansion

**Files:**
- Create: `src/modules/production/domain/types.ts`
- Create: `src/modules/production/domain/forms.ts`
- Create: `src/modules/production/domain/forms.test.ts`
- Create: `src/modules/production/domain/task-generation.ts`
- Create: `src/modules/production/domain/task-generation.test.ts`

**Interfaces:**
- Produces: `ProductionTemplateScope`, `CycleTaskOrigin`, `CycleTaskStatus`, `ProductionTemplateSource`, `ProductionTemplateActivityInput`, `TaskGenerationProduct`, `CycleTaskDraft`, `CycleTaskGenerationSummary`
- Produces: `ProductionTemplateInput`, `productionTemplateInputSchema`, `updateCycleTaskInputSchema`, `createManualTaskInputSchema`, `deleteManualTaskInputSchema`
- Produces: `scheduleTaskAt(input): Date`, `buildCycleTaskDrafts(input): readonly CycleTaskDraft[]`, `sortCycleTasks(left, right): number`
- Consumes: no database or framework APIs

- [ ] **Step 1: Write failing domain tests**

```ts
it("uses Bangkok calendar days before converting to UTC", () => {
  expect(scheduleTaskAt({
    primaryDeliveryDate: "2026-09-12",
    offsetDaysFromDelivery: -1,
    defaultTime: "22:30",
    timezone: "Asia/Bangkok",
  }).toISOString()).toBe("2026-09-11T15:30:00.000Z");
});

it("creates one product task per activity and keeps decimal batch count", () => {
  const tasks = buildCycleTaskDrafts({
    primaryDeliveryDate: "2026-09-12",
    timezone: "Asia/Bangkok",
    templates: [productTemplateWithTwoActivities],
    products: [{ productId: PRODUCT_ID, productName: "ฟอคคาเซีย", selectedBatchCount: "1.666667" }],
  });
  expect(tasks).toHaveLength(2);
  expect(tasks.map((task) => task.batchCount)).toEqual(["1.666667", "1.666667"]);
});

it("requires a reason only for skipped status", () => {
  expect(updateCycleTaskInputSchema.safeParse({ ...validTaskInput, status: "SKIPPED", skipReason: " " }).success).toBe(false);
  expect(updateCycleTaskInputSchema.parse({ ...validTaskInput, status: "DONE", skipReason: "ไม่ใช้แล้ว" }).skipReason).toBeNull();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/production/domain/forms.test.ts src/modules/production/domain/task-generation.test.ts`

Expected: FAIL because the production domain exports do not exist.

- [ ] **Step 3: Add enum constants and exact data contracts**

```ts
export const productionTemplateScopes = ["CYCLE", "PRODUCT"] as const;
export const cycleTaskOrigins = ["TEMPLATE", "MANUAL"] as const;
export const cycleTaskStatuses = ["PENDING", "IN_PROGRESS", "DONE", "SKIPPED"] as const;

export type ProductionTemplateSource = Readonly<{
  id: string;
  name: string;
  scope: "CYCLE" | "PRODUCT";
  productId: string | null;
  active: true;
  activities: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    offsetDaysFromDelivery: number;
    defaultTime: string;
    estimatedDurationMinutes: number;
    sequence: number;
    notes: string | null;
  }>>;
}>;

export type TaskGenerationProduct = Readonly<{
  productId: string;
  productName: string;
  selectedBatchCount: string;
}>;

export type ProductionTemplateActivityInput = Readonly<{
  id: string | null;
  name: string;
  offsetDaysFromDelivery: number;
  defaultTime: string;
  estimatedDurationMinutes: number;
  sequence: number;
  notes: string | null;
  active: boolean;
}>;

export type ProductionTemplateInput = Readonly<{
  name: string;
  scope: "CYCLE" | "PRODUCT";
  productId: string | null;
  activities: ReadonlyArray<ProductionTemplateActivityInput>;
}>;

export type CycleTaskDraft = Readonly<{
  origin: "TEMPLATE";
  sourceTemplateId: string;
  sourceActivityId: string;
  sourceTemplateScope: "CYCLE" | "PRODUCT";
  sourceProductId: string | null;
  sourceTemplateName: string;
  sourceActivityName: string;
  sourceProductName: string | null;
  title: string;
  productId: string | null;
  productName: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: "PENDING";
  skipReason: null;
}>;

export type CycleTaskGenerationSummary = Readonly<{
  id: string;
  cycleId: string;
  planningSnapshotId: string;
  generation: number;
  primaryDeliveryDate: string;
  timezone: string;
  createdAt: Date;
}>;
```

- [ ] **Step 4: Implement `scheduleTaskAt`**

Use strict `YYYY-MM-DD`/`HH:mm` parsing, original calendar validation, `Date.UTC(year, month - 1, day + offset, hour, minute)`, then subtract exactly `7 * 60 * 60 * 1000`. Reject timezones other than `Asia/Bangkok`.

- [ ] **Step 5: Implement task expansion and stable sorting**

Expand Cycle activities once and Product activities only against the matching product plan. Copy source/current snapshots, never merge rows, and sort by `scheduledAt`, `sequence`, `productName ?? ""`, then stable source IDs.

- [ ] **Step 6: Implement the four Zod schemas**

Trim text; enforce scope/product pairing, integer offsets, positive duration/sequence, positive nullable decimals, canonical ISO instants, and skip-reason normalization. Keep the manual request UUID and task/generation/cycle UUIDs in the parsed outputs.

- [ ] **Step 7: Run domain tests and verify GREEN**

Run: `pnpm test:run src/modules/production/domain/forms.test.ts src/modules/production/domain/task-generation.test.ts`

Expected: PASS for before/same/after offsets, invalid dates/times, Cycle/Product expansion, duplicate names remaining separate, decimal batches, deterministic order, status reasons, and manual delete forms.

- [ ] **Step 8: Commit**

```bash
git add src/modules/production/domain
git commit -m "feat: add production task domain rules"
```

---

### Task 2: Production Database Schema, Migration, and Integrity Guards

**Files:**
- Create: `src/modules/production/db/schema.ts`
- Create: `src/modules/production/db/schema.test.ts`
- Create: `src/modules/production/db/schema.integrity.test.ts`
- Create: `drizzle/0012_phase_4a_production_timeline.sql`
- Create: `drizzle/meta/0012_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`

**Interfaces:**
- Consumes: Task 1 enum literals, `products`, `bakeCycles`, `cyclePlanningSnapshots`
- Produces: `productionTemplateScopeEnum`, `cycleTaskOriginEnum`, `cycleTaskStatusEnum`, `productionTemplates`, `productionTemplateActivities`, `cycleTaskGenerations`, `cycleTasks`
- Produces triggers: `enforce_cycle_task_generation_snapshot()` and `enforce_cycle_task_lifecycle()`

- [ ] **Step 1: Write failing shape and integrity tests**

```ts
it("rejects a task generation with mismatched copied delivery date", async () => {
  await expect(db.insert(cycleTaskGenerations).values({
    ownerId: OWNER_ID,
    bakeCycleId: locked.cycleId,
    planningSnapshotId: locked.planningSnapshotId,
    generation: 1,
    primaryDeliveryDate: "2026-09-13",
    timezone: "Asia/Bangkok",
  })).rejects.toThrow(/task generation snapshot mismatch/i);
});

it("rejects updates after its planning snapshot is superseded", async () => {
  await unlockCurrentGeneration();
  await expect(db.update(cycleTasks).set({ title: "แก้ย้อนหลัง" }).where(eq(cycleTasks.id, taskId))).rejects.toThrow(/task generation is read-only/i);
});
```

Add coverage for scope/product checks, one active Cycle template, one active Product template per product, cross-owner FKs, active sequence uniqueness, lineage shape, current product/name pairing, positive values, skipped-reason whitespace, manual request uniqueness, immutable lineage/generation, hard-delete rejection, RLS enabled, and absence of policies.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts`

Expected: FAIL because schema exports and migration 0012 are absent.

- [ ] **Step 3: Define enums and Template tables**

```ts
export const productionTemplateScopeEnum = pgEnum("production_template_scope", productionTemplateScopes);
export const cycleTaskOriginEnum = pgEnum("cycle_task_origin", cycleTaskOrigins);
export const cycleTaskStatusEnum = pgEnum("cycle_task_status", cycleTaskStatuses);

export const productionTemplates = pgTable("production_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  scope: productionTemplateScopeEnum("scope").notNull(),
  productId: uuid("product_id"),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("production_templates_owner_id_id_unique").on(table.ownerId, table.id),
  check("production_templates_scope_product_check", sql`(${table.scope} = 'CYCLE' AND ${table.productId} IS NULL) OR (${table.scope} = 'PRODUCT' AND ${table.productId} IS NOT NULL)`),
  uniqueIndex("production_templates_one_active_cycle_idx").on(table.ownerId).where(sql`${table.active} AND ${table.scope} = 'CYCLE'`),
  uniqueIndex("production_templates_one_active_product_idx").on(table.ownerId, table.productId).where(sql`${table.active} AND ${table.scope} = 'PRODUCT'`),
]).enableRLS();
```

- [ ] **Step 4: Define Activity, Task Generation, and Task tables**

Use `numeric(18, 6)`, timezone-aware timestamps, `date` for copied delivery date, and `time` for local activity time. Add every constraint from spec §§6.2–6.5. `cycle_task_generations` has unique `(owner_id, planning_snapshot_id)` and `(owner_id, bake_cycle_id, generation)`. `cycle_tasks` has composite FK `(owner_id, source_template_id, source_activity_id)` to `(owner_id, production_template_id, id)` and separate owner-scoped source/current Product FKs.

- [ ] **Step 5: Export schema and generate migration**

Run: `pnpm db:generate --name phase_4a_production_timeline`

Expected: creates `0012_phase_4a_production_timeline.sql`, snapshot, and journal entry 12.

- [ ] **Step 6: Add Task Generation snapshot trigger**

```sql
CREATE FUNCTION enforce_cycle_task_generation_snapshot() RETURNS trigger AS $$
DECLARE snapshot_row cycle_planning_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO snapshot_row FROM cycle_planning_snapshots
  WHERE owner_id = NEW.owner_id AND bake_cycle_id = NEW.bake_cycle_id AND id = NEW.planning_snapshot_id;
  IF NOT FOUND OR NEW.generation <> snapshot_row.generation
     OR NEW.primary_delivery_date <> snapshot_row.primary_delivery_date
     OR NEW.timezone <> snapshot_row.timezone THEN
    RAISE EXCEPTION 'task generation snapshot mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 7: Add Cycle Task lifecycle trigger**

`enforce_cycle_task_lifecycle()` joins task → generation → planning snapshot → cycle; rejects every DELETE; rejects UPDATE unless snapshot is `ACTIVE`, active pointer matches, and cycle is `LOCKED | IN_PRODUCTION`; rejects MANUAL INSERT unless those same writable conditions hold; permits TEMPLATE INSERT during lock only when snapshot is `ACTIVE`, cycle is `OPEN`, and active pointer is null; and compares every lineage/generation column with `IS DISTINCT FROM` on UPDATE.

- [ ] **Step 8: Run schema and integrity tests**

Run: `pnpm test:run src/modules/production/db/schema.test.ts src/modules/production/db/schema.integrity.test.ts`

Expected: PASS including direct-SQL bypass and cross-owner attempts.

- [ ] **Step 9: Verify schema drift**

Run: `pnpm db:generate --name phase_4a_schema_drift_check`

Expected: reports no schema changes and creates no `0013` files.

- [ ] **Step 10: Commit**

```bash
git add src/modules/production/db src/lib/db/schema.ts drizzle
git commit -m "feat: add production timeline database schema"
```

---

### Task 3: Production Template Query and Command Service

**Files:**
- Create: `src/modules/production/application/template-service.ts`
- Create: `src/modules/production/application/template-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 2 tables, `products`, `DatabaseClient`
- Produces: `TemplateStateError`, `TemplateValidationError`, `createProductionTemplateService(db, clock?)`
- Produces methods: `list(ownerId)`, `get(ownerId, templateId)`, `create(ownerId, input)`, `update(ownerId, templateId, input)`, `duplicate(ownerId, templateId)`, `setActive(ownerId, templateId, active)`

- [ ] **Step 1: Write failing service tests**

```ts
it("activates the selected product template and deactivates the previous one atomically", async () => {
  await service.setActive(OWNER_ID, first.id, true);
  await service.setActive(OWNER_ID, second.id, true);
  await expect(service.get(OWNER_ID, first.id)).resolves.toMatchObject({ active: false });
  await expect(service.get(OWNER_ID, second.id)).resolves.toMatchObject({ active: true });
});

it("archives removed activities without deleting lineage rows", async () => {
  await service.update(OWNER_ID, template.id, { ...input, activities: [{ ...firstActivity, active: false }, secondActivity] });
  const rows = await db.select().from(productionTemplateActivities).where(eq(productionTemplateActivities.productionTemplateId, template.id));
  expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: firstActivity.id, active: false })]));
});
```

Also assert owner isolation, active Product ownership/status, inactive-copy duplication, no activation without activity, no archiving the last activity of an active template, and stable activity order.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm test:run src/modules/production/application/template-service.test.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Add result types, owner validation, `list`, and `get`**

```ts
export function createProductionTemplateService(db: DatabaseClient, clock: Clock = systemClock) {
  return {
    list(ownerId: string): Promise<ProductionTemplateListView>,
    get(ownerId: string, templateId: string): Promise<ProductionTemplateDetail>,
    create(ownerId: string, input: ProductionTemplateInput): Promise<ProductionTemplateDetail>,
    update(ownerId: string, templateId: string, input: ProductionTemplateInput): Promise<ProductionTemplateDetail>,
    duplicate(ownerId: string, templateId: string): Promise<ProductionTemplateDetail>,
    setActive(ownerId: string, templateId: string, active: boolean): Promise<ProductionTemplateDetail>,
  };
}
```

Define the service-local clock as `type Clock = Readonly<{ now(): Date }>` and `const systemClock: Clock = { now: () => new Date() }`. Define `ProductionTemplateDetail` as the template fields plus all activity rows ordered by sequence, and `ProductionTemplateListView` as `{ cycleTemplates, productTemplates, productsMissingReadyTemplate }`, where each collection is readonly and owner-scoped.

```ts
export type ProductionTemplateSummary = Readonly<{
  id: string;
  name: string;
  scope: "CYCLE" | "PRODUCT";
  productId: string | null;
  productName: string | null;
  active: boolean;
  activeActivityCount: number;
}>;

export type ProductionTemplateDetail = ProductionTemplateSummary & Readonly<{
  activities: ReadonlyArray<ProductionTemplateActivityInput & Readonly<{ id: string }>>;
}>;

export type ProductionTemplateListView = Readonly<{
  cycleTemplates: ReadonlyArray<ProductionTemplateSummary>;
  productTemplates: ReadonlyArray<ProductionTemplateSummary>;
  productsMissingReadyTemplate: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;
```

- [ ] **Step 4: Implement `create` and `update`**

Validate product ownership/status and all inputs before writes. `update` accepts activity IDs only when already owned by the same template, upserts supplied activities, and marks omitted rows inactive.

- [ ] **Step 5: Implement `duplicate`**

Give every copied row a fresh ID, append `สำเนา` to the trimmed name, and create an inactive template.

- [ ] **Step 6: Implement transactional `setActive`**

Validate owner/template/product, lock same-scope templates in deterministic ID order, verify active activities, deactivate the previous active row, then activate the selected row atomically.

- [ ] **Step 7: Run service and integrity regressions**

Run: `pnpm test:run src/modules/production/application/template-service.test.ts src/modules/production/db/schema.integrity.test.ts`

Expected: PASS with deterministic activation and no cross-owner disclosure.

- [ ] **Step 8: Commit**

```bash
git add src/modules/production/application/template-service.ts src/modules/production/application/template-service.test.ts
git commit -m "feat: add production template service"
```

---

### Task 4: Production Template Routes, Actions, and Editor

**Files:**
- Create: `src/modules/production/ui/template-form.tsx`
- Create: `src/modules/production/ui/template-form.test.tsx`
- Create: `src/modules/production/ui/template-list.tsx`
- Create: `src/modules/production/ui/template-list.test.tsx`
- Create: `src/app/(app)/production/templates/actions.ts`
- Create: `src/app/(app)/production/templates/actions.test.ts`
- Create: `src/app/(app)/production/templates/page.tsx`
- Create: `src/app/(app)/production/templates/page.test.tsx`
- Create: `src/app/(app)/production/templates/new/page.tsx`
- Create: `src/app/(app)/production/templates/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 3 service, `requireOwner`, `db`, Next 16 `revalidatePath`/`redirect`
- Produces: `TemplateActionState`, `saveProductionTemplateAction`, `duplicateProductionTemplateAction`, `setProductionTemplateActiveAction`
- Produces activity payload fields: `id | null`, `name`, `offsetDaysFromDelivery`, `defaultTime`, `estimatedDurationMinutes`, `sequence`, `notes`, `active`

- [ ] **Step 1: Write failing action/component tests**

```tsx
it("keeps activity values after an invalid save", async () => {
  render(<TemplateForm products={products} initialTemplate={draft} action={invalidAction} />);
  await user.click(screen.getByRole("button", { name: "บันทึกเทมเพลต" }));
  expect(await screen.findByText("ระยะเวลาต้องมากกว่า 0 นาที")).toBeVisible();
  expect(screen.getByLabelText("ชื่อกิจกรรม 1")).toHaveValue("ผสมแป้ง");
});

it("requires confirmation when activation replaces another active template", () => {
  render(<TemplateList view={viewWithConflict} />);
  expect(screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" })).toHaveAttribute("data-confirm-switch", "true");
});
```

Action tests assert auth precedes service calls, owner ID never comes from FormData, Thai-safe errors hide SQL, and revalidation includes `/production/templates` plus `revalidatePath("/cycles/[id]/planning", "page")`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test:run src/modules/production/ui/template-form.test.tsx src/modules/production/ui/template-list.test.tsx 'src/app/(app)/production/templates/actions.test.ts' 'src/app/(app)/production/templates/page.test.tsx'`

Expected: FAIL because routes/actions/components are absent.

- [ ] **Step 3: Implement action state, parsing, and safe error mapping**

```ts
export type TemplateActionState = Readonly<{
  status: "IDLE" | "ERROR";
  message: string | null;
  fieldErrors: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
}>;

export async function saveProductionTemplateAction(
  previousState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState>;
```

Parse activity JSON with Zod, authenticate inside each action, translate known errors, log operation/owner for unexpected failures, and revalidate before redirect.

- [ ] **Step 4: Implement Template list and editor server pages**

Load data after `requireOwner()`, return not-found for inaccessible IDs, type editor `params` as `Promise<{ id: string }>`, and pass product/template data into focused client components.

- [ ] **Step 5: Implement the Template list component**

List Cycle/Product groups, status badges, activity counts, duplicate/edit/activate/deactivate controls, and active products missing ready templates.

- [ ] **Step 6: Implement the Template editor component**

Use cards, HTML drag/drop on pointer devices, visible `เลื่อนขึ้น`/`เลื่อนลง` buttons for phone/keyboard, archive/restore toggles, relative date labels, and no delete control. Use `useActionState`, keep a stable activity ID for existing rows, serialize the normalized activity array, preserve submitted values after validation failure, show field errors beside controls, and require confirmation before replacing an active template.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the focused command from Step 2.

Expected: PASS for create/edit, scope/product behavior, reorder, archive/restore, duplicate, activation confirmation, field retention, and accessible controls.

- [ ] **Step 8: Commit**

```bash
git add src/modules/production/ui/template-form.tsx src/modules/production/ui/template-form.test.tsx src/modules/production/ui/template-list.tsx src/modules/production/ui/template-list.test.tsx 'src/app/(app)/production/templates'
git commit -m "feat: add production template screens"
```

---

### Task 5: Planning Source, Fingerprint, and Template Blocker

**Files:**
- Modify: `src/modules/planning/domain/types.ts`
- Modify: `src/modules/planning/domain/build-preview.ts`
- Modify: `src/modules/planning/domain/build-preview.test.ts`
- Modify: `src/modules/planning/domain/fingerprint.ts`
- Modify: `src/modules/planning/domain/fingerprint.test.ts`
- Modify: `src/modules/planning/application/load-source.ts`
- Modify: `src/modules/planning/application/planning-queries.test.ts`
- Modify: `src/modules/planning/ui/planning-preview-form.tsx`
- Modify: `src/modules/planning/ui/planning-preview-form.test.tsx`
- Modify: `tests/fixtures/planning.ts`

**Interfaces:**
- Consumes: `ProductionTemplateSource`, Task 2 production tables
- Produces: `PlanningSourceData.productionTemplates: readonly ProductionTemplateSource[]`
- Produces: `PLANNING_ISSUE_MESSAGES.MISSING_PRODUCT_TEMPLATE` and context `{ productName, templateHref: "/production/templates" }`
- Preserves: `createPlanningFingerprint(source): string`, `buildPlanningPreview(source, overrides): PlanningPreview`

- [ ] **Step 1: Add failing planning tests**

```ts
it("blocks every planned product without a ready Product Template", () => {
  const preview = buildPlanningPreview({ ...source, productionTemplates: [] }, []);
  expect(preview.blockers).toContainEqual(expect.objectContaining({
    code: "MISSING_PRODUCT_TEMPLATE",
    scope: "PRODUCT",
    sourceEntityId: PRODUCT_ID,
    context: expect.objectContaining({ productName: "ฟอคคาเซีย", templateHref: "/production/templates" }),
  }));
});

it("changes fingerprint when active activity time changes", () => {
  const changed = { ...source, productionTemplates: [{ ...template, activities: [{ ...activity, defaultTime: "05:30" }] }] };
  expect(createPlanningFingerprint(changed)).not.toBe(createPlanningFingerprint(source));
});
```

Also test inactive activities excluded, active Product Template with zero activities blocked, Cycle Template optional, array reorder fingerprint-stable, and blocker link rendering.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test:run src/modules/planning/domain/build-preview.test.ts src/modules/planning/domain/fingerprint.test.ts src/modules/planning/application/planning-queries.test.ts src/modules/planning/ui/planning-preview-form.test.tsx`

Expected: FAIL because planning has no production input/blocker.

- [ ] **Step 3: Extend planning types and load active templates**

After ordered products are known, load zero/one active Cycle Template and active Product Templates for those IDs, then active activities ordered by template ID, sequence, activity ID. Add `productionTemplates` to every typed source test fixture.

- [ ] **Step 4: Canonicalize templates in the fingerprint**

```ts
productionTemplates: source.productionTemplates
  .map((template) => ({
    id: template.id,
    name: template.name,
    scope: template.scope,
    productId: template.productId,
    active: template.active,
    activities: template.activities
      .map((activity) => ({
        id: activity.id,
        name: activity.name,
        offsetDaysFromDelivery: activity.offsetDaysFromDelivery,
        defaultTime: activity.defaultTime,
        estimatedDurationMinutes: activity.estimatedDurationMinutes,
        sequence: activity.sequence,
        notes: activity.notes,
      }))
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
  }))
  .sort((left, right) => {
    const leftKey = `${left.scope}:${left.productId ?? ""}:${left.id}`;
    const rightKey = `${right.scope}:${right.productId ?? ""}:${right.id}`;
    return leftKey.localeCompare(rightKey);
  }),
```

- [ ] **Step 5: Add the Product Template readiness blocker**

For each final product plan, require exactly one active matching Product Template with at least one activity and emit one product-scoped issue with the stable code/message/context.

- [ ] **Step 6: Update planning fixtures without hiding blocker tests**

Update `seedPlanningScenario` to insert one deterministic active Product Template/activity for its product so Phase 3A/3B tests keep their original purpose; blocker tests explicitly deactivate it.

- [ ] **Step 7: Render blocker links in Planning Preview**

Render product name and a link to `/production/templates` above the lock control while preserving the existing disabled-lock behavior.

- [ ] **Step 8: Run the complete planning module tests**

Run: `pnpm test:run src/modules/planning`

Expected: all planning tests pass and a template mutation between preview/lock produces stale fingerprint behavior.

- [ ] **Step 9: Commit**

```bash
git add src/modules/planning tests/fixtures/planning.ts
git commit -m "feat: require production templates before planning lock"
```

---

### Task 6: Atomic Task Generation in Planning Lock

**Files:**
- Create: `src/modules/production/application/task-generation-writer.ts`
- Create: `src/modules/production/application/task-generation-writer.test.ts`
- Modify: `src/modules/planning/application/planning-commands.ts`
- Modify: `src/modules/planning/application/planning-commands.test.ts`

**Interfaces:**
- Consumes: `buildCycleTaskDrafts`, Task 2 tables, planning preview/source, `persistPlanningSnapshot`
- Produces: `persistCycleTaskGeneration(tx, ownerId, input): Promise<CycleTaskGenerationSummary>`
- Extends: `createPlanningCommandService(db, clock?, dependencies?)` with injectable writer for rollback proof

- [ ] **Step 1: Write failing transaction tests**

```ts
it("creates a task generation and snapshotted product tasks", async () => {
  const locked = await commands.lock(OWNER_ID, lockInput);
  const [generation] = await db.select().from(cycleTaskGenerations).where(eq(cycleTaskGenerations.planningSnapshotId, locked.id));
  const tasks = await db.select().from(cycleTasks).where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
  expect(generation).toMatchObject({ generation: 1, primaryDeliveryDate: "2026-09-12", timezone: "Asia/Bangkok" });
  expect(tasks).toEqual(expect.arrayContaining([expect.objectContaining({ productName: "ฟอคคาเซีย", batchCount: "2.000000" })]));
});

it("rolls back planning when task generation fails", async () => {
  const failing = createPlanningCommandService(db, clock, { persistCycleTaskGeneration: async () => { throw new Error("injected task failure"); } });
  await expect(failing.lock(OWNER_ID, lockInput)).rejects.toThrow("injected task failure");
  expect(await db.select().from(cyclePlanningSnapshots)).toHaveLength(0);
  expect(await db.select().from(cycleTaskGenerations)).toHaveLength(0);
});
```

Also assert Cycle activities, no name merging, same `lockRequestId` retry, cycle remains OPEN after rollback, and re-lock generation 2 uses latest templates without copying edits/manual rows.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test:run src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.test.ts`

Expected: FAIL because lock does not persist production rows.

- [ ] **Step 3: Implement the Task Generation writer**

```ts
export type PersistCycleTaskGenerationInput = Readonly<{
  cycleId: string;
  planningSnapshotId: string;
  generation: number;
  primaryDeliveryDate: string;
  timezone: string;
  templates: ReadonlyArray<ProductionTemplateSource>;
  productPlans: ReadonlyArray<TaskGenerationProduct>;
}>;

export async function persistCycleTaskGeneration(
  tx: Pick<DatabaseClient, "insert">,
  ownerId: string,
  input: PersistCycleTaskGenerationInput,
): Promise<CycleTaskGenerationSummary>;
```

Insert generation, expand drafts from copied planning values, bulk-insert generated tasks with immutable lineage, return generation. Empty tasks are valid only when planning has no products and no active Cycle Template.

- [ ] **Step 4: Add the writer dependency seam for rollback proof**

Default the dependency to the production writer and allow the focused test to inject a throwing implementation. Do not expose the dependency through Server Actions or browser inputs.

- [ ] **Step 5: Integrate inside repeatable-read lock**

Call writer immediately after `persistPlanningSnapshot` and before updating cycle status/active pointer. Pass `source.productionTemplates` and authoritative product plans mapped to `productId`, `productName`, `selectedBatchCount`. Keep existing early return for an existing `lockRequestId` so retry returns the original rows.

- [ ] **Step 6: Run the writer and planning transaction tests**

Run the focused command from Step 2.

Expected: PASS for atomic success, rollback, retry, unlock/re-lock, snapshots, and no duplication.

- [ ] **Step 7: Commit**

```bash
git add src/modules/production/application/task-generation-writer.ts src/modules/production/application/task-generation-writer.test.ts src/modules/planning/application/planning-commands.ts src/modules/planning/application/planning-commands.test.ts
git commit -m "feat: generate cycle tasks during planning lock"
```

---

### Task 7: Cycle Production Query Service and Legacy Modes

**Files:**
- Create: `src/modules/production/application/production-queries.ts`
- Create: `src/modules/production/application/production-queries.test.ts`
- Modify: `src/modules/production/domain/types.ts`

**Interfaces:**
- Produces: `CycleProductionView = CurrentProductionView | HistoricalProductionView | NoProductionGenerationView`
- Produces: `createProductionQueryService(db).getCycleProduction(ownerId, cycleId, generation?)`
- Produces generation summaries with planning status, `hasTimeline`, unlock metadata, and deterministic tasks

- [ ] **Step 1: Write failing query tests**

```ts
it("returns CURRENT only for the active writable generation", async () => {
  await expect(queries.getCycleProduction(OWNER_ID, cycleId)).resolves.toMatchObject({
    kind: "CURRENT",
    writable: true,
    generation: { generation: 1, planningStatus: "ACTIVE" },
  });
});

it("returns legacy empty mode when planning has no task generation", async () => {
  await seedLegacyPlanningSnapshot(db);
  await expect(queries.getCycleProduction(OWNER_ID, cycleId, 1)).resolves.toMatchObject({
    kind: "NO_GENERATION",
    reason: "LEGACY_SNAPSHOT",
    writable: false,
  });
});
```

Cover no-plan, history, terminal cycle, omitted soft-deleted manual rows, owner isolation using the same not-found outcome, and deterministic sort.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run src/modules/production/application/production-queries.test.ts`

Expected: FAIL because query service/view union do not exist.

- [ ] **Step 3: Add exact header, generation, task, product, and union types**

```ts
export type CycleProductionView =
  | Readonly<{ kind: "CURRENT"; cycle: CycleProductionHeader; generation: CycleTaskGenerationView; generations: readonly ProductionGenerationSummary[]; tasks: readonly CycleTaskView[]; products: readonly ProductOption[]; writable: true }>
  | Readonly<{ kind: "HISTORY"; cycle: CycleProductionHeader; generation: CycleTaskGenerationView; generations: readonly ProductionGenerationSummary[]; tasks: readonly CycleTaskView[]; products: readonly ProductOption[]; writable: false }>
  | Readonly<{ kind: "NO_GENERATION"; cycle: CycleProductionHeader; selectedPlanningGeneration: number | null; generations: readonly ProductionGenerationSummary[]; reason: "NO_PLAN" | "LEGACY_SNAPSHOT"; writable: false }>;

export type CycleProductionHeader = Readonly<{
  cycleId: string;
  cycleNumber: number;
  cycleName: string;
  cycleStatus: "DRAFT" | "OPEN" | "LOCKED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED";
}>;

export type ProductionGenerationSummary = Readonly<{
  planningSnapshotId: string;
  generation: number;
  planningStatus: "ACTIVE" | "SUPERSEDED";
  hasTimeline: boolean;
  lockedAt: Date;
  unlockedAt: Date | null;
  unlockReason: string | null;
}>;

export type CycleTaskGenerationView = CycleTaskGenerationSummary & Readonly<{
  planningStatus: "ACTIVE" | "SUPERSEDED";
}>;

export type ProductOption = Readonly<{ id: string; name: string }>;

export type CycleTaskView = Readonly<{
  id: string;
  taskGenerationId: string;
  origin: "TEMPLATE" | "MANUAL";
  sourceTemplateName: string | null;
  sourceActivityName: string | null;
  title: string;
  productId: string | null;
  productName: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: CycleTaskStatus;
  skipReason: string | null;
}>;
```

- [ ] **Step 4: Resolve owner-scoped cycle and selected generation**

Load cycle and all planning snapshots, reject invalid/missing generation with the same not-found error, and return `NO_GENERATION/NO_PLAN` when no planning snapshot is selected.

- [ ] **Step 5: Load Timeline rows and classify lifecycle mode**

Load the task generation and tasks for the selected planning snapshot. Return `NO_GENERATION/LEGACY_SNAPSHOT` when none exists. `CURRENT` requires active snapshot, matching active pointer, and cycle `LOCKED | IN_PRODUCTION`; every other task generation is `HISTORY`.

- [ ] **Step 6: Load Product options and apply deterministic ordering**

Load active Product options while preserving task snapshot names, filter `deletedAt IS NULL`, and order by schedule, sequence, product name, and stable ID.

- [ ] **Step 7: Run and verify GREEN**

Run: `pnpm test:run src/modules/production/application/production-queries.test.ts src/modules/production/domain/task-generation.test.ts`

Expected: PASS for modes, selection, owner isolation, deletion filtering, and ordering.

- [ ] **Step 8: Commit**

```bash
git add src/modules/production/application/production-queries.ts src/modules/production/application/production-queries.test.ts src/modules/production/domain/types.ts
git commit -m "feat: query current and historical production tasks"
```

---

### Task 8: Current Task Commands and Server Actions

**Files:**
- Create: `src/modules/production/application/production-commands.ts`
- Create: `src/modules/production/application/production-commands.test.ts`
- Create: `src/app/(app)/cycles/[id]/production/actions.ts`
- Create: `src/app/(app)/cycles/[id]/production/actions.test.ts`
- Modify: `src/lib/db/row-locks.ts`

**Interfaces:**
- Produces: `ProductionStateError`, `ProductionValidationError`
- Produces: `createProductionCommandService(db, clock?)` with `updateTask`, `createManualTask`, `softDeleteManualTask`
- Produces: `updateCycleTaskAction`, `createManualCycleTaskAction`, `deleteManualCycleTaskAction`
- Consumes Task 1 inputs; every mutation includes `cycleId` and `taskGenerationId`

- [ ] **Step 1: Write failing command/action tests**

```ts
it("updates business fields and preserves source lineage", async () => {
  const before = await loadTask(taskId);
  await commands.updateTask(OWNER_ID, { ...validUpdate, taskId, productId: otherProduct.id, status: "DONE", skipReason: null });
  const after = await loadTask(taskId);
  expect(after).toMatchObject({ productId: otherProduct.id, productName: otherProduct.name, status: "DONE", skipReason: null });
  expect(pickLineage(after)).toEqual(pickLineage(before));
});

it("returns one manual task for identical request and rejects changed payload", async () => {
  const first = await commands.createManualTask(OWNER_ID, manualInput);
  await expect(commands.createManualTask(OWNER_ID, manualInput)).resolves.toEqual(first);
  await expect(commands.createManualTask(OWNER_ID, { ...manualInput, title: "payload ใหม่" })).rejects.toThrow(ProductionStateError);
});
```

Cover all statuses, skip reason trimming/clearing, generated delete rejection, non-pending manual delete rejection, superseded/terminal rejection, wrong active pointer, owner isolation, and cycle-before-task lock order. Action tests verify auth and safe Thai errors.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run src/modules/production/application/production-commands.test.ts 'src/app/(app)/cycles/[id]/production/actions.test.ts'`

Expected: FAIL because command service/actions are absent.

- [ ] **Step 3: Add cycle-before-task row locking and current-generation guard**

```ts
export type UpdateCycleTaskInput = Readonly<{
  cycleId: string;
  taskGenerationId: string;
  taskId: string;
  title: string;
  productId: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: CycleTaskStatus;
  skipReason: string | null;
}>;

export type CreateManualTaskInput = Omit<UpdateCycleTaskInput, "taskId"> & Readonly<{ creationRequestId: string }>;
export type DeleteManualTaskInput = Readonly<{ cycleId: string; taskGenerationId: string; taskId: string }>;
```

Each transaction validates input, locks the owned cycle, verifies task generation/active planning snapshot, then locks the task. Return the same state error for inaccessible and unknown task IDs.

- [ ] **Step 4: Implement `updateTask`**

Resolve `productName` server-side from an owner-scoped active Product, normalize status/skip reason, update only visible business fields, and leave every source-lineage column untouched.

- [ ] **Step 5: Implement idempotent `createManualTask`**

Insert null source lineage and the request UUID. On retry, compare every canonical business field for `(ownerId, creationRequestId)` and return the existing row only when identical.

- [ ] **Step 6: Implement `softDeleteManualTask`**

Set `deletedAt = clock.now()` only for `MANUAL` + `PENDING`; otherwise raise `ProductionStateError` without issuing a hard delete.

- [ ] **Step 7: Implement safe actions**

Actions authenticate, parse through Task 1 schemas, preserve form values/errors, translate stale generation to `แผนงานชุดนี้ถูกแทนที่แล้ว กรุณาเปิดรุ่นปัจจุบัน`, log unexpected errors without secrets, and revalidate production/cycle/dashboard routes.

- [ ] **Step 8: Run command, action, and integrity tests**

Run: `pnpm test:run src/modules/production/application/production-commands.test.ts 'src/app/(app)/cycles/[id]/production/actions.test.ts' src/modules/production/db/schema.integrity.test.ts`

Expected: PASS at application and database layers.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/row-locks.ts src/modules/production/application/production-commands.ts src/modules/production/application/production-commands.test.ts 'src/app/(app)/cycles/[id]/production/actions.ts' 'src/app/(app)/cycles/[id]/production/actions.test.ts'
git commit -m "feat: manage current production tasks"
```

---

### Task 9: Cycle Production Timeline Page and Cards

**Files:**
- Create: `src/modules/production/ui/cycle-task-form.tsx`
- Create: `src/modules/production/ui/cycle-task-form.test.tsx`
- Create: `src/modules/production/ui/cycle-task-list.tsx`
- Create: `src/modules/production/ui/cycle-task-list.test.tsx`
- Create: `src/app/(app)/cycles/[id]/production/page.tsx`
- Create: `src/app/(app)/cycles/[id]/production/page.test.tsx`

**Interfaces:**
- Consumes: Task 7 view and Task 8 actions
- Produces: `/cycles/[id]/production` and `?generation=N` current/history/legacy rendering

- [ ] **Step 1: Write failing UI/page tests**

```tsx
it("groups by local day and keeps same activity names as separate cards", () => {
  render(<CycleTaskList view={currentViewWithTwoProofingTasks} />);
  expect(screen.getByRole("heading", { name: "11 กันยายน 2569" })).toBeVisible();
  expect(screen.getAllByRole("article", { name: /พักแป้ง/ })).toHaveLength(2);
  expect(screen.getByText("ฟอคคาเซีย · 2 แบตช์")).toBeVisible();
  expect(screen.getByText("บริยอช · 1.5 แบตช์")).toBeVisible();
});

it("renders history without mutation controls", () => {
  render(<CycleTaskList view={historyView} />);
  expect(screen.queryByRole("button", { name: "แก้ไขงาน" })).not.toBeInTheDocument();
  expect(screen.getByText("อ่านอย่างเดียว")).toBeVisible();
});
```

Test quick statuses, skip field, request ID stability after validation failure, pending-manual delete, no generated delete, generation links, invalid generation → not-found, no plan, legacy copy, and promised route props.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run src/modules/production/ui/cycle-task-form.test.tsx src/modules/production/ui/cycle-task-list.test.tsx 'src/app/(app)/cycles/[id]/production/page.test.tsx'`

Expected: FAIL because Timeline UI/page are absent.

- [ ] **Step 3: Implement generated/manual task forms**

Use `useActionState`, `datetime-local` in Bangkok local time, Product select with cycle-level option, batch/duration/sequence, notes, four statuses, and skip reason visible for `SKIPPED`. Create one `creationRequestId` per manual submission intent and rotate only after success.

- [ ] **Step 4: Implement day-grouped current/history task cards**

Group by Bangkok local date, render every task as its own accessible article, preserve query order for same-name work, show current values/source labels, keep per-task edit state separate, hide mutation controls in history, and show unlock metadata.

- [ ] **Step 5: Implement Next 16 page**

```tsx
export default async function ProductionPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ generation?: string | ReadonlyArray<string> }>;
}>) {
  const owner = await requireOwner();
  const { id } = await params;
  const generation = parsePositiveGeneration((searchParams ? await searchParams : {}).generation);
  if (generation === null) notFound();
  const view = await createProductionQueryService(db).getCycleProduction(owner.id, id, generation);
  return <ProductionScreen view={view} />;
}
```

Active generation uses clean URL; history uses `?generation=N`. Legacy copy is `รอบรุ่นนี้ยังไม่มี Production Timeline` and mentions unlock/re-lock only when cycle lifecycle allows it.

- [ ] **Step 6: Run focused UI/page tests and verify GREEN**

Run the focused command from Step 2.

Expected: PASS for current editing, manual tasks, status/skip reason, history, no plan, legacy, and phone card semantics.

- [ ] **Step 7: Commit**

```bash
git add src/modules/production/ui/cycle-task-form.tsx src/modules/production/ui/cycle-task-form.test.tsx src/modules/production/ui/cycle-task-list.tsx src/modules/production/ui/cycle-task-list.test.tsx 'src/app/(app)/cycles/[id]/production/page.tsx' 'src/app/(app)/cycles/[id]/production/page.test.tsx'
git commit -m "feat: add cycle production timeline"
```

---

### Task 10: Navigation and Cache Integration

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`
- Modify: `src/app/(app)/more/page.tsx`
- Modify: `src/app/(app)/more/page.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/cycle-detail.tsx`
- Modify: `src/app/(app)/cycles/[id]/page.test.tsx`
- Modify: `src/modules/planning/ui/planning-generation-view.tsx`
- Modify: `src/modules/planning/ui/planning-generation-view.test.tsx`
- Modify: `src/app/(app)/cycles/[id]/planning/actions.ts`
- Modify: `src/app/(app)/cycles/[id]/planning/actions.test.ts`

**Interfaces:**
- Consumes: routes from Tasks 4/9
- Produces: desktop Template link, mobile More route, cycle/current/history Timeline links, production revalidation

- [ ] **Step 1: Add failing navigation coverage**

```tsx
it("marks More active on production template routes", () => {
  render(<AppShell currentPath="/production/templates/new">content</AppShell>);
  expect(screen.getByRole("link", { name: "เพิ่มเติม" })).toHaveAttribute("aria-current", "page");
});

it("links a historical plan to its production generation", () => {
  render(<PlanningGenerationView view={historicalView} />);
  expect(screen.getByRole("link", { name: "เปิด Production Timeline รุ่น 1" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/production?generation=1`);
});
```

Also test desktop template nav, More label/description, cycle current link, and lock/unlock production revalidation.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run src/components/app-shell.test.tsx 'src/app/(app)/more/page.test.tsx' 'src/app/(app)/cycles/[id]/page.test.tsx' src/modules/planning/ui/planning-generation-view.test.tsx 'src/app/(app)/cycles/[id]/planning/actions.test.ts'`

Expected: FAIL because destinations/links/revalidation are absent.

- [ ] **Step 3: Add navigation and cross-links**

Add `/production/templates` to desktop routes, route meta, and mobile `MORE_DESTINATIONS` with label `เทมเพลตการผลิต`. Add More description `กำหนดขั้นตอนและเวลาเทียบกับวันส่ง`. Update the E2E More allowlist. Cycle detail links active plan to production; generation view uses clean active URL and queried historical URL.

```ts
const MORE_DESTINATIONS = [
  "/customers",
  "/products",
  "/production/templates",
  "/delivery",
  "/settings",
] as const;
```

- [ ] **Step 4: Add cache revalidation and verify GREEN**

Add `/cycles/${cycleId}/production` to lock/unlock revalidation lists. Keep template-wide planning invalidation as `revalidatePath("/cycles/[id]/planning", "page")`.

```ts
for (const path of [
  `/cycles/${cycleId}`,
  `/cycles/${cycleId}/planning`,
  `/cycles/${cycleId}/production`,
  "/cycles",
  "/dashboard",
]) revalidatePath(path);
```

Run the focused tests from Step 2.

Expected: PASS for desktop/mobile state, links, and revalidation.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell.tsx src/components/app-shell.test.tsx 'src/app/(app)/more' 'src/app/(app)/cycles/[id]/cycle-detail.tsx' 'src/app/(app)/cycles/[id]/page.test.tsx' src/modules/planning/ui/planning-generation-view.tsx src/modules/planning/ui/planning-generation-view.test.tsx 'src/app/(app)/cycles/[id]/planning/actions.ts' 'src/app/(app)/cycles/[id]/planning/actions.test.ts'
git commit -m "feat: connect production timeline navigation"
```

---

### Task 11: End-to-End Flow, Documentation, and Release Verification

**Files:**
- Create: `tests/e2e/production.spec.ts`
- Modify: `tests/fixtures/owner.ts`
- Modify: `tests/e2e/planning.spec.ts`
- Modify: `tests/e2e/shopping.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: all Phase 4A routes/actions and authenticated Playwright environment
- Produces: `createProductionTemplate(page, input)` helper and release evidence

- [ ] **Step 1: Add failing Playwright scenario and helper signature**

```ts
export async function createProductionTemplate(
  page: Page,
  input: Readonly<{
    name: string;
    scope: "CYCLE" | "PRODUCT";
    productName?: string;
    activities: ReadonlyArray<Readonly<{
      name: string;
      offsetDaysFromDelivery: string;
      defaultTime: string;
      estimatedDurationMinutes: string;
    }>>;
    activate: boolean;
  }>,
): Promise<void>;
```

The spec exercises create templates; missing-template planning blocker; lock and generated tasks/batches; edit all visible business fields; skip reason failure/success; manual create/delete; unlock/re-lock; generation 1 read-only; and generation 2 regenerated without old edits/manual task. The legacy snapshot remains covered by Task 7 query and Task 9 page tests because authenticated E2E setup cannot manufacture a pre-migration snapshot through the UI.

- [ ] **Step 2: Run E2E and verify RED**

Run: `pnpm test:e2e tests/e2e/production.spec.ts`

Expected: FAIL until helper/scenario aligns with the completed UI; correct selectors, waiting, or setup without weakening requirements.

- [ ] **Step 3: Complete helpers and prior-flow setup**

Use role/label selectors, wait for current-page Server Action responses, accept activation confirmation when switching, and assert active badge. Update planning/shopping E2E setup to create the required Product Template before lock.

Run: `pnpm test:e2e tests/e2e/production.spec.ts tests/e2e/planning.spec.ts tests/e2e/shopping.spec.ts`

Expected: PASS for Phase 3A, 3B, and 4A flows.

- [ ] **Step 4: Update README and run full verification**

Document routes, lock prerequisite, generation/history semantics, migration 0012, Supabase migration command, and local checks.

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:e2e
pnpm build
git status --short
```

Expected: all commands exit 0; build includes new route families; status lists only intended release-doc/test edits.

- [ ] **Step 5: Inspect migration and commit release slice**

Run: `rg -n 'ENABLE ROW LEVEL SECURITY|CREATE TRIGGER|ON DELETE RESTRICT|task generation snapshot mismatch|task generation is read-only' drizzle/0012_phase_4a_production_timeline.sql`

Expected: four tables enable RLS, both trigger families exist, history FKs restrict deletion, and stable error markers are present.

```bash
git add README.md tests/fixtures/owner.ts tests/e2e/production.spec.ts tests/e2e/planning.spec.ts tests/e2e/shopping.spec.ts
git commit -m "test: verify phase 4a production timeline"
```

- [ ] **Step 6: Perform completion review**

Map design acceptance criteria 1–10 to passing domain, integrity, application, component, or E2E tests. Run `git log --oneline -12` and `git status --short`; confirm Phase 4A commits exist and the worktree is clean before claiming completion.
