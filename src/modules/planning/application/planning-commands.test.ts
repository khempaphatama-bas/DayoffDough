import { and, count, eq, sql } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orders } from "@/modules/orders/db/schema";
import { products } from "@/modules/products/db/schema";
import {
  cycleCostSnapshots,
  cycleInventoryPriceSnapshots,
  cycleMaterialRequirements,
  cycleOrderItemSnapshots,
  cycleOrderSnapshots,
  cyclePackagingRequirements,
  cyclePlanningSnapshots,
  cyclePlanningWarnings,
  cycleProductCostSnapshots,
  cycleProductPlans,
  cycleRecipePlans,
} from "@/modules/planning/db/schema";
import {
  createPlanningCommandService,
  PlanningBlockedError,
  PlanningStateError,
  PlanningStaleError,
} from "./planning-commands";
import { createPlanningQueryService } from "./planning-queries";

const LOCKED_AT = new Date("2026-08-29T00:00:00.000Z");
const LOCK_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

describe("planning command service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("locks one complete normalized generation with copied settings and source lineage", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const preview = await createPlanningQueryService(context.db, {
      now: () => new Date(LOCKED_AT),
    }).preview(OWNER_ID, scenario.cycleId);
    let clockCalls = 0;
    const lockInstants = [
      LOCKED_AT,
      new Date("2026-08-29T00:00:01.000Z"),
    ];
    const commands = createPlanningCommandService(context.db, {
      now() {
        const instant = lockInstants[clockCalls];
        clockCalls += 1;
        if (!instant) throw new Error("Planning lock clock called too often");
        return new Date(instant);
      },
    });

    const lockPromise = commands.lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId: LOCK_REQUEST_ID,
      overrides: [
        {
          productId: scenario.productId,
          selectedBatchCount: "1.5",
          reason: "ตั้งใจลดหนึ่งชิ้น",
        },
      ],
    });

    await expect(lockPromise).resolves.toMatchObject({
      cycleId: scenario.cycleId,
      generation: 1,
      status: "ACTIVE",
      costComplete: true,
      lockedAt: LOCKED_AT,
    });
    const locked = await lockPromise;
    expect(clockCalls).toBe(1);

    const [cycle] = await context.db
      .select()
      .from(bakeCycles)
      .where(
        and(
          eq(bakeCycles.ownerId, OWNER_ID),
          eq(bakeCycles.id, scenario.cycleId),
        ),
      );
    expect(cycle).toMatchObject({
      status: "LOCKED",
      activePlanningSnapshotId: locked.id,
      lockedAt: LOCKED_AT,
    });

    const [parent] = await context.db
      .select()
      .from(cyclePlanningSnapshots)
      .where(eq(cyclePlanningSnapshots.id, locked.id));
    expect(parent).toMatchObject({
      ownerId: OWNER_ID,
      bakeCycleId: scenario.cycleId,
      generation: 1,
      status: "ACTIVE",
      lockRequestId: LOCK_REQUEST_ID,
      inputFingerprint: preview.inputFingerprint,
      laborRateSatangPerHour: 12_000,
      defaultWasteAllowancePercent: "3.0000",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt: LOCKED_AT,
    });

    const tableCounts = await Promise.all([
      context.db.select({ value: count() }).from(cyclePlanningWarnings),
      context.db.select({ value: count() }).from(cycleOrderSnapshots),
      context.db.select({ value: count() }).from(cycleOrderItemSnapshots),
      context.db.select({ value: count() }).from(cycleRecipePlans),
      context.db.select({ value: count() }).from(cycleProductPlans),
      context.db.select({ value: count() }).from(cycleInventoryPriceSnapshots),
      context.db.select({ value: count() }).from(cycleMaterialRequirements),
      context.db.select({ value: count() }).from(cyclePackagingRequirements),
      context.db.select({ value: count() }).from(cycleProductCostSnapshots),
      context.db.select({ value: count() }).from(cycleCostSnapshots),
    ]);
    expect(tableCounts.map(([row]) => row!.value)).toEqual([
      1, 2, 2, 1, 1, 2, 1, 2, 1, 1,
    ]);

    const [recipePlan] = await context.db
      .select()
      .from(cycleRecipePlans)
      .where(eq(cycleRecipePlans.planningSnapshotId, locked.id));
    const [productPlan] = await context.db
      .select()
      .from(cycleProductPlans)
      .where(eq(cycleProductPlans.planningSnapshotId, locked.id));
    const [material] = await context.db
      .select()
      .from(cycleMaterialRequirements)
      .where(eq(cycleMaterialRequirements.planningSnapshotId, locked.id));
    expect(productPlan).toMatchObject({
      recipePlanId: recipePlan!.id,
      sourceProductId: scenario.productId,
      selectedBatchCount: "1.500000",
      overrideReason: "ตั้งใจลดหนึ่งชิ้น",
      plannedOutput: "9.000000",
      outputDifference: "-1.000000",
    });
    expect(material).toMatchObject({
      productPlanId: productPlan!.id,
      recipePlanId: recipePlan!.id,
      sourceRecipeVersionId: recipePlan!.sourceRecipeVersionId,
      inventoryItemId: scenario.ingredientItemId,
      selectedBatchCount: "1.500000",
      baseRequirement: "1500.000000",
      wasteQuantity: "150.000000",
      plannedRequirement: "1650.000000",
      baseCostSatang: 8_250,
      wasteCostSatang: 825,
    });

    const orderSnapshots = await context.db
      .select()
      .from(cycleOrderSnapshots)
      .where(eq(cycleOrderSnapshots.planningSnapshotId, locked.id));
    const orderSnapshotBySourceId = new Map(
      orderSnapshots.map((order) => [order.sourceOrderId, order.id]),
    );
    const itemSnapshots = await context.db
      .select()
      .from(cycleOrderItemSnapshots)
      .where(eq(cycleOrderItemSnapshots.planningSnapshotId, locked.id));
    expect(itemSnapshots).toHaveLength(2);
    for (const item of itemSnapshots) {
      expect(item.orderSnapshotId).toBe(
        orderSnapshotBySourceId.get(item.sourceOrderId),
      );
    }

    const [cycleCost] = await context.db
      .select()
      .from(cycleCostSnapshots)
      .where(eq(cycleCostSnapshots.planningSnapshotId, locked.id));
    expect(cycleCost).toMatchObject({
      knownProductionCostSatang: 21_185,
      completeProductionCostSatang: 21_185,
      missingPriceCount: 0,
      costComplete: true,
    });
  });

  it("opens the real lock transaction with repeatable-read isolation", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    const transactionConfigs: unknown[] = [];
    const observedDb = new Proxy(context.db, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver);
        }
        return (...args: unknown[]) => {
          transactionConfigs.push(args[1]);
          return Reflect.apply(target.transaction, target, args);
        };
      },
    }) as DatabaseClient;

    await createPlanningCommandService(observedDb, clock).lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId: "12121212-1212-4212-8212-121212121212",
      overrides: [],
    });

    expect(transactionConfigs).toEqual([{ isolationLevel: "repeatable read" }]);
  });

  it("locks exactly the owned Bake Cycle row with FOR UPDATE", async () => {
    const loggedQueries: Array<Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>> = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string, params: unknown[]) {
          loggedQueries.push({ sql: query.toLowerCase(), params: [...params] });
        },
      } satisfies Logger,
    });
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    loggedQueries.length = 0;

    await createPlanningCommandService(context.db, clock).lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId: "13131313-1313-4313-8313-131313131313",
      overrides: [],
    });

    const cycleLocks = loggedQueries.filter(
      (query) =>
        query.sql.includes('from "bake_cycles"') &&
        query.sql.includes("for update"),
    );
    expect(cycleLocks).toHaveLength(1);
    expect(cycleLocks[0]!.sql).toContain(
      '("bake_cycles"."owner_id" = $1 and "bake_cycles"."id" = $2)',
    );
    expect(cycleLocks[0]!.params.slice(0, 2)).toEqual([
      OWNER_ID,
      scenario.cycleId,
    ]);
  });

  it("rejects a stale fingerprint and leaves the cycle open without snapshot rows", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    await context.db
      .update(orders)
      .set({ discountSatang: 100 })
      .where(eq(orders.id, scenario.orderIds[0]!));

    await expect(
      createPlanningCommandService(context.db, clock).lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "33333333-3333-4333-8333-333333333333",
        overrides: [],
      }),
    ).rejects.toBeInstanceOf(PlanningStaleError);

    const [cycle] = await context.db
      .select({
        status: bakeCycles.status,
        activePlanningSnapshotId: bakeCycles.activePlanningSnapshotId,
      })
      .from(bakeCycles)
      .where(eq(bakeCycles.id, scenario.cycleId));
    const [snapshotCount] = await context.db
      .select({ value: count() })
      .from(cyclePlanningSnapshots);
    expect(cycle).toEqual({
      status: "OPEN",
      activePlanningSnapshotId: null,
    });
    expect(snapshotCount!.value).toBe(0);
  });

  it("returns the same generation for a repeated lock request without duplicating rows", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    const commands = createPlanningCommandService(context.db, clock);
    const input = {
      cycleId: scenario.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId: "44444444-4444-4444-8444-444444444444",
      overrides: [],
    };

    const first = await commands.lock(OWNER_ID, input);
    const repeated = await commands.lock(OWNER_ID, input);

    expect(repeated).toEqual(first);
    const counts = await Promise.all([
      context.db.select({ value: count() }).from(cyclePlanningSnapshots),
      context.db.select({ value: count() }).from(cycleOrderSnapshots),
      context.db.select({ value: count() }).from(cycleMaterialRequirements),
      context.db.select({ value: count() }).from(cycleCostSnapshots),
    ]);
    expect(counts.map(([row]) => row!.value)).toEqual([1, 2, 1, 1]);
  });

  it("scopes the same lock request id independently per owner without cross-owner disclosure", async () => {
    const firstScenario = await seedPlanningScenario(context.db);
    const secondScenario = await seedPlanningScenario(context.db, {
      ownerId: OTHER_OWNER_ID,
      idSet: "SECONDARY",
    });
    const clock = { now: () => new Date(LOCKED_AT) };
    const queries = createPlanningQueryService(context.db, clock);
    const commands = createPlanningCommandService(context.db, clock);
    const [firstPreview, secondPreview] = await Promise.all([
      queries.preview(OWNER_ID, firstScenario.cycleId),
      queries.preview(OTHER_OWNER_ID, secondScenario.cycleId),
    ]);
    const sharedRequestId = "14141414-1414-4414-8414-141414141414";

    const first = await commands.lock(OWNER_ID, {
      cycleId: firstScenario.cycleId,
      inputFingerprint: firstPreview.inputFingerprint,
      lockRequestId: sharedRequestId,
      overrides: [],
    });
    const second = await commands.lock(OTHER_OWNER_ID, {
      cycleId: secondScenario.cycleId,
      inputFingerprint: secondPreview.inputFingerprint,
      lockRequestId: sharedRequestId,
      overrides: [],
    });

    expect(first).toMatchObject({
      cycleId: firstScenario.cycleId,
      generation: 1,
    });
    expect(second).toMatchObject({
      cycleId: secondScenario.cycleId,
      generation: 1,
    });
    expect(second.id).not.toBe(first.id);
    const sharedRows = await context.db
      .select({
        ownerId: cyclePlanningSnapshots.ownerId,
        cycleId: cyclePlanningSnapshots.bakeCycleId,
        id: cyclePlanningSnapshots.id,
      })
      .from(cyclePlanningSnapshots)
      .where(eq(cyclePlanningSnapshots.lockRequestId, sharedRequestId));
    expect(sharedRows).toEqual(
      expect.arrayContaining([
        { ownerId: OWNER_ID, cycleId: firstScenario.cycleId, id: first.id },
        {
          ownerId: OTHER_OWNER_ID,
          cycleId: secondScenario.cycleId,
          id: second.id,
        },
      ]),
    );
    expect(sharedRows).toHaveLength(2);
    await expect(
      queries.getGeneration(OWNER_ID, firstScenario.cycleId),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      queries.getGeneration(OTHER_OWNER_ID, secondScenario.cycleId),
    ).resolves.toMatchObject({ id: second.id });

    await expect(
      commands.lock(OWNER_ID, {
        cycleId: secondScenario.cycleId,
        inputFingerprint: secondPreview.inputFingerprint,
        lockRequestId: sharedRequestId,
        overrides: [],
      }),
    ).rejects.toThrow("Cycle not found");
    const [afterCrossOwnerCount] = await context.db
      .select({ value: count() })
      .from(cyclePlanningSnapshots);
    expect(afterCrossOwnerCount!.value).toBe(2);
  });

  it("rejects a lock request id that already belongs to another cycle", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    const commands = createPlanningCommandService(context.db, clock);
    const lockRequestId = "55555555-5555-4555-8555-555555555555";
    await commands.lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId,
      overrides: [],
    });
    const secondCycleId = "90000000-0000-4000-8000-000000000001";
    await context.db.insert(bakeCycles).values({
      id: secondCycleId,
      ownerId: OWNER_ID,
      name: "รอบถัดไป",
      status: "OPEN",
      targetProductionDate: "2026-09-05",
      primaryDeliveryDate: "2026-09-06",
    });

    let thrown: unknown;
    try {
      await commands.lock(OWNER_ID, {
        cycleId: secondCycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId,
        overrides: [],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PlanningStateError);
    expect((thrown as Error).message).toBe(
      "Lock request belongs to another cycle",
    );
  });

  it("rejects authoritative blockers and persists no generation", async () => {
    const scenario = await seedPlanningScenario(context.db);
    await context.db
      .update(products)
      .set({ activeRecipeVersionId: null })
      .where(eq(products.id, scenario.productId));
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual([
      "MISSING_ACTIVE_RECIPE",
    ]);

    let thrown: unknown;
    try {
      await createPlanningCommandService(context.db, clock).lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "66666666-6666-4666-8666-666666666666",
        overrides: [],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PlanningBlockedError);
    expect((thrown as PlanningBlockedError).blockers).toEqual(
      preview.blockers,
    );
    const [snapshotCount] = await context.db
      .select({ value: count() })
      .from(cyclePlanningSnapshots);
    const [cycle] = await context.db
      .select({
        status: bakeCycles.status,
        activePlanningSnapshotId: bakeCycles.activePlanningSnapshotId,
      })
      .from(bakeCycles)
      .where(eq(bakeCycles.id, scenario.cycleId));
    expect(snapshotCount!.value).toBe(0);
    expect(cycle).toEqual({
      status: "OPEN",
      activePlanningSnapshotId: null,
    });
  });

  it("rolls back the parent, every child, and cycle state when a late insert fails", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    await context.db.execute(sql`
      CREATE FUNCTION fail_cycle_cost_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced planning rollback'; END;
      $$ LANGUAGE plpgsql
    `);
    await context.db.execute(sql`
      CREATE TRIGGER force_cycle_cost_failure
      BEFORE INSERT ON cycle_cost_snapshots
      FOR EACH ROW EXECUTE FUNCTION fail_cycle_cost_insert()
    `);

    await expect(
      createPlanningCommandService(context.db, clock).lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "77777777-7777-4777-8777-777777777777",
        overrides: [],
      }),
    ).rejects.toThrow();

    const rowCounts = await Promise.all([
      context.db.select({ value: count() }).from(cyclePlanningSnapshots),
      context.db.select({ value: count() }).from(cyclePlanningWarnings),
      context.db.select({ value: count() }).from(cycleOrderSnapshots),
      context.db.select({ value: count() }).from(cycleOrderItemSnapshots),
      context.db.select({ value: count() }).from(cycleRecipePlans),
      context.db.select({ value: count() }).from(cycleProductPlans),
      context.db.select({ value: count() }).from(cycleInventoryPriceSnapshots),
      context.db.select({ value: count() }).from(cycleMaterialRequirements),
      context.db.select({ value: count() }).from(cyclePackagingRequirements),
      context.db.select({ value: count() }).from(cycleProductCostSnapshots),
      context.db.select({ value: count() }).from(cycleCostSnapshots),
    ]);
    expect(rowCounts.map(([row]) => row!.value)).toEqual(
      Array.from({ length: 11 }, () => 0),
    );
    const [cycle] = await context.db
      .select({
        status: bakeCycles.status,
        activePlanningSnapshotId: bakeCycles.activePlanningSnapshotId,
        lockedAt: bakeCycles.lockedAt,
      })
      .from(bakeCycles)
      .where(eq(bakeCycles.id, scenario.cycleId));
    expect(cycle).toEqual({
      status: "OPEN",
      activePlanningSnapshotId: null,
      lockedAt: null,
    });
  });

  it("allows exactly one of two concurrent lock requests to create the active generation", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const preview = await createPlanningQueryService(context.db, clock).preview(
      OWNER_ID,
      scenario.cycleId,
    );
    const commands = createPlanningCommandService(context.db, clock);

    const results = await Promise.allSettled([
      commands.lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "88888888-8888-4888-8888-888888888888",
        overrides: [],
      }),
      commands.lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "99999999-9999-4999-8999-999999999999",
        overrides: [],
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      PlanningStateError,
    );
    expect(((rejected as PromiseRejectedResult).reason as Error).message).toBe(
      "Cycle is not open for locking",
    );
    const snapshots = await context.db
      .select()
      .from(cyclePlanningSnapshots)
      .where(
        and(
          eq(cyclePlanningSnapshots.ownerId, OWNER_ID),
          eq(cyclePlanningSnapshots.bakeCycleId, scenario.cycleId),
        ),
      );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ generation: 1, status: "ACTIVE" });
  });

  it("creates the next generation and lists newest first after a prior generation is superseded", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const clock = { now: () => new Date(LOCKED_AT) };
    const queries = createPlanningQueryService(context.db, clock);
    const commands = createPlanningCommandService(context.db, clock);
    const firstPreview = await queries.preview(OWNER_ID, scenario.cycleId);
    const first = await commands.lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: firstPreview.inputFingerprint,
      lockRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      overrides: [],
    });
    const unlockedAt = new Date("2026-08-29T01:00:00.000Z");
    await context.db
      .update(bakeCycles)
      .set({
        status: "OPEN",
        activePlanningSnapshotId: null,
        lockedAt: null,
        updatedAt: unlockedAt,
      })
      .where(eq(bakeCycles.id, scenario.cycleId));
    await context.db
      .update(cyclePlanningSnapshots)
      .set({
        status: "SUPERSEDED",
        unlockedAt,
        unlockReason: "แก้ข้อมูลทดสอบ",
        unlockedFromStatus: "LOCKED",
      })
      .where(eq(cyclePlanningSnapshots.id, first.id));

    const secondPreview = await queries.preview(OWNER_ID, scenario.cycleId);
    const second = await commands.lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: secondPreview.inputFingerprint,
      lockRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      overrides: [],
    });

    expect(second.generation).toBe(2);
    await expect(queries.listGenerations(OWNER_ID, scenario.cycleId)).resolves
      .toEqual([
        expect.objectContaining({
          id: second.id,
          generation: 2,
          status: "ACTIVE",
        }),
        expect.objectContaining({
          id: first.id,
          generation: 1,
          status: "SUPERSEDED",
          unlockReason: "แก้ข้อมูลทดสอบ",
        }),
      ]);
    await expect(
      queries.getGeneration(OWNER_ID, scenario.cycleId),
    ).resolves.toMatchObject({ id: second.id, generation: 2 });
    await expect(
      queries.getGeneration(OWNER_ID, scenario.cycleId, 1),
    ).resolves.toMatchObject({
      id: first.id,
      generation: 1,
      status: "SUPERSEDED",
    });
  });
});
