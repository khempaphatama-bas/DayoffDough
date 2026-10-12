import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import { createCycleOperationsCommandService } from "./cycle-commands";
import { createOperationsQueryService } from "./operations-queries";
import { createOrderOperationsCommandService } from "./order-commands";

const MISSING_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const WRONG_GENERATION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MANUAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLOCK = { now: () => new Date("2026-08-29T05:00:00.000Z") };

describe("cycle operations commands", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  async function scenario() {
    const value = await seedLockedPlanningScenario(context.db);
    const [generation] = await context.db.select().from(cycleTaskGenerations).where(and(
      eq(cycleTaskGenerations.ownerId, OWNER_ID),
      eq(cycleTaskGenerations.planningSnapshotId, value.planningSnapshotId),
    ));
    return { ...value, taskGenerationId: generation!.id };
  }

  async function finishWork(s: Awaited<ReturnType<typeof scenario>>, options: { leavePaymentPartial?: boolean; skipped?: boolean } = {}) {
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId });
    await commands.startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: s.orderIds.slice(0, 2) });
    for (const orderId of s.orderIds.slice(0, 2)) {
      const [item] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, orderId!));
      await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: item!.id, packedQuantity: item!.quantity, expectedPackedQuantity: 0 });
      await commands.confirmOrderPacked(OWNER_ID, { cycleId: s.cycleId, orderId: orderId! });
    }
    await commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: s.orderIds.slice(0, 2) });
    await context.db.update(cycleTasks).set(options.skipped
      ? { status: "SKIPPED", skipReason: "ไม่ต้องทำแล้ว" }
      : { status: "DONE", skipReason: null })
      .where(eq(cycleTasks.cycleTaskGenerationId, s.taskGenerationId));
    if (options.leavePaymentPartial) {
      await context.db.update(orders).set({ amountPaidSatang: 23_000, paymentStatus: "PARTIAL" })
        .where(eq(orders.id, s.orderIds[0]!));
    }
  }

  const completionInput = (s: Awaited<ReturnType<typeof scenario>>) => ({
    cycleId: s.cycleId, expectedTaskGenerationId: s.taskGenerationId, confirmation: true as const,
  });

  it("starts a locked cycle with the active generation and accepts an exact retry", async () => {
    const s = await scenario();
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    expect(await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId })).toMatchObject({ status: "IN_PRODUCTION", updatedAt: CLOCK.now() });
    expect(await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId })).toMatchObject({ status: "IN_PRODUCTION" });
  });

  it("rejects start without an active snapshot and current task generation", async () => {
    const s = await scenario();
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    await context.db.update(bakeCycles).set({ activePlanningSnapshotId: null }).where(eq(bakeCycles.id, s.cycleId));
    await expect(cycles.startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toMatchObject({ kind: "STALE_DATA" });
    await context.db.update(bakeCycles).set({ activePlanningSnapshotId: s.planningSnapshotId }).where(eq(bakeCycles.id, s.cycleId));
    await context.db.update(cyclePlanningSnapshots).set({
      status: "SUPERSEDED", unlockedAt: CLOCK.now(), unlockReason: "Re-plan", unlockedFromStatus: "LOCKED",
    }).where(eq(cyclePlanningSnapshots.id, s.planningSnapshotId));
    await expect(cycles.startCycle(OWNER_ID, { cycleId: s.cycleId })).rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("rejects a locked legacy snapshot that has no current task generation", async () => {
    const s = await seedPlanningScenario(context.db);
    const snapshotId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await context.db.insert(cyclePlanningSnapshots).values({
      id: snapshotId, ownerId: OWNER_ID, bakeCycleId: s.cycleId,
      generation: 1, status: "ACTIVE", lockRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      inputFingerprint: "a".repeat(64), cycleNumber: 7, cycleName: "Legacy plan",
      targetProductionDate: "2026-08-29", primaryDeliveryDate: "2026-08-30",
      laborRateSatangPerHour: 12_000, defaultWasteAllowancePercent: "3.0000",
      timezone: "Asia/Bangkok", currency: "THB", costComplete: true, lockedAt: CLOCK.now(),
    });
    await context.db.update(bakeCycles).set({ activePlanningSnapshotId: snapshotId, status: "LOCKED" })
      .where(eq(bakeCycles.id, s.cycleId));
    await expect(createCycleOperationsCommandService(context.db, CLOCK).startCycle(OWNER_ID, { cycleId: s.cycleId }))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("blocks completion with current unfinished task and order counts", async () => {
    const s = await scenario();
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId });
    await expect(cycles.completeCycle(OWNER_ID, completionInput(s))).rejects.toMatchObject({
      kind: "CYCLE_COMPLETION_BLOCKED",
      details: { remainingTaskCount: 1, remainingOrderCount: 2 },
    });
  });

  it("completes delivered work with a partial-payment warning and retries the same generation", async () => {
    const s = await scenario();
    await finishWork(s, { leavePaymentPartial: true, skipped: true });
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    const input = completionInput(s);
    expect(await cycles.completeCycle(OWNER_ID, input)).toMatchObject({
      cycleStatus: "COMPLETED", unpaidOrderCount: 1, outstandingSatang: 42_000,
    });
    expect(await cycles.completeCycle(OWNER_ID, input)).toMatchObject({
      cycleStatus: "COMPLETED", unpaidOrderCount: 1, outstandingSatang: 42_000,
    });
    const [cycle] = await context.db.select().from(bakeCycles).where(eq(bakeCycles.id, s.cycleId));
    expect(cycle).toMatchObject({ status: "COMPLETED", updatedAt: CLOCK.now() });
  });

  it("excludes soft-deleted manual tasks and cancelled orders from completion blockers", async () => {
    const s = await scenario();
    await finishWork(s);
    await context.db.insert(cycleTasks).values({
      id: MANUAL_ID, ownerId: OWNER_ID, cycleTaskGenerationId: s.taskGenerationId,
      origin: "MANUAL", creationRequestId: MANUAL_ID, title: "removed manual task",
      scheduledAt: CLOCK.now(), estimatedDurationMinutes: 10, sequence: 999,
      status: "PENDING", deletedAt: CLOCK.now(),
    });
    expect(await createCycleOperationsCommandService(context.db, CLOCK).completeCycle(OWNER_ID, completionInput(s)))
      .toMatchObject({ cycleStatus: "COMPLETED", unpaidOrderCount: 0, outstandingSatang: 0 });
  });

  it("preserves SKIPPED reason integrity before completing", async () => {
    const s = await scenario();
    await finishWork(s);
    await expect(context.db.update(cycleTasks).set({ status: "SKIPPED", skipReason: null })
      .where(eq(cycleTasks.cycleTaskGenerationId, s.taskGenerationId)))
      .rejects.toThrow();
    expect(await createCycleOperationsCommandService(context.db, CLOCK).completeCycle(OWNER_ID, completionInput(s)))
      .toMatchObject({ cycleStatus: "COMPLETED" });
  });

  it("rejects wrong and superseded task generations, including after unlock and re-lock", async () => {
    const s = await scenario();
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId });
    await expect(cycles.completeCycle(OWNER_ID, { ...completionInput(s), expectedTaskGenerationId: WRONG_GENERATION_ID }))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
    await context.db.update(orders).set({ fulfillmentStatus: "CONFIRMED" }).where(eq(orders.id, s.orderIds[1]!));
    await createPlanningCommandService(context.db, CLOCK).unlock(OWNER_ID, {
      cycleId: s.cycleId, reason: "Re-plan", confirmation: "ปลดล็อก",
    });
    const preview = await createPlanningQueryService(context.db, CLOCK).preview(OWNER_ID, s.cycleId);
    await createPlanningCommandService(context.db, CLOCK).lock(OWNER_ID, {
      cycleId: s.cycleId, lockRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddc", inputFingerprint: preview.inputFingerprint, overrides: [],
    });
    await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId });
    await expect(cycles.completeCycle(OWNER_ID, completionInput(s))).rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("recomputes completion after the UI read when task readiness changes", async () => {
    const s = await scenario();
    await finishWork(s);
    expect((await createOperationsQueryService(context.db, CLOCK).getCycleOperations(OWNER_ID, s.cycleId)).kind).toBe("READY");
    await context.db.update(cycleTasks).set({ status: "PENDING" }).where(eq(cycleTasks.cycleTaskGenerationId, s.taskGenerationId));
    await expect(createCycleOperationsCommandService(context.db, CLOCK).completeCycle(OWNER_ID, completionInput(s)))
      .rejects.toMatchObject({ kind: "CYCLE_COMPLETION_BLOCKED", details: { remainingTaskCount: 1 } });
  });

  it("does not disclose unknown or cross-owner cycles, even for completion retries", async () => {
    await scenario();
    const foreign = await seedLockedPlanningScenario(context.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    for (const cycleId of [MISSING_ID, foreign.cycleId]) {
      await expect(cycles.startCycle(OWNER_ID, { cycleId }))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
      await expect(cycles.completeCycle(OWNER_ID, { cycleId, expectedTaskGenerationId: WRONG_GENERATION_ID, confirmation: true }))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
    }
  });
});
