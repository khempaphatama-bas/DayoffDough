import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import {
  seedLockedPlanningScenario,
  seedPlanningScenario,
} from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orderItemPackingProgress } from "@/modules/operations/db/schema";
import { customers } from "@/modules/customers/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { cycleOrderItemSnapshots, cycleOrderSnapshots, cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import { compareOperationsCycles, createOperationsQueryService } from "./operations-queries";
import { createCycleOperationsCommandService } from "./cycle-commands";
import { createOrderOperationsCommandService } from "./order-commands";

const MISSING_CYCLE_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const CLOCK = { now: () => new Date("2026-08-29T05:00:00.000Z") };

describe("Operations switcher tie breaks", () => {
  const base = { id: "b", status: "LOCKED" as const, primaryDeliveryDate: "2026-08-29", cycleNumber: 20 };

  it.each([
    { key: "delivery date", earlier: { ...base, id: "z", primaryDeliveryDate: "2026-08-28", cycleNumber: 99 } },
    { key: "cycle number after equal dates", earlier: { ...base, id: "z", cycleNumber: 19 } },
    // Cycle numbers are unique in persisted rows; this defensive last tie-break
    // is exercised directly without weakening the real database constraint.
    { key: "ID after equal dates and cycle numbers", earlier: { ...base, id: "a" } },
  ])("sorts by $key before considering later keys", ({ earlier }) => {
    expect([base, earlier].sort(compareOperationsCycles).map(cycle => cycle.id)).toEqual([earlier.id, "b"]);
    expect([earlier, base].sort(compareOperationsCycles).map(cycle => cycle.id)).toEqual([earlier.id, "b"]);
  });
});

describe("cycle operations query", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  async function readyView(cycleId: string) {
    const view = await createOperationsQueryService(context.db, CLOCK)
      .getCycleOperations(OWNER_ID, cycleId);
    expect(view.kind).toBe("READY");
    if (view.kind !== "READY") throw new Error("Expected READY");
    return view;
  }

  async function finishOrders(scenario: Awaited<ReturnType<typeof seedLockedPlanningScenario>>) {
    const cycles = createCycleOperationsCommandService(context.db);
    const commands = createOrderOperationsCommandService(context.db);
    await cycles.startCycle(OWNER_ID, { cycleId: scenario.cycleId });
    const activeOrderIds = scenario.orderIds.slice(0, 2);
    await commands.startOrders(OWNER_ID, { cycleId: scenario.cycleId, orderIds: activeOrderIds });
    for (const orderId of activeOrderIds) {
      const [item] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      await commands.setPackedQuantity(OWNER_ID, { cycleId: scenario.cycleId,
        orderItemId: item!.id, packedQuantity: item!.quantity, expectedPackedQuantity: 0 });
      await commands.confirmOrderPacked(OWNER_ID, { cycleId: scenario.cycleId, orderId });
    }
    await commands.deliverOrders(OWNER_ID, { cycleId: scenario.cycleId, orderIds: activeOrderIds });
  }

  it("supplies all owner-scoped active products for task editing, not only task products", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await context.db.insert(products).values([
      { id: "60000000-0000-4000-8000-000000000121", ownerId: OWNER_ID, name: "B active unrelated", sellingUnit: "piece", defaultUnitPriceSatang: 100 },
      { id: "60000000-0000-4000-8000-000000000122", ownerId: OWNER_ID, name: "A active unrelated", sellingUnit: "piece", defaultUnitPriceSatang: 100 },
      { id: "60000000-0000-4000-8000-000000000123", ownerId: OWNER_ID, name: "Inactive", sellingUnit: "piece", defaultUnitPriceSatang: 100, active: false },
      { id: "60000000-0000-4000-8000-000000000124", ownerId: OTHER_OWNER_ID, name: "Foreign", sellingUnit: "piece", defaultUnitPriceSatang: 100 },
    ]);
    const view = await readyView(scenario.cycleId);
    expect(view.products).toEqual([
      { id: "60000000-0000-4000-8000-000000000122", name: "A active unrelated" },
      { id: "60000000-0000-4000-8000-000000000121", name: "B active unrelated" },
      { id: scenario.productId, name: "ฟอคคาเซีย" },
    ]);
  });

  it("uses the current generation, frozen membership and names, and live state", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    const [generation] = await context.db.select().from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, scenario.planningSnapshotId));
    const [task] = await context.db.select().from(cycleTasks)
      .where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
    await context.db.update(customers).set({ name: "Renamed customer" })
      .where(eq(customers.id, "10000000-0000-4000-8000-000000000008"));
    await context.db.update(products).set({ name: "Renamed product" })
      .where(eq(products.id, scenario.productId));
    await context.db.update(orders).set({ paymentStatus: "PARTIAL", amountPaidSatang: 1000 })
      .where(eq(orders.id, scenario.orderIds[0]!));
    await context.db.update(orderItems).set({ quantity: 9, unitPriceSatang: 15_000 })
      .where(eq(orderItems.orderId, scenario.orderIds[0]!));

    const view = await readyView(scenario.cycleId);
    expect(view.generation).toEqual({
      id: generation!.id,
      planningSnapshotId: scenario.planningSnapshotId,
      generation: 1,
    });
    expect(view.tasks.map(({ id }) => id)).toEqual([task!.id]);
    expect(view.orders.map(({ id }) => id)).toEqual(scenario.orderIds.slice(0, 2));
    expect(view.orders[0]).toMatchObject({
      customerName: "คุณเมย์",
      grandTotalSatang: 65_000,
      amountPaidSatang: 1000,
      balanceSatang: 64_000,
      paymentStatus: "PARTIAL",
      items: [{ productName: "ฟอคคาเซีย", quantity: 5, packedQuantity: 0, unitPriceSatang: 12_000 }],
    });
    expect(view.cancelledOrders.map(({ id, paymentStatus }) => ({ id, paymentStatus })))
      .toEqual([{ id: scenario.orderIds[2], paymentStatus: "REFUNDED" }]);
    expect(view.completion).toMatchObject({
      ready: false,
      remainingTaskCount: 1,
      remainingOrderCount: 2,
      unpaidOrderCount: 1,
      outstandingSatang: 64_000,
    });
  });

  it("reads frozen delivery instructions for active orders and live notes for cancelled disclosure", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await context.db.update(cycleOrderSnapshots).set({ deliveryNote: "Snapshot delivery", specialInstructions: "Snapshot special" })
      .where(eq(cycleOrderSnapshots.sourceOrderId, scenario.orderIds[0]!));
    await context.db.update(orders).set({ deliveryNote: "Live delivery", specialInstructions: "Live special" })
      .where(eq(orders.bakeCycleId, scenario.cycleId));
    const view = await readyView(scenario.cycleId);
    expect(view.orders[0]).toMatchObject({ deliveryNote: "Snapshot delivery", specialInstructions: "Snapshot special" });
    expect(view.cancelledOrders[0]).toMatchObject({ deliveryNote: "Live delivery", specialInstructions: "Live special" });
  });

  it("coalesces missing packing progress to zero and reads a present row", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId: scenario.cycleId });
    await createOrderOperationsCommandService(context.db).startOrders(OWNER_ID, {
      cycleId: scenario.cycleId, orderIds: [scenario.orderIds[1]!],
    });
    const [item] = await context.db.select().from(orderItems)
      .where(eq(orderItems.orderId, scenario.orderIds[1]!));
    await context.db.insert(orderItemPackingProgress).values({
      ownerId: OWNER_ID,
      orderItemId: item!.id,
      packedQuantity: 3,
    });
    const view = await readyView(scenario.cycleId);
    expect(view.orders[0]?.items[0]?.packedQuantity).toBe(0);
    expect(view.orders[1]?.items[0]?.packedQuantity).toBe(3);
  });

  it("returns NO_ACTIVE_PLAN and LEGACY_PLAN distinctly", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const service = createOperationsQueryService(context.db, CLOCK);
    const noPlan = await service.getCycleOperations(OWNER_ID, scenario.cycleId);
    expect(noPlan).toMatchObject({ kind: "NO_GENERATION", reason: "NO_ACTIVE_PLAN" });

    const snapshotId = "60000000-0000-4000-8000-000000000101";
    await context.db.insert(cyclePlanningSnapshots).values({
      id: snapshotId,
      ownerId: OWNER_ID,
      bakeCycleId: scenario.cycleId,
      generation: 1,
      status: "ACTIVE",
      lockRequestId: "60000000-0000-4000-8000-000000000102",
      inputFingerprint: "a".repeat(64),
      cycleNumber: 7,
      cycleName: "Frozen legacy name",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
      laborRateSatangPerHour: 12_000,
      defaultWasteAllowancePercent: "3.0000",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt: CLOCK.now(),
    });
    await context.db.update(bakeCycles)
      .set({ activePlanningSnapshotId: snapshotId, status: "LOCKED" })
      .where(eq(bakeCycles.id, scenario.cycleId));
    const legacy = await service.getCycleOperations(OWNER_ID, scenario.cycleId);
    expect(legacy).toMatchObject({
      kind: "NO_GENERATION",
      reason: "LEGACY_PLAN",
      cycle: { name: "Frozen legacy name", cycleNumber: 7 },
    });
  });

  it("uses the same NOT_FOUND for unknown, cross-owner, and malformed IDs", async () => {
    const foreign = await seedPlanningScenario(context.db, {
      ownerId: OTHER_OWNER_ID,
      idSet: "SECONDARY",
    });
    const service = createOperationsQueryService(context.db, CLOCK);
    for (const [ownerId, cycleId] of [
      [OWNER_ID, MISSING_CYCLE_ID],
      [OWNER_ID, foreign.cycleId],
      ["bad-owner", foreign.cycleId],
      [OWNER_ID, "bad-cycle"],
    ]) {
      await expect(service.getCycleOperations(ownerId!, cycleId!)).rejects.toMatchObject({
        kind: "NOT_FOUND", message: "Operations cycle not found",
      });
    }
  });

  it("rejects a non-cancelled live order omitted from active snapshot", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    const [firstOrder] = await context.db.select().from(orders)
      .where(eq(orders.id, scenario.orderIds[0]!));
    await context.db.insert(orders).values({ ...firstOrder!,
      id: "60000000-0000-4000-8000-000000000199", fulfillmentStatus: "NEW",
    });
    await expect(createOperationsQueryService(context.db, CLOCK)
      .getCycleOperations(OWNER_ID, scenario.cycleId))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("rejects missing active item membership instead of silently dropping it", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await context.db.delete(cycleOrderItemSnapshots)
      .where(eq(cycleOrderItemSnapshots.sourceOrderId, scenario.orderIds[0]!));
    await expect(createOperationsQueryService(context.db, CLOCK)
      .getCycleOperations(OWNER_ID, scenario.cycleId))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("never includes historical task generations in the current workspace", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    const [oldGeneration] = await context.db.select().from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, scenario.planningSnapshotId));
    const [oldTask] = await context.db.select().from(cycleTasks)
      .where(eq(cycleTasks.cycleTaskGenerationId, oldGeneration!.id));
    await context.db.update(orders).set({ fulfillmentStatus: "CONFIRMED" })
      .where(eq(orders.id, scenario.orderIds[1]!));
    const planningClock = { now: () => new Date("2026-08-23T03:00:00.000Z") };
    const commands = createPlanningCommandService(context.db, planningClock);
    await commands.unlock(OWNER_ID, {
      cycleId: scenario.cycleId,
      reason: "Replan cycle",
      confirmation: "ปลดล็อก",
    });
    const preview = await createPlanningQueryService(context.db, planningClock)
      .preview(OWNER_ID, scenario.cycleId);
    const next = await commands.lock(OWNER_ID, {
      cycleId: scenario.cycleId,
      inputFingerprint: preview.inputFingerprint,
      lockRequestId: "60000000-0000-4000-8000-000000000145",
      overrides: [],
    });
    const view = await readyView(scenario.cycleId);
    expect(view.generation.planningSnapshotId).toBe(next.id);
    expect(view.tasks.map(({ id }) => id)).not.toContain(oldTask!.id);
    expect(view.tasks).toHaveLength(1);
  });

  it("sorts in-production switcher choices before locked ones and keeps a terminal selection", async () => {
    const first = await seedLockedPlanningScenario(context.db);
    const secondId = "60000000-0000-4000-8000-000000000121";
    await context.db.insert(bakeCycles).values({
      id: secondId,
      ownerId: OWNER_ID,
      name: "Second active cycle",
      status: "IN_PRODUCTION",
      targetProductionDate: "2026-08-28",
      primaryDeliveryDate: "2026-08-29",
    });
    let view = await readyView(first.cycleId);
    expect(view.cycleOptions.map(({ id }) => id)).toEqual([secondId, first.cycleId]);

    await finishOrders(first);
    await context.db.update(cycleTasks).set({ status: "DONE" });
    const [generation] = await context.db.select().from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, first.planningSnapshotId));
    await createCycleOperationsCommandService(context.db).completeCycle(OWNER_ID, {
      cycleId: first.cycleId, expectedTaskGenerationId: generation!.id, confirmation: true,
    });
    view = await readyView(first.cycleId);
    expect(view.cycle.status).toBe("COMPLETED");
    expect(view.cycleOptions.map(({ id }) => id)).toEqual([secondId, first.cycleId]);
  });

  it("keeps cancelled cycles selected as read-only with their frozen orders", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await context.db.update(bakeCycles).set({ status: "CANCELLED" })
      .where(eq(bakeCycles.id, scenario.cycleId));
    const view = await readyView(scenario.cycleId);
    expect(view.cycle.status).toBe("CANCELLED");
    expect(view.cycleOptions.map(({ id }) => id)).toEqual([scenario.cycleId]);
    expect(view.orders.map(({ id }) => id)).toEqual(scenario.orderIds.slice(0, 2));
    expect(view.cancelledOrders.map(({ id }) => id)).toEqual([scenario.orderIds[2]]);
  });

  it("sorts delivery times before untimed orders and buckets tasks by Bangkok day", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await context.db.update(cycleOrderSnapshots).set({ confirmedDeliveryTime: "09:30" })
      .where(eq(cycleOrderSnapshots.sourceOrderId, scenario.orderIds[1]!));
    const [generation] = await context.db.select().from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, scenario.planningSnapshotId));
    const [original] = await context.db.select().from(cycleTasks)
      .where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
    await context.db.update(cycleTasks).set({ scheduledAt: new Date("2026-08-28T04:00:00.000Z") })
      .where(eq(cycleTasks.id, original!.id));
    await context.db.insert(cycleTasks).values([
      { id: "60000000-0000-4000-8000-000000000111", ownerId: OWNER_ID,
        cycleTaskGenerationId: generation!.id, origin: "MANUAL", creationRequestId: "60000000-0000-4000-8000-000000000112",
        title: "Today", scheduledAt: new Date("2026-08-29T02:00:00.000Z"), estimatedDurationMinutes: 10, sequence: 2 },
      { id: "60000000-0000-4000-8000-000000000113", ownerId: OWNER_ID,
        cycleTaskGenerationId: generation!.id, origin: "MANUAL", creationRequestId: "60000000-0000-4000-8000-000000000114",
        title: "Future", scheduledAt: new Date("2026-08-30T02:00:00.000Z"), estimatedDurationMinutes: 10, sequence: 3 },
    ]);
    const view = await readyView(scenario.cycleId);
    expect(view.orders.map(({ id }) => id)).toEqual([scenario.orderIds[1], scenario.orderIds[0]]);
    expect(view.taskBuckets.overdue.map(({ id }) => id)).toEqual([original!.id]);
    expect(view.taskBuckets.today.map(({ title }) => title)).toEqual(["Today"]);
    expect(view.taskBuckets.future.map(({ title }) => title)).toEqual(["Future"]);
  });

  it("returns completion-ready despite partial payment and includes its warning totals", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    await context.db.update(cycleTasks).set({ status: "DONE" });
    await finishOrders(scenario);
    await context.db.update(orders).set({ paymentStatus: "PARTIAL", amountPaidSatang: 1000 })
      .where(eq(orders.id, scenario.orderIds[1]!));
    const view = await readyView(scenario.cycleId);
    expect(view.completion).toEqual({ ready: true, remainingTaskCount: 0,
      remainingOrderCount: 0, unpaidOrderCount: 1, outstandingSatang: 64_000 });
  });
});
