# Day Off Dough OS Phase 5A Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้เจ้าของร้านยืนยันยอดใช้จากแผนหลังผลิต แก้พร้อมประวัติ และนับของรอบใหม่ได้โดยไม่หักยอดเก่าซ้ำ

**Architecture:** เพิ่ม consumption module ที่อ้าง immutable Planning Snapshot และ append-only usage revisions; stock balance ยังคงเป็น SUM inventory ledger เดิม ใช้ per-item applied COUNT identity และ monotonic ledger revision แยกการแก้ประวัติออกจากการปรับ stock หลังนับใหม่ ทุกคำสั่งเป็น owner-scoped atomic transaction และใช้ lock order ร่วมกับ Shopping/Operations

**Tech Stack:** Existing Next.js 16.3 / React 19.2 / TypeScript 6 / Drizzle / PostgreSQL / Zod 4 / decimal.js / Vitest + PGlite / Playwright; pnpm 11.19+, ไม่เพิ่ม dependency

**Spec:** `docs/superpowers/specs/2026-10-24-day-off-dough-os-phase-5a-consumption-design.md` — user approved 2026-10-24; code baseline `5b9dd5e` plus docs-only approval/plan commit

**Execution:** คงวิธี **Subagent-Driven** ที่ผู้ใช้เลือกไว้ แผนนี้ยังรอผู้ใช้ตรวจ ไม่เริ่ม Task 1 จากการอนุมัติ design เพียงอย่างเดียว

**Dependencies:** Execute Tasks 1→14 ตามลำดับ ไม่ให้หลาย implementers เขียน shared schema/migration/command interfaces พร้อมกัน แต่ละงานผ่าน review gate ตาม Subagent-Driven ก่อนงานที่พึ่งพามันเริ่ม

## Global Constraints

- ร้านมีเจ้าของใช้คนเดียว; หลายรอบคาบเกี่ยว: ไม่มี ไม่เพิ่ม reservation หรือการจัดคิวการผลิตร่วมกัน
- ยืนยันหลังผลิตเสร็จ แยกจากการส่งครบหรือกดจบรอบ; ไม่อนุมานว่าผลิตเสร็จจาก Task status
- ต้องยืนยันเองก่อนหัก ห้ามสต็อกติดลบ; ไม่หักทั้งหมดที่ซื้อ
- ไม่อ้างว่า quantity ตามสูตรเป็น actual เพียงเพราะกดยืนยัน
- เคลียร์ยอดใช้ของรอบเก่าที่เกี่ยวข้องก่อนนับรอบใหม่
- มีเหตุผลและประวัติ; ถ้านับรอบใหม่แล้วไม่คืน/หักยอดเก่าย้อนหลังอัตโนมัติ ให้ปรับจากยอดปัจจุบัน
- Cancel หลังเริ่มผลิตต้อง OWNER_REPORTED ทุกบรรทัด ค่าเริ่มต้นว่าง; ไม่คืน stock เพราะเปลี่ยนสถานะ
- ยังไม่เพิ่มรายการที่อยู่นอกแผนในรุ่นนี้; ไม่มี final cost/กำไร/CSV/lot/FIFO/offline/multi-user
- รอบที่มีอยู่ตอน migration เป็น LEGACY; รอบที่สร้างใหม่เป็น CONSUMPTION_V1; ไม่สร้าง ledger ย้อนหลังให้รอบเก่า
- V1 ต้องยืนยัน initial stock check ก่อนเริ่มผลิต ยกเว้น exact required set ว่าง; ต้อง recorded use ก่อน complete
- Unlock ต้องเคลียร์ pending use และห้าม unlock หาก context เคยมี positive recorded use แม้แก้กลับศูนย์แล้ว
- จำนวน non-negative exact decimal สูงสุด 6 ตำแหน่ง อยู่ใน numeric(18,6) และ sum ที่รองรับ ไม่ใช้ float หรือปัดเงียบ
- Ledger append-only; balance ยังคง SUM quantity delta; ไม่ใช้ occurredAt/createdAt/UUID ordering แทน applied COUNT fence
- Cycle IDs sorted → source snapshots/contexts → Inventory Items sorted → ledger metadata/revision rows → events; item-first commands ห้ามขอ Cycle lock ภายหลัง
- Forward migration ใหม่เท่านั้น ไม่แก้ applied 0001–0013 หรือ backfill ledger ของรอบเก่า
- ใช้ isolated local PostgreSQL สำหรับ migration/concurrency/E2E และ existing Supabase Auth สำหรับ login เท่านั้น ไม่คัดลอกหรือพิมพ์ credentials
- Applying migration บนฐานร้านจริง, merge, push และ deployment ต้องมีสิทธิ์แยก ไม่รวมใน design/plan approval
- ทุกงานที่เปลี่ยน behavior มี focused RED → GREEN → regression → commit; งานตรวจหลักฐาน 13/14 ไม่ทดแทนหลักฐาน RED/GREEN ของงานก่อนหน้า และไม่สร้าง failure เทียมเมื่อเพิ่ม verification test แล้วผ่านตั้งแต่ครั้งแรก

## Review Focus

1. เปิดหน้าค้างแล้วมี PURCHASE/COUNT/การแก้จากอีกแท็บ: ต้อง STALE ไม่เปลี่ยน stock-effect mode หรือบันทึกทับเงียบ ๆ — tests Tasks 4, 5, 7, 13
2. คำขอสำเร็จแต่ response หาย แล้ว retry หลัง cancel/complete/count/แก้ revision: คืนผลเดิมทั้ง operation โดยไม่หักซ้ำ — tests Tasks 4, 5, 7, 9
3. required set ว่าง หรือ item ถูก deactivate/ไม่มีราคา: ไม่ติด complete ถาวร ไม่ดึง live master แทน snapshot และไม่เติมราคาศูนย์ — tests Tasks 1, 3, 8, 10
4. นับแค่แป้งแต่ยังมีบรรจุภัณฑ์ต้องตัด: ต้อง DIRECT รายการที่ไม่ได้นับและ rollback ทั้งชุดหากขาด ไม่ปล่อย stock effect หาย — tests Tasks 7, 11, 13
5. แก้รอบเก่า/ยกเลิกหรือใช้มือถือชื่อยาว: ไม่คืนสิทธิ์แก้ Operations เก่า ไม่สูญค่าที่กรอก ไม่ล้น viewport และ request ID ใหม่ทุกความสำเร็จ — tests Tasks 6, 10–12, 14

---

## Read first / execution preflight

- อ่าน spec ทั้งไฟล์, root `AGENTS.md`, และ Next guide ใน `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`; ก่อนแก้ route อ่าน `01-app/03-api-reference/03-file-conventions/page.md` และก่อนใช้ revalidation อ่าน `01-app/03-api-reference/04-functions/revalidatePath.md` ของเวอร์ชันที่ติดตั้ง ไม่ใช้ความจำแทน docs
- อ่าน implementation ตัวอย่าง: Shopping commands/source/forms/actions, Operations cycle commands/unlock guard และ `tests/helpers/test-db.ts`
- ก่อน implementation ใช้ using-git-worktrees: ตรวจ attached artifacts/active worktree และขอทางเลือกสร้าง worktree หรือใช้ checkout เดิมหากยังไม่มี preference ไม่สร้าง worktree ระหว่างเขียนแผน
- ตรวจ dirty files และ Node/pnpm ก่อน baseline; ถ้า pnpm ไม่อยู่ใน PATH ให้ค้น bundled runtime ผ่าน workspace-dependencies tool ไม่พิมพ์ env/secrets และไม่ติดตั้ง runtime/dependencies โดยไม่จำเป็น
- เก็บ baseline `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; รายงาน failures/warnings เดิม หาก suite ค้างให้บันทึก command/เวลา/exit และแยก targeted run ไม่เรียก targeted success ว่า full suite ผ่าน
- ข้างล่างใช้ repo-relative paths และ pnpm commands จาก root ของ checkout ที่ execute จริง

## File map and ownership

| Area | Files / responsibility |
| --- | --- |
| Pure contracts | `src/modules/consumption/domain/{types,forms,rules,request-manifest}.ts`: quantities, payloads, effect calculation, canonical equality; no DB/React |
| Durable data | `src/modules/consumption/db/schema.ts`, `src/modules/inventory/db/schema.ts`, `src/modules/cycles/db/schema.ts`, `src/lib/db/schema.ts`, `drizzle/0014_phase_5a_consumption.sql`, `drizzle/meta/0014_snapshot.json`, `_journal.json` |
| Snapshot adapter | `src/modules/shopping/application/load-shopping-source.ts`: extract reusable snapshot-only loader; `src/modules/consumption/application/load-consumption-source.ts`: consumption projection |
| Stock infrastructure | `src/modules/inventory/application/stock-ledger.ts`: read balance/fence under owned item locks; `src/modules/consumption/application/count-barrier.ts`: pending discovery and guard |
| Lifecycle | `src/modules/consumption/application/consumption-lifecycle.ts`: register pending context and start/complete/unlock predicates, reused by Operations/Planning |
| Writes | `src/modules/consumption/application/{command-support,confirm-use,correct-use,settle-use,consumption-commands}.ts`: shared locking/receipt writer, three independently testable commands, thin factory |
| Reads | `src/modules/consumption/application/consumption-queries.ts`: Cycle view/history, pending links and selective settlement preview |
| Server boundary | `src/app/(app)/cycles/[id]/consumption/actions.ts`, existing inventory/shopping actions: requireOwner, validation, safe errors, revalidate |
| UI | `src/modules/consumption/ui/{consumption-view,usage-form,usage-history,settlement-form}.tsx`, Cycle consumption route, entry links in Cycle/Operations/Stock |
| Evidence | Colocated `*.test.ts(x)`, `src/modules/consumption/db/{schema,schema.integrity,phase-5a-migration}.test.ts`, `tests/fixtures/consumption.ts`, `tests/postgres/consumption-concurrency.test.mjs`, `tests/e2e/consumption.spec.ts` |

Do not refactor unrelated modules. A new test/helper belongs to the task needing it; no standalone scaffolding task. The single **unreleased** 0014 is completed through Tasks 2–7: after each edit recreate disposable local DBs rather than reapply changed SQL to an already-migrated DB. Never deploy intermediate commits. No changes to 0000–0013. Final 0014 + journal/snapshot ship together only after all guards and upgrade proofs pass.

## Shared interfaces (defined in Task 1 unless noted)

All quantity/revision strings below are canonical decimal strings, not JS numbers. IDs are UUIDs; generation is a positive safe integer. Arrays are readonly and canonical manifests sort by IDs. Source item category/label/unit come from snapshot, never from current master. Consumables not present in existing snapshot requirements are out of scope; do not invent plan rows from inventory categories.

```ts
type ConsumptionBasis = "PLANNED" | "OWNER_REPORTED";
type StockEffectMode = "DIRECT" | "HISTORY_ONLY" | "COUNT_SETTLED";
type ConsumptionSource = Readonly<{
  cycleId: string; planningSnapshotId: string; contextId: string;
}>;
type UsageItemInput = Readonly<{
  inventoryItemId: string; usedQuantity: string;
  basis: ConsumptionBasis; reason: string | null;
}>;
type LedgerExpectation = Readonly<{
  inventoryItemId: string; ledgerRevision: string;
  countMovementId: string | null;
}>;
type UseIntent = ConsumptionSource & Readonly<{
  requestId: string; items: readonly UsageItemInput[];
  expectedLedger: readonly LedgerExpectation[];
}>;
type ConfirmUseInput = UseIntent & Readonly<{
  confirmTakenOutOfUse: true; confirmEmpty: boolean; reason: string | null;
}>;
type CorrectUseInput = UseIntent & Readonly<{
  expectedRevisionId: string; reason: string;
}>;
type SettlementContextInput = ConsumptionSource & Readonly<{
  items: readonly UsageItemInput[]; confirmTakenOutOfUse: true;
}>;
type SettleUseInput = Readonly<{
  requestId: string; contexts: readonly SettlementContextInput[];
  counts: readonly { inventoryItemId: string; remainingQuantity: string }[];
  expectedLedger: readonly LedgerExpectation[]; reason: string;
}>;
type ConsumptionWriteResult = Readonly<{
  operationId: string; revisionIds: readonly string[];
  countMovementIds: readonly string[]; replayed: boolean;
}>;
type ConsumptionClock = Readonly<{ now(): Date }>;
```

- `ConsumptionRequirement` in `types.ts`: `inventoryItemId`, `inventoryItemName`, `inventoryCategory`, `baseUnit`, `priceSnapshotId`, `plannedQuantity` (canonical string); category/unit use existing snapshot types.
- `StockLedgerState` in `stock-ledger.ts` (Task 2): `LedgerExpectation & { balance: string }`. Add `DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]` in `src/lib/db/types.ts` in Task 2; `Tx` below is a local alias to that type, available before lifecycle/writer work.
- `ConsumptionStateError(kind, message, details?)` uses kinds `NOT_FOUND | INVALID_INPUT | STALE_DATA | INVALID_CYCLE_STATE | STOCK_CHECK_REQUIRED | PENDING_USE | INSUFFICIENT_STOCK | UNLOCK_BLOCKED | REQUEST_CONFLICT`; details contain only owned blocker IDs/shortage quantities. Missing initial stock check uses STOCK_CHECK_REQUIRED; pending completion uses PENDING_USE. Unknown and cross-owner: **`NOT_FOUND`, `Consumption record not found`**. SQL lock-not-available (`55P03`) in the scoped guard protocol maps to safe STALE_DATA, not raw SQL text or automatic non-idempotent retry.
- Factory `createConsumptionCommandService(db: DatabaseClient, clock?: ConsumptionClock)` produces `confirmUse(ownerId, ConfirmUseInput)`, `correctUse(ownerId, CorrectUseInput)`, `settleUse(ownerId, SettleUseInput)`, all `Promise<ConsumptionWriteResult>`; default server clock, no client-confirmed timestamp.
- Action state (Task 9): `{ error: string|null; fieldErrors: Readonly<Record<string,string>>; saved: boolean; stale: boolean; result: ConsumptionWriteResult|null; blockers: readonly {cycleId:string;cycleName:string}[] }`; successful result.operationId identifies each completion, not a saved boolean edge.

## Durable protocol decisions

- Tables: `cycle_consumption_contexts` (unique owner/Cycle/snapshot, task generation ID, nullable protected currentRevisionId); `cycle_consumption_items` (unique owner/context/item, immutable planned quantities/source labels); `consumption_operations` (unique owner/requestId, kind `CONFIRM|CORRECT|SETTLE`, canonical manifest + preallocated result IDs, immutable); `consumption_revisions` (owner/context/operation, revisionNumber, previousRevisionId, reason, server confirmedAt); `consumption_revision_items` (absolute usage/basis/reason, mode/delta, initialCountMovementId, owned movement ID, nullable settlement COUNT ID).
- `inventory_ledger_states`: owned item PK, bigint ledgerRevision default 0, nullable latestCountMovementId; no balance column. Bootstrap all existing inventory items with revision 0 / latest count NULL as an explicit **cutover baseline**, without guessing historical COUNT order; insert new metadata for newly created items. Capture first-use fence before creating its movements/settlement COUNT. Every new COUNT, even zero delta, changes identity; every movement INSERT increments revision under item lock. Corrections preserve the initial fence forever.
- Composite owned FKs cover Cycle/snapshot/task generation/context/item/revision/operation/movement identities, including owner + item for COUNT links; ON DELETE RESTRICT. RLS enabled with no anonymous policies. Current pointer can only advance to a complete immediate successor in the same context; use unique revision numbers/one initial/one successor plus deferred completeness checks. All data except pointer/ledger metadata are append-only.
- `0014` adds immutable `bakeCycles.consumptionPolicy` / SQL `consumption_policy` with backfill LEGACY before setting new-row default CONSUMPTION_V1; server cycle forms never accept a policy. Reject post-cutover INSERT opt-out and policy UPDATE; migration seeds legacy before enabling the guard. Tests needing LEGACY must seed **before** cutover, not disable triggers or add a runtime bypass.
- Context/source creation happens before start status UPDATE in the same transaction. Deferred completeness guard rejects orphan/incomplete registration and any V1 IN_PRODUCTION/COMPLETED Cycle without the required context. Existing zero-use superseded contexts remain read-only. Keep the Phase 4B lifecycle trigger and add consumption-specific checks rather than replacing its protections.
- Normal command: lock submitted owned Cycle(s), look up owned receipt **before** terminal/source/predecessor/pending gates; exact canonical retry returns original immutable result. Then lock source/context, sorted touched items, ledger states; validate expected tokens, live SUM, exact membership/predecessor; insert immutable receipt/revisions/items/movements and advance pointer atomically. A reused key with any changed manifest field rejects; concurrent unique conflict reloads and compares without leaking foreign owners.
- Normal first use delta `-used`; correction before a new COUNT delta `previousUsed-newUsed`, after a new COUNT delta `0`/HISTORY_ONLY. Persist zero-delta audit movement too. A token mismatch, including a PURCHASE since preview, rejects STALE before calculating/saving a new mode.
- Settlement counts are a nonempty subset. Find exact pending contexts intersecting **counted** items; include full usage item sets for those contexts and lock their union of items. Recheck counted-item pending set after locks; no recursive expansion through uncounted items. Counted items use zero-delta COUNT_SETTLED + one COUNT per item; other items use DIRECT/no-negative. Result counted stock equals physical remaining, not remaining minus use. A shortage/stale error rolls back **all** contexts/counts/receipt.
- COUNT settlement authority is derived from complete owned operation/revision/item links visible in the same transaction, with deferred validation of the linked COUNT and exact set; **no session GUC, browser flag, or generic skip-barrier boolean**. Ordinary COUNT is rejected while pending contexts remain. Guard writes lock/check item before metadata; SQL already holding child tuples must try upstream locks with NOWAIT and return a stable retryable error instead of inverted blocking. Confirm that protocol with real PG, not only PGlite.

## Task 1: Pure quantity, usage and canonical request contracts

**Files:** Create `src/modules/consumption/domain/{types,forms,rules,request-manifest}.ts` and their `*.test.ts`; reuse `src/modules/shopping/domain/storage.ts` / calculations, no duplicate waste/batch algorithm.

**Interfaces:** Produces shared types above; schemas `confirmUseInputSchema`, `correctUseInputSchema`, `settleUseInputSchema`; `canonicalQuantity(value: string): string`; `canonicalizeUseRequest(kind: "CONFIRM"|"CORRECT"|"SETTLE", input: ConfirmUseInput|CorrectUseInput|SettleUseInput): string`; `calculateUseEffect(input: {previousUsed:string|null;newUsed:string;initialCountMovementId:string|null;currentCountMovementId:string|null;countSettled:boolean}): {mode:StockEffectMode;delta:string}`.

- [ ] **Step 1 — RED tests:** Named cases: normal lexical `1`/`01.000000` canonicalize equal; `0.000001` and `999999999999.999999` accepted; `1000000000000`, seven decimals, negative, NaN/Infinity/exponent/blank rejected. Duplicate IDs and counts reject before Set construction; blank/whitespace required reasons reject. `PLANNED` vs `OWNER_REPORTED`, reasons, expected tokens, counts and source changes alter manifests; permutations do not.

  ```ts
  it("canonicalizes equivalent persisted and entered quantities", () => {
    expect(canonicalQuantity("01.000000")).toBe("1");
    expect(canonicalQuantity("1")).toBe("1");
  });
  expect(effect(null, "100", null, null, false)).toEqual({mode:"DIRECT",delta:"-100"});
  expect(effect("100", "90", "count-a", "count-a", false)).toEqual({mode:"DIRECT",delta:"10"});
  expect(effect("100", "90", "count-a", "count-b", false)).toEqual({mode:"HISTORY_ONLY",delta:"0"});
  expect(effect(null, "100", null, null, true)).toEqual({mode:"COUNT_SETTLED",delta:"0"});
  ```

  Here `effect` is a test-local wrapper around calculateUseEffect, not another production API. Full-set/cancelled/basis-vs-plan rules need source data and are additionally pinned in Task 4.
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/domain`; fail on missing schemas/functions or wrong assertions, not unrelated setup.
- [ ] **Step 3 — GREEN implementation:** Define exact contracts and Decimal precision 64 arithmetic, reject nonrepresentable input before DB coercion; trim reasons once, preserve basis semantics and explicit confirmation. Use storage bounds from Shopping. Sorted canonical JSON is sufficient; no crypto/dependency needed.
- [ ] **Step 4 — Verify:** Same command PASS, plus `pnpm test:run src/modules/shopping/domain` and `pnpm typecheck`.
- [ ] **Step 5 — Commit:** Stage only this task's files; `git commit -m "feat: define consumption quantity and intent contracts"`.

## Task 2: Persistence, policy cutover and applied ledger tokens

**Files:** Create `src/modules/consumption/db/{schema.ts,schema.test.ts,schema.integrity.test.ts,phase-5a-migration.test.ts}`, `src/modules/inventory/application/{stock-ledger.ts,stock-ledger.test.ts}`, `drizzle/0014_phase_5a_consumption.sql`, `drizzle/meta/0014_snapshot.json`; modify `drizzle/meta/_journal.json`, `src/modules/{inventory,cycles}/db/schema.ts`, `src/lib/db/{schema,types}.ts`. Create `tests/helpers/migration-boundary.ts` with `applyMigrationRange(db, fromInclusive, toInclusive)` reusing readMigrationFiles/statement-breakpoints from existing Phase 4B migration test.

**Interfaces:** Produces ORM tables from Durable protocol and DatabaseTransaction alias; `readStockLedger(reader: Pick<DatabaseClient,"select">, ownerId: string, inventoryItemIds: readonly string[]): Promise<readonly StockLedgerState[]>` reads SUM balance and metadata together in one SQL statement; `loadLockedStockLedger(tx: Tx, ownerId: string, inventoryItemIds: readonly string[]): Promise<readonly StockLedgerState[]>` additionally locks metadata and assumes owned item locks already held. Re-export ledger state schema and consumption tables via central schema. Migration helper is test-only; pre-cutover seeding uses raw SQL/old-column projections, not the new ORM schema that names columns not yet created; never resets shop DBs.

- [ ] **Step 1 — RED tests:** Seed OPEN/LOCKED/IN_PRODUCTION/COMPLETED/CANCELLED Cycles plus equal-time/backdated legacy movements through migration 0013, then apply 0014. Assert all old policies LEGACY, exact old movement rows and balances unchanged, no contexts/events backfilled; new Cycle defaults V1 and cannot opt out/change policy. Fresh migration also succeeds. Metadata bootstrap `(0,NULL)` is explicit, no historical event order guessed. After new COUNT→PURCHASE→zero COUNT assert revisions `1,2,3`, latest count changes only at COUNT, even if occurredAt is older. New item gets metadata; zero-item/no-price fixtures work. UPDATE/DELETE of existing movements reject atomically, COUNT/PURCHASE inserts remain compatible.

  Assertion anchors below use test-local rows/results arranged and queried in the named case; they do not introduce production helper APIs.

  ```ts
  it("keeps every legacy movement and balance unchanged at cutover", async () => {
    expect(afterMovements).toEqual(beforeMovements);
    expect(afterBalances).toEqual(beforeBalances);
    expect(oldCyclePolicies).toEqual(Array(5).fill("LEGACY"));
    expect(newCycle.consumptionPolicy).toBe("CONSUMPTION_V1");
    expect(bootstrapState).toMatchObject({ledgerRevision:"0",latestCountMovementId:null});
  });
  ```
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/db src/modules/inventory/application/stock-ledger.test.ts`.
- [ ] **Step 3 — GREEN implementation:** Add all tables/owned keys/types and policy backfill/default in a transaction with guards enabled only after backfill. Implement metadata initialization, applied movement trigger and append-only trigger; preserve old movement data. SQL errors roll back metadata with movement. Add immutable row checks, successor/FK skeletons; Tasks 3–7 complete operation/lifecycle validation in this same unreleased migration.
- [ ] **Step 4 — Verify:** Same tests PASS; inspect catalog RLS/no policies/FKs/indexes, not just SQL substrings. `pnpm typecheck`; recreate DB after subsequent 0014 edits. Do not claim all lifecycle/operation integrity done yet.
- [ ] **Step 5 — Commit:** Only listed schema/migration/helper files; `git commit -m "feat: persist consumption lineage and inventory count fences"`.

## Task 3: Snapshot source, pending registration and authoritative COUNT barrier

**Files:** Create `src/modules/consumption/application/{load-consumption-source,consumption-lifecycle,count-barrier}.ts` and corresponding tests; `tests/fixtures/consumption.ts`; modify `src/modules/shopping/application/load-shopping-source.ts` + test, `src/modules/operations/application/cycle-commands.ts` + test, `src/modules/inventory/application/inventory.ts` + test, `src/modules/shopping/application/shopping-commands.ts` + test, `drizzle/0014_phase_5a_consumption.sql` and `src/modules/consumption/db/schema.integrity.test.ts`.

**Interfaces:** Extract `loadSnapshotStockRequirements(reader: Pick<DatabaseClient,"select">, ownerId: string, planningSnapshotId: string): Promise<readonly StockRequirement[]>` from loadShoppingSource; existing public loadShoppingSource unchanged. Produce `loadConsumptionSource(reader, ownerId, planningSnapshotId): Promise<readonly ConsumptionRequirement[]>`; `registerPendingConsumption(tx, ownerId, {cycleId,planningSnapshotId,taskGenerationId}): Promise<{contextId:string}>`; `findPendingConsumption(reader, ownerId, itemIds): Promise<readonly {cycleId:string;cycleName:string;contextId:string;planningSnapshotId:string}[]>`; `assertNoPendingConsumption(tx,ownerId,itemIds): Promise<void>` throws PENDING_USE. Fixture `seedConsumptionScenario(db, {ownerId?,idSet?:"PRIMARY"|"SECONDARY",start?:boolean}?)` returns `{cycleId,planningSnapshotId,taskGenerationId,itemIds}` through legitimate V1 setup.

- [ ] **Step 1 — RED tests:** Snapshot totals reuse already-buffered planned values once; new live recipe/name/price/Task batch cannot alter copied source. Missing unit cost stays null; deactivated owned item remains usable; missing/mismatched owned reference rejects. V1 start without exact current-generation stock check rejects, with check registers full context and starts atomically, repeated start creates one context; no required items creates empty context without count. Generic recordCount and confirmCycleStock reject pending items (including CANCELLED pending context), allow other items/LEGACY, and reject whole batch. Direct SQL COUNT cannot bypass; direct V1 production status INSERT/UPDATE without complete pending registration cannot commit.

  ```ts
  it("blocks counting a pending-use item without writing a COUNT", async () => {
    await expect(inventory.recordCount(OWNER_ID, flourId, "25", new Date()))
      .rejects.toMatchObject({kind:"PENDING_USE"});
    expect(afterMovementIds).toEqual(beforeMovementIds);
    expect(contextRows).toHaveLength(1);
    expect(contextRows[0].currentRevisionId).toBeNull();
  });
  ```
- [ ] **Step 2 — Prove RED:** Run the three new application tests plus inventory/shopping/operations command tests using `pnpm test:run <listed test paths>`.
- [ ] **Step 3 — GREEN implementation:** Reuse extracted source aggregation; start locks Cycle/current snapshot/generation then sorted source items before atomic registration/status update. No stock deducted yet. Add consumption-specific lifecycle/deferred exact-context validation and structural COUNT barrier in 0014; keep 0013 Operations protections. Wire shared barrier **after item locks** in both existing COUNT services; no item→Cycle lock. Source context excludes live purchase-pack profile and does not require a price value.
- [ ] **Step 4 — Verify:** Repeat targeted tests + `pnpm test:run src/modules/shopping/application/load-shopping-source.test.ts src/modules/consumption/db`; `pnpm typecheck`. Adapt only affected test setup to count/start legitimately; no policy bypass. Rollback test proves failed start leaves no context/status partial state.
- [ ] **Step 5 — Commit:** Stage listed changes; `git commit -m "feat: register pending usage and guard physical counts"`.

## Task 4: Atomic initial use and full-operation retry receipts

**Files:** Create `src/modules/consumption/application/{command-support,confirm-use,consumption-commands}.ts`, `confirm-use.test.ts`; modify `drizzle/0014_phase_5a_consumption.sql`, `src/modules/consumption/db/schema.integrity.test.ts`, `tests/fixtures/consumption.ts`.

**Interfaces:** `confirmUse(db:DatabaseClient,clock:ConsumptionClock,ownerId:string,input:ConfirmUseInput): Promise<ConsumptionWriteResult>`; factory initially exposes confirmUse. Use existing `lockOwnedBakeCycles` first, then `findExistingOperation(tx:Tx,ownerId:string,requestId:string,canonicalManifest:string): Promise<ConsumptionWriteResult|null>`, then `lockConsumptionContexts(tx:Tx,ownerId:string,sources:readonly ConsumptionSource[]): Promise<void>` (assumes Cycles already locked; locks snapshots/contexts, never validates current source before receipt lookup). Other shared helpers: `assertExpectedLedger(actual:readonly StockLedgerState[],expected:readonly LedgerExpectation[]): void`, `writeConsumptionOperation(tx:Tx,ownerId:string,prepared:PreparedConsumptionOperation,confirmedAt:Date): Promise<ConsumptionWriteResult>`. Define PreparedConsumptionOperation here using typed `$inferInsert` rows: `{operation, revisions, revisionItems, usageMovements, countMovements, pointerUpdates: readonly {contextId:string;expectedRevisionId:string|null;newRevisionId:string}[]}`; operation includes canonicalManifest, preallocated resultRevisionIds/resultCountMovementIds. Tasks 5/7 consume the typed writer, not copy it.

- [ ] **Step 1 — RED tests:** Start with balances flour `150`, boxes `12`, confirm use `100`/`10`: balances `50`/`2`, two linked CONSUMPTIONs, one current revision. One insufficient item rejects all rows/pointers/receipt. Same request with `1` vs DB `1.000000` returns same IDs; reordered exact payload replays; changed reason/basis/source/tokens/quantity rejects REQUEST_CONFLICT. Retry after COUNT, later revision or terminal state returns original result before lifecycle gates. Full source set required: missing/duplicate/extra/foreign item rejects; planned changed qty needs OWNER_REPORTED+reason; zero needs reason; empty set needs confirmEmpty and reason. CANCELLED requires actual basis every line, may zero, never default plan. STALE purchase token rejects. Unknown/cross-owner exact same NOT_FOUND kind/message, including request IDs; forced failure leaves zero writes.

  ```ts
  it("deducts confirmed use once and returns its original receipt on retry", async () => {
    const first = await service.confirmUse(OWNER_ID, intent);
    const retry = await service.confirmUse(OWNER_ID, intent);
    expect(retry).toEqual({...first,replayed:true});
    expect(balances).toEqual({flour:"50",boxes:"2"});
    expect(consumptionMovementIds).toHaveLength(2);
  });
  ```
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/application/confirm-use.test.ts src/modules/consumption/db/schema.integrity.test.ts`.
- [ ] **Step 3 — GREEN implementation:** Lock Cycle and check owned receipt before source/lifecycle/token checks; validate context PENDING_USE, owner, exact set and provenance. Capture initial count identity under item locks, calculate effects, preallocate UUIDs, use single writer for receipt/revisions/audit movements/pointer. Insert zero audit rows. Add deferred SQL complete-operation/lineage/delta/no-negative validation; reject partial exact sets, forged links, noncanonical source and pointer rewinds. No automatic Cycle/task/delivery mutation.
- [ ] **Step 4 — Verify:** Same tests PASS + domain, source/lifecycle/COUNT tests and typecheck; verify raw SQL incomplete operation cannot commit. Concurrent request behavior receives real-PG proof in Task 13.
- [ ] **Step 5 — Commit:** `git commit -m "feat: confirm planned or reported production usage atomically"` for only task files.

## Task 5: Corrections before and after a physical COUNT

**Files:** Create `src/modules/consumption/application/correct-use.ts`, `correct-use.test.ts`; modify `command-support.ts`, `consumption-commands.ts`, `drizzle/0014_phase_5a_consumption.sql`, `src/modules/consumption/db/schema.integrity.test.ts`.

**Interfaces:** `correctUse(db,clock,ownerId,input:CorrectUseInput): Promise<ConsumptionWriteResult>`; add method to factory. Consumes protected current predecessor, initial fence and typed writer; no new inventory balance authority.

- [ ] **Step 1 — RED tests:** Use100→90 before new COUNT yields CORRECTION +10; increase to110 yields -20 from90, rejecting shortage atomically. COUNT physical25 then old100→90 yields delta0/HISTORY_ONLY and balance remains25; subsequent corrections never reset fence or adjust25. Same-time/backdated/zero COUNT still freezes prior stock effects. Mixed flour counted/boxes not counted yields per-item HISTORY_ONLY/DIRECT; a COUNT or PURCHASE after preview rejects STALE, does not silently switch mode. Expected predecessor conflict rejects; exact retry after further correction/terminal returns original immutable result. Reason required; old revision rows immutable; full-set and basis rules remain; superseded zero-use context cannot be corrected; cancelled/completed current context can.

  ```ts
  it("keeps counted stock at 25 when old use changes from 100 to 90", async () => {
    expect(correctedItem).toMatchObject({usedQuantity:"90",mode:"HISTORY_ONLY",delta:"0"});
    expect(currentFlourBalance).toBe("25");
    expect(originalRevision).toEqual(originalRevisionBeforeCorrection);
  });
  ```
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/application/correct-use.test.ts`.
- [ ] **Step 3 — GREEN implementation:** Validate all expected ledger/predecessor tokens before effect calculation, derive mode from durable first-use fence only. Use CORRECTION movement including zero audit for HISTORY_ONLY, preserve all initial fence provenance; SQL validates absolute targets, immediate successor, mode/delta, history immutability and atomic current pointer. Add factory method without accepting client mode/delta.
- [ ] **Step 4 — Verify:** confirm/correct tests + integrity/domain + typecheck PASS; assert no Cycle or Ops history changes.
- [ ] **Step 5 — Commit:** `git commit -m "feat: revise usage without recutting counted stock"` for only task files.

## Task 6: Completion/unlock gates and terminal compatibility

**Files:** Modify `src/modules/consumption/application/consumption-lifecycle.ts` + test, `src/modules/operations/application/{cycle-commands,unlock-guard}.ts` + tests, `src/modules/planning/application/planning-commands.ts` + test, `src/modules/operations/domain/types.ts`, `src/modules/operations/application/operations-queries.ts` + test, `drizzle/0014_phase_5a_consumption.sql`, `src/modules/consumption/db/schema.integrity.test.ts`. No changes to generic cancellation lifecycle beyond tests unless needed to preserve pending context.

**Interfaces:** Produce `assertConsumptionCompleteAllowed(tx,ownerId,cycleId,planningSnapshotId): Promise<void>` and `assertConsumptionUnlockAllowed(tx,ownerId,cycleId,planningSnapshotId): Promise<void>`. Extend Operations READY view with `consumption: {required:boolean;recorded:boolean;startBlockedByStockCheck:boolean}`; keep existing task/order completion counters and unpaid totals unchanged.

- [ ] **Step 1 — RED tests:** V1 finished tasks/delivery + pending use still blocks complete; recorded use allows complete while unpaid remains warning-only. No delivery needed to confirm use. Pending unlock rejects; explicit all-zero-with-reason allows unlock only if original Ops guards allow. Ever-positive100→correct0 still rejects unlock. Re-lock creates new context, old zero context read-only, no copying use/ledger. Cancel before production no context; cancel after production preserves pending/recorded history and no stock return. Corrections after terminal do not reopen operations. Seed real pre-cutover LEGACY fixture through migration boundary and prove prior start/complete/unlock behavior unchanged; SQL writes cannot bypass V1 gates.

  ```ts
  it("does not unlock a context that was ever recorded with positive use", async () => {
    await expect(assertConsumptionUnlockAllowed(tx,OWNER_ID,cycleId,snapshotId))
      .rejects.toMatchObject({kind:"UNLOCK_BLOCKED"});
    expect(currentRecordedQuantity).toBe("0");
    expect(previousPositiveQuantity).toBe("100");
  });
  ```
- [ ] **Step 2 — Prove RED:** Run consumption-lifecycle, operations cycle/unlock/query and planning-command tests, then schema.integrity.
- [ ] **Step 3 — GREEN implementation:** Read required context under shared Cycle/source locks; lifecycle predicates query historical positive use, not only current zero target. Add guards alongside existing Operations predicates and SQL trigger; no weaken task/order gates. Ensure a failed unlock leaves snapshot/context current pointers intact. Return read metadata needed for honest UI guidance.
- [ ] **Step 4 — Verify:** Same focused suites + cycles application/domain + typecheck PASS. Existing refund/restore and late-payment paths remain untouched.
- [ ] **Step 5 — Commit:** `git commit -m "feat: require settled usage for v1 cycle completion and unlock"` for only task files.

## Task 7: Selective count-backed settlement with mixed DIRECT effects

**Files:** Create `src/modules/consumption/application/settle-use.ts`, `settle-use.test.ts`; modify `command-support.ts`, `count-barrier.ts`, `consumption-commands.ts`, `drizzle/0014_phase_5a_consumption.sql`, `src/modules/consumption/db/schema.integrity.test.ts`.

**Interfaces:** `settleUse(db,clock,ownerId,input:SettleUseInput): Promise<ConsumptionWriteResult>`; add factory method. Uses findPendingConsumption, full-operation receipt and writer. Counts list defines counted subset; server derives per-item modes and exact context closure. One COUNT per distinct selected item, one usage revision per affected context, one receipt for entire command.

- [ ] **Step 1 — RED tests:** Ledger flour50/boxes12, pending use flour100/boxes10, count flourRemaining25: final flour25, boxes2; flour use100 delta0 + COUNT delta-25, boxes DIRECT -10. No purchase/price or old cycle count snapshot changes. Counted flour correction later HISTORY_ONLY; uncounted boxes correction still DIRECT until its own COUNT. Two pending contexts sharing counted flour require both full usage sets; missing/extra/stale context rejects; context sharing only uncounted boxes is not recursively settled. Selected count IDs must nonempty/unique, all linked pending items and physical remaining present. If boxes balance9 then whole operation rolls back including flour COUNT/receipt. Changed subset/payload with same request rejects; exact retry after later COUNT/correction returns all original IDs, not just one context. Cancelled contexts actual-only; foreign context/count item safe NOT_FOUND. Ordinary COUNT with fake settlement flag or malformed links still rejects.

  ```ts
  it("counts only flour and directly deducts uncounted boxes in one operation", async () => {
    expect(finalBalances).toEqual({flour:"25",boxes:"2"});
    expect(flourUsage).toMatchObject({usedQuantity:"100",mode:"COUNT_SETTLED",delta:"0"});
    expect(boxUsage).toMatchObject({usedQuantity:"10",mode:"DIRECT",delta:"-10"});
    expect(countedItemIds).toEqual([flourId]);
    expect(priceRowsAfter).toEqual(priceRowsBefore);
  });
  ```
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/application/settle-use.test.ts src/modules/consumption/db/schema.integrity.test.ts`.
- [ ] **Step 3 — GREEN implementation:** Discover candidate cycles before locks; lock submitted Cycle IDs sorted and check receipt before stale discovery; validate exact pending set for counted IDs after sorted union item locks. Validate all expected tokens/full sets; preflight summed DIRECT effects for shared items. Insert complete revisions/zero consumption first, then physical COUNT, with final deferred link/coverage validation. No GUC bypass or uncounted zero effects. Do not overwrite initial cycleInventoryCounts or expand Shopping purchase permissions. Finalize all 0014 guards; no placeholder SQL checks remain.
- [ ] **Step 4 — Verify:** All consumption domain/db/application tests + inventory/shopping count/purchase regressions + typecheck PASS. Real-PG stale-set/lock proof comes in Task 13.
- [ ] **Step 5 — Commit:** `git commit -m "feat: settle pending usage with selective physical counts"` for only task files.

## Task 8: Cycle usage/history and settlement preview read models

**Files:** Create `src/modules/consumption/application/consumption-queries.ts`, `consumption-queries.test.ts`; extend `domain/types.ts`; modify `src/modules/inventory/application/inventory.ts` only if a read projection is needed, without changing balance logic.

**Interfaces:** `createConsumptionQueryService(db)` exposes `getCycleConsumption(ownerId:string,cycleId:string,generation?:number): Promise<CycleConsumptionView>` and `getSettlementPreview(ownerId:string,countedItemIds:readonly string[]): Promise<SettlementPreview>`; findPendingConsumption supplies inventory blocker links. CycleConsumptionView has discriminant `LEGACY|NO_PLAN|NOT_STARTED|PENDING_USE|RECORDED|HISTORY`, copied Cycle/generation/source, nullable context/current revision, immutable revision history, requirements, actual stock/fence tokens, `canConfirm`, `canCorrect`. SettlementPreview contains counted IDs, exact contexts with full items, union ledger expectations and per-item mode/delta; unset actual values stay null until entered, never treated as zero. RECORDED includes terminal current contexts eligible for correction; superseded HISTORY never writable.

- [ ] **Step 1 — RED tests:** Cover all six states and bad/nonowned generation exact safe error. Current V1 pending includes cancelled actual-only defaults (null values), normal defaults planned; LEGACY never appears actionable. History shows immutable label/unit/basis/reason and original delta, not recomputed from latest balance. No-price remains absent, deactivated owned source remains shown, zero context visible. Settlement preview includes full contexts but only selected COUNT items, returns expected token for every touched item. No cross-owner blockers. Multiple revisions/contexts must not N+1 full ledger reads; bounded batch queries for source/items/history are asserted with fixture logger.

  ```ts
  it("keeps a superseded generation read-only with its original recorded values", async () => {
    expect(view).toMatchObject({kind:"HISTORY",canConfirm:false,canCorrect:false});
    expect(historyUseQuantities).toEqual(["0"]);
    expect(immutableItemName).toBe("แป้งขนมปัง");
  });
  ```

  The superseded fixture is zero-use only because ever-positive use forbids unlock; positive100→90 history is tested in a current terminal context, not an impossible superseded fixture.
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/application/consumption-queries.test.ts`.
- [ ] **Step 3 — GREEN implementation:** Owner-filter all joins, reuse snapshot projection and readStockLedger inside one read-only REPEATABLE READ transaction so context/source/history/balance/tokens describe one snapshot; do not call the lock-requiring helper in a read-only query. Return serializable strings/Date conventions like Shopping. A preview is advisory; commands recheck everything. Generation parameter follows Shopping's positive-safe-integer semantics. Do not expose a single writable form across unrelated Cycles except explicit settlement mode.
- [ ] **Step 4 — Verify:** Query tests + source/domain tests + typecheck PASS; immutable history tests pin both old and current revisions, not global screen matches.
- [ ] **Step 5 — Commit:** `git commit -m "feat: query cycle usage history and settlement previews"` for only task files.

## Task 9: Owner-authenticated actions, safe errors and count blocker responses

**Files:** Create `src/app/(app)/cycles/[id]/consumption/{actions.ts,actions.test.ts}`; modify `src/app/(app)/inventory/actions.ts`, create its `actions.test.ts`; modify `src/app/(app)/cycles/[id]/shopping/actions.ts` + test and Operations actions + test for new guard kinds. Define action state in `src/modules/consumption/domain/types.ts` and import as type (avoid sync exports from use-server files).

**Interfaces:** `confirmUseAction(previous:ConsumptionActionState,formData:FormData)`, `correctUseAction(...)`, `settleUseAction(...)`: Promise<ConsumptionActionState>; JSON field `payload` contains matching schema input. InventoryActionState/StockActionState gain optional owned `blockers` links while preserving existing call sites. No new unauthenticated preview POST endpoint; preview is a server-rendered read in Task 11.

- [ ] **Step 1 — RED tests:** requireOwner precedes service call on every action, owner not accepted from payload. Malformed JSON/File/unknown fields/duplicate item schema failures preserve safe field errors and do not call service. Unknown/cross-owner exact same safe response; domain PENDING_USE returns only owned Cycle links; STALE indicates refresh, shortage lists owned items, unexpected error hides SQL/credentials. Replay success returns original result.operationId. Multi-context settlement revalidates every affected Cycle consumption/detail/planning/shopping/operations, every touched `/inventory/:id`, `/inventory`, `/cycles`, `/dashboard` only on success; no revalidation on rollback. Terminal Consumption allowed without enabling old Ops actions. New initial-stock-check/completion guard shows actionable link, no raw English SQL.

  ```ts
  it("does not mutate or revalidate when owner authentication fails", async () => {
    await expect(confirmUseAction(previousState,formData)).rejects.toBe(authFailure);
    expect(confirmUseMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
  ```
- [ ] **Step 2 — Prove RED:** Run the listed consumption/inventory/shopping/Operations action tests with `pnpm test:run`.
- [ ] **Step 3 — GREEN implementation:** Follow installed Next mutation guide, schemas and existing action error mapping. Revalidation targets come from owned committed result/source lookup, not untrusted client list. Log only operation identifier + safe error category, no payload/secrets. Keep unexpected exceptions distinct from normal business validation.
- [ ] **Step 4 — Verify:** Action tests + typecheck/lint on touched files PASS; mock requireOwner rejection proves no service mutation.
- [ ] **Step 5 — Commit:** `git commit -m "feat: expose safe owner-only consumption actions"` for only task files.

## Task 10: Usage confirmation, correction and immutable history UI

**Files:** Create `src/modules/consumption/ui/{consumption-view,usage-form,usage-history}.tsx` and tests; create `src/app/(app)/cycles/[id]/consumption/{page.tsx,page.test.tsx}`; add representative view fixtures to `tests/fixtures/consumption.ts` or new `tests/fixtures/consumption-views.ts` (do not import DB helpers in browser tests).

**Interfaces:** `UsageForm({view,mode:"CONFIRM"|"CORRECT",action})`; action signature from Task 9; `ConsumptionView({view})`; `UsageHistory({revisions})`. Route awaits params/searchParams; generation parse same as Shopping; authenticate before read. Form generates request UUID once per intent, retains it on failure/retry and rotates on **each distinct successful operation result**, not `[saved]` alone.

- [ ] **Step 1 — RED tests:** Normal form prefilled PLANNED; owner-edited amount changes basis to OWNER_REPORTED with required reason; explicitly reported actual can equal plan. CANCELLED inputs blank and cannot submit until every line resolved including zero reasons; empty context needs deliberate no-items confirmation. Correction shows previous/new/delta and HISTORY_ONLY notice with current-stock link. All three success sequences rotate IDs separately; failure keeps request+entered quantities/reasons and disables resubmit while pending. Actually dispatch action returning invalid/stale errors and assert rendered values survive; no never-submitted regression tests. HISTORICAL/LEGACY no mutation controls; terminal current revision can correct but no Ops controls. Route owner/404/generation tests render within isolated containers.

  ```ts
  it("rotates the intent ID after each of three successes, not just saved false-to-true", async () => {
    expect(submittedRequestIds).toHaveLength(3);
    expect(new Set(submittedRequestIds).size).toBe(3);
    expect(submittedRequestIds.every(id => id.length === 36)).toBe(true);
  });
  ```
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/ui 'src/app/(app)/cycles/[id]/consumption/page.test.tsx'`.
- [ ] **Step 3 — GREEN implementation:** Accessible labeled card rows on phone, optional desktop table; `min-w-0`, width-constrained native inputs/selects and wrapping long immutable names. Clear Thai labels “ตามแผน (ประมาณการ)”, “เจ้าของบันทึกใช้จริง”, “แก้ประวัติเท่านั้น ไม่ปรับสต๊อกปัจจุบัน”; no optimistic stock success. UseActionState with result-aware reset; do not reset new intent from an old replay result on remount.
- [ ] **Step 4 — Verify:** Component/route tests + action tests + typecheck PASS; ensure pending, error and correction views tested, not only initial render. Phone geometry proof in Task 14.
- [ ] **Step 5 — Commit:** `git commit -m "feat: add production usage confirmation and history screens"` for only task files.

## Task 11: Selective settlement UI and complete-context preview

**Files:** Create `src/modules/consumption/ui/settlement-form.tsx`, `settlement-form.test.tsx`; modify consumption page + page test and consumption-view + test; extend view-only fixtures. No new component dependency.

**Interfaces:** Consumption route additionally accepts `countItem` as one UUID string or repeated UUID array, validates duplicates/nonempty/owned IDs and calls getSettlementPreview; `SettlementForm({preview:SettlementPreview,action})`. GET selection/refresh may change counted subset; POST sends full SettleUseInput with retained request ID, absolute usage and captured tokens. `mode=settle` explicitly separates this flow from ordinary current COUNT.

- [ ] **Step 1 — RED tests:** Select flour only, full-context flour+boxes use values displayed, flour COUNT_SETTLED and boxes DIRECT preview explicit; actual remaining field only selected flour. No hidden zero stock effect for boxes. Missing flour remaining, empty/duplicate selection, absent context line and blank reason cannot submit. Cancelling retains actual-only line requirement. Changing counted selection invalidates preview/tokens and represents a new request intent; failed POST retains old ID/values until explicit refresh/new intent. Stale added context prompts refresh, not silently adding it. Short boxes shows entire-settlement failure, flour not reported saved. Three repeated successful intents rotate ID; success reports both counts and usage results without “หักสต๊อก” for zero-delta lines.

  ```ts
  it("sends the full use context but a physical count only for selected flour", async () => {
    expect(submittedPayload.contexts[0].items.map(item => item.inventoryItemId).sort())
      .toEqual([flourId,boxId].sort());
    expect(submittedPayload.counts).toEqual([{inventoryItemId:flourId,remainingQuantity:"25"}]);
    expect(submittedPayload.reason).toBe("นับของเหลือหลังอบ");
  });
  ```
- [ ] **Step 2 — Prove RED:** `pnpm test:run src/modules/consumption/ui/settlement-form.test.tsx 'src/app/(app)/cycles/[id]/consumption/page.test.tsx'`.
- [ ] **Step 3 — GREEN implementation:** Preview chosen physical remaining vs before-count ledger and all DIRECT effects; explicit checkbox that remaining is **after** listed uses. Generate payload only from complete preview while command remains authoritative. Show link back to ordinary count for future current corrections. Scope related Cycles visibly; normal use form remains one Cycle.
- [ ] **Step 4 — Verify:** Listed tests + all consumption action/component tests + typecheck PASS. No raw COUNT action is reused as a bypass.
- [ ] **Step 5 — Commit:** `git commit -m "feat: add selective remaining-stock settlement flow"` for only task files.

## Task 12: Existing entry points, Operations guidance and regression fixtures

**Files:** Modify `src/app/(app)/cycles/[id]/{cycle-detail.tsx,page.test.tsx}`, `src/app/(app)/cycles/[id]/operations/{page.tsx,page.test.tsx}`, `src/modules/operations/ui/{operations-header,cycle-completion-form}.tsx` + tests, `src/app/(app)/inventory/[id]/page.tsx` + new `page.test.tsx`, `src/modules/inventory/ui/price-form.tsx` + new `price-form.test.tsx`, `src/modules/shopping/ui/stock-count-form.tsx` + test; update `tests/fixtures/{planning,operations}.ts`, affected existing service/schema tests and `tests/postgres/operations-lifecycle-concurrency.test.mjs` setup only as necessary.

**Interfaces:** Cycle/Operations show Consumption link and V1 stock-check/usage gates from Task 6/8; Inventory detail queries findPendingConsumption for item and passes owned blocker links to PhysicalCountForm; action blockers from Task 9 remain fallback for stale pages. Existing forms preserve original nonblocked behavior.

- [ ] **Step 1 — RED tests:** LOCKED without stock check links Shopping; IN_PRODUCTION pending links Consumption independently of delivery; completed unpaid still payment-enabled; CANCELLED Ops stays read-only but links actual-use workflow. Generic COUNT/Shopping errors show relevant Cycle links/settlement option without raw IDs or leaked owners. Disabled button is guidance only; action/DB guard proof remains. Render LOCKED and IN_PRODUCTION in separate/scoped containers to prevent false-positive assertions. Old/new cutover fixtures produce distinct expected behavior, no blanket skip/filter of failing regressions.

  ```ts
  it("offers cancelled-cycle usage without reopening Operations mutations", async () => {
    expect(within(container).getByRole("link",{name:"บันทึกยอดใช้"}))
      .toHaveAttribute("href",`/cycles/${cycleId}/consumption`);
    expect(within(container).queryByRole("button",{name:"เริ่มรอบผลิต"})).not.toBeInTheDocument();
    expect(within(container).queryByRole("button",{name:"จบรอบผลิต"})).not.toBeInTheDocument();
  });
  ```
- [ ] **Step 2 — Prove RED:** Run listed route/component tests plus affected fixture-dependent service tests.
- [ ] **Step 3 — GREEN implementation:** Add navigation/gate copy without changing payment/refund/task rules; all pending status links point to owned context. Migrate fixtures that previously raw-INSERTed V1 IN_PRODUCTION into legitimate OPEN→plan→check→start; completion fixtures record use. True LEGACY fixtures seed through 0013 then apply0014 using migration-boundary helper, never force policy/update or disable triggers. Old PG concurrency fixtures may use pre-cutover setup to preserve their **same five** Operations race assertions; add V1 cases separately, do not weaken old outcomes.
- [ ] **Step 4 — Verify:** `pnpm test:run` full suite, `pnpm typecheck`, `pnpm lint`, `pnpm build`; report existing warnings separately. If a fixture failure exposes new behavior rather than setup, fix owning task, not expectations solely to make green.
- [ ] **Step 5 — Commit:** `git commit -m "feat: connect consumption gates across cycle and stock workflows"` for only intended entry/fixture changes.

## Task 13: Real PostgreSQL concurrency and final upgrade/integrity proof

**Files:** Create `tests/postgres/consumption-concurrency.test.mjs`; modify `package.json` adding `test:postgres:consumption` = `node --test tests/postgres/consumption-concurrency.test.mjs`; extend `src/modules/consumption/db/{schema.integrity,phase-5a-migration}.test.ts`. If deterministic application command races need TS, use installed TypeScript transpileModule to a mkdtemp test-only module tree with resolved aliases; do not add tsx/runtime deps or copy command implementations into tests.

**Interfaces:** Test runner requires `CONSUMPTION_LOCAL_PG_ADMIN_URL`, validates postgres protocol, hostname `127.0.0.1`, explicit port and `/postgres` **before connecting**. Creates exact uniquely named `dayoffdough_consumption_*` DB; two independent writer connections + observer, each max1; pg_blocking_pids/transaction barriers establish ordering, bounded statement/lock timeouts. Migration sequence and real-PG fixture same final0014 as app.

- [ ] **Step 1 — Write verification tests before any resulting fixes:** Both orderings of use/use (same and different keys), use/ordinaryCOUNT, correction/COUNT, purchase/use, start pending-registration/COUNT and selective-settlement/new related context. Assert legal serialization or stable retryable rejection, no negative final stock, one exact-retry operation, no partial current pointers/events. Opposite item orders in multi-item commands cannot deadlock. An ordinary COUNT cannot commit past pending registration; settlement cannot miss a context appearing for counted item; COUNT after initial use forces later correction history-only. Direct SQL child-first mutation contention fails retryably rather than holding inverted wait. Observer proves committed state, not sleep-based guesses. Run existing five Operations race regressions unchanged in meaning.

  ```js
  test("concurrent exact-intent confirmations commit one usage operation", async () => {
    assert.equal(observerState.operationCount,1);
    assert.equal(observerState.flourBalance,"50");
    assert.deepEqual(firstResult.revisionIds,retryResult.revisionIds);
    assert.equal(observerState.consumptionMovementCount,2);
  });
  ```
- [ ] **Step 2 — Record initial evidence:** Against explicit disposable local PG run `pnpm test:postgres:consumption` before protocol fixes; missing env/import is a setup error, not behavioral RED evidence. A discovered protocol failure returns to owning command/guard task for a focused RED/GREEN fix. If all new verification cases already pass, record that honestly; do not break production code to manufacture RED.
- [ ] **Step 3 — Complete proof / fix only demonstrated failures:** Complete deterministic test harness, final SQL guards and narrowly necessary protocol fixes with owning RED/GREEN. Verify schema catalog, owned FK mismatch, append-only/metadata rollback, pointer skip/rewind, fake settlement links, V1 INSERT/status/policy bypass rejection on actual PG. Fresh and upgrade through0013 produce unchanged legacy movements/balances/fingerprints; new Cycles get V1; final journal/snapshot matches schema.
- [ ] **Step 4 — Verify:** `pnpm test:postgres:consumption` and existing `pnpm test:postgres:race` PASS with their explicit local envs. `pnpm test:run src/modules/consumption/db` + affected command regressions PASS. Finally rollback connections/end clients and drop only exact DB names created by this runner, even on failure; no broad cleanup or shop connection.
- [ ] **Step 5 — Commit:** `git commit -m "test: prove consumption and count serialization on postgres"` with harness/targeted fixes and tests.

## Task 14: Authenticated phone/desktop E2E and release handoff

**Files:** Create `tests/e2e/consumption.spec.ts`, `tests/helpers/consumption-ui.ts`, `docs/operations/phase-5a-consumption-release.md`; modify `tests/e2e/operations.spec.ts`, `tests/e2e/production.spec.ts`, `tests/fixtures/owner.ts` and any affected planning/shopping E2E only for legitimate V1 stock/use steps. Reuse `isolatedLocalFixtureTarget` validation; no global test policy bypass.

**Interfaces:** UI helpers wrap visible owner actions, observe same-path action POST, and assert committed values; fixture setup is authenticated UI against isolated local app DB. Existing Supabase only authenticates, owner email/UUID verified through Auth, not a hardcoded unit-test owner. Test environment retains existing `E2E_ISOLATED_LOCAL_DATABASE=1` and explicit `E2E_LOCAL_DATABASE_PORT` opt-in; stop before writes if absent/unsafe.

- [ ] **Step 1 — Write verification flows before any resulting fixes:** On both existing phone/desktop projects: preorder→lock→stock check→purchase shortfall→start→confirm planned use before delivery→stock decreases by use only (overpurchase remains)→tasks/delivery complete→complete with unpaid warning→new count→historical correction preserves current stock. Separate flows cover cancelled actual/zero use, pending COUNT blocker and selective flour-count/boxes-DIRECT settlement, shortage rollback, stale preview refresh, and zero-item confirmation. Three consecutive save intents, error/value retention, keyboard cancel/focus, long Thai/English labels and native options tested. Assert document + form/card bounding boxes fit viewport in initial/edit/error/settlement/history states, not screenshot alone.

  ```ts
  test("historical correction after a count keeps current stock and fits the viewport", async ({page}) => {
    await expect(page.getByText("แก้ประวัติเท่านั้น ไม่ปรับสต๊อกปัจจุบัน",{exact:true})).toBeVisible();
    expect(stockAfterHistoricalCorrection).toBe("25");
    expect(await page.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
  ```
- [ ] **Step 2 — Record initial evidence:** `pnpm test:e2e tests/e2e/consumption.spec.ts --project=phone --project=desktop` against isolated local migrated app; either PASS or a genuine integration/geometry failure is possible after Tasks1–12. Pin any failure in the owning component/action test before fixing it. Missing credentials is setup failure, not RED; never manufacture RED for a verification-only task.
- [ ] **Step 3 — GREEN implementation:** Complete test helpers/minimal UI fixes with targeted tests. Release note records cutover scope, count-settlement explanation, no retroactive usage, current correction rules, full forward migration prerequisites, backup/maintenance window and separate actual-shop migration approval; no destructive down-migration promise or automatic deploy. Persist migration/fingerprint assertions without printing secrets.
- [ ] **Step 4 — Final verify:** Run `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, both PG race scripts and full `pnpm test:e2e`; `git diff --check`. Save exact commands/results/warnings and any blocked checks. Stop only task-owned local servers/containers; close connections and remove disposable fixtures via exact validated local targets or remove entire exact disposable DB. Never erase immutable shop ledger to clean tests. Actual-shop DB unchanged. Request whole-branch review through chosen Subagent-Driven workflow, resolve findings with fresh RED/GREEN, then reverify affected/full gates proportionately.
- [ ] **Step 5 — Commit / handoff:** Stage only release/E2E/verified fixes; `git commit -m "test: verify consumption workflow on phone and desktop"`. Report completed tasks/evidence, remaining risks and migration-not-applied status. Integration/merge/push/deploy follow separate user choice, not assumed from design approval.

## Self-review / requirement coverage

- User decisions 1–7: no reservations (global); independent after-bake confirm (4/10/12/14); pending COUNT barrier (3/7/9/12/13); correction reason/history and post-count freeze (1/2/5/10/13); cancelled actual (4/6/10/14); no out-of-plan (1/3/4/7); no retrospective cutover (2/6/13).
- Spec acceptance 1→Tasks1/3; 2→4/7; 3→1/4/5/7/13; 4→1/3/4/8; 5→3/6; 6→4/6/10; 7→3/9/12/13; 8→7/11/13; 9→2/5/13; 10→13; 11→2–7/13; 12→4/7/8/9; 13→14; 14→12–14.
- Interface names match shared definitions; the source-only loader is extracted once, DatabaseTransaction exists in Task2 before later users, the writer is defined in Task4 and reused by5/7, query/action types exist before UI. Read previews use coherent read-only snapshots rather than a helper requiring write locks. No task relies on an unimplemented future command.
- All five Review Focus lines have named owning tests above. SQL is not considered complete at Task2; final completeness and races must pass before any release. No implementation, dependency installation, migration or worktree creation is part of writing this plan.
- Execution handoff: user reviews this plan, then preserve Subagent-Driven. Plan approval does not grant actual-shop migration, merge, push or deployment authority.
