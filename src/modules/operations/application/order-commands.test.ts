import { and, eq } from "drizzle-orm";
import { confirmConsumptionStock } from "@tests/fixtures/consumption";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createCycleService } from "@/modules/cycles/application/cycles";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { orderItemPackingProgress } from "@/modules/operations/db/schema";
import { cycleOrderItemSnapshots, cycleOrderSnapshots, cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { createOrderOperationsCommandService } from "./order-commands";
import { createCycleOperationsCommandService } from "./cycle-commands";
import { createOperationsQueryService } from "./operations-queries";

const MISSING_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const NEW_ORDER_ID = "01000000-0000-4000-8000-000000000301";
const NEW_ITEM_ID = "60000000-0000-4000-8000-000000000302";
const OTHER_CYCLE_ID = "60000000-0000-4000-8000-000000000303";
const OTHER_CYCLE_ORDER_ID = "60000000-0000-4000-8000-000000000304";
const CLOCK = { now: () => new Date("2026-08-29T05:00:00.000Z") };
const PLANNING_CLOCK = { now: () => new Date("2026-08-23T03:00:00.000Z") };

describe("order operations commands", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  async function scenario() {
    const value = await seedLockedPlanningScenario(context.db);
    const [firstItem] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, value.orderIds[0]!));
    const [secondItem] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, value.orderIds[1]!));
    return { ...value, firstItem: firstItem!, secondItem: secondItem! };
  }

  async function scenarioWithNewOrder() {
    const source = await seedPlanningScenario(context.db);
    const [firstOrder] = await context.db.select().from(orders).where(eq(orders.id, source.orderIds[0]!));
    const [firstItem] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, source.orderIds[0]!));
    await context.db.insert(orders).values({
      ...firstOrder!, id: NEW_ORDER_ID, fulfillmentStatus: "NEW",
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    await context.db.insert(orderItems).values({
      ...firstItem!, id: NEW_ITEM_ID, orderId: NEW_ORDER_ID,
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    const preview = await createPlanningQueryService(context.db, PLANNING_CLOCK)
      .preview(OWNER_ID, source.cycleId);
    await createPlanningCommandService(context.db, PLANNING_CLOCK).lock(OWNER_ID, {
      cycleId: source.cycleId,
      lockRequestId: "60000000-0000-4000-8000-000000000305",
      inputFingerprint: preview.inputFingerprint,
      overrides: [],
    });
    return source;
  }

  async function status(orderId: string) {
    const [row] = await context.db.select().from(orders).where(eq(orders.id, orderId));
    return row!.fulfillmentStatus;
  }

  async function inProduction(cycleId: string) {
    await confirmConsumptionStock(context.db, OWNER_ID, cycleId);
    await createCycleOperationsCommandService(context.db).startCycle(OWNER_ID, { cycleId });
    const [secondOrder] = await context.db.select({ id: orders.id }).from(orders).where(and(
      eq(orders.ownerId, OWNER_ID), eq(orders.bakeCycleId, cycleId), eq(orders.sourceChannel, "PHONE"),
    ));
    await createOrderOperationsCommandService(context.db).startOrders(OWNER_ID, {
      cycleId, orderIds: [secondOrder!.id],
    });
  }

  it("normalizes duplicate batch IDs, confirms, and starts exact retries", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await commands.confirmOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!, s.orderIds[0]!] });
    expect(await status(s.orderIds[0]!)).toBe("CONFIRMED");
    await inProduction(s.cycleId);
    const input = { cycleId: s.cycleId, orderIds: [s.orderIds[1]!, s.orderIds[0]!, s.orderIds[0]!] };
    await commands.startOrders(OWNER_ID, input);
    await commands.startOrders(OWNER_ID, input);
    expect(await Promise.all(s.orderIds.slice(0, 2).map(status))).toEqual(["IN_PRODUCTION", "IN_PRODUCTION"]);
  });

  it("confirms a snapshotted NEW Order in a normalized batch and accepts a full target retry", async () => {
    const s = await scenarioWithNewOrder();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    const input = { cycleId: s.cycleId, orderIds: [s.orderIds[0]!, NEW_ORDER_ID, NEW_ORDER_ID] };
    expect((await commands.confirmOrders(OWNER_ID, input)).map((row) => [row.id, row.fulfillmentStatus]))
      .toEqual([[NEW_ORDER_ID, "CONFIRMED"], [s.orderIds[0]!, "CONFIRMED"]]);
    await commands.confirmOrders(OWNER_ID, input);
    expect(await status(NEW_ORDER_ID)).toBe("CONFIRMED");
  });

  it("rolls back mixed confirmation after the valid NEW Order sorts before the invalid Order", async () => {
    const s = await scenarioWithNewOrder();
    await inProduction(s.cycleId);
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await expect(commands.confirmOrders(OWNER_ID, {
      cycleId: s.cycleId, orderIds: [s.orderIds[1]!, NEW_ORDER_ID],
    })).rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    expect(await status(NEW_ORDER_ID)).toBe("NEW");
    expect(await status(s.orderIds[1]!)).toBe("IN_PRODUCTION");
  });

  it("rolls back a batch if a member has the wrong state or is cancelled", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await inProduction(s.cycleId);
    await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: s.secondItem.quantity, expectedPackedQuantity: 0 });
    await commands.confirmOrderPacked(OWNER_ID, { cycleId: s.cycleId, orderId: s.orderIds[1]! });
    await expect(commands.startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!, s.orderIds[1]!] }))
      .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    expect(await status(s.orderIds[0]!)).toBe("CONFIRMED");
    await expect(commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[1]!, s.orderIds[2]!] }))
      .rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect(await status(s.orderIds[1]!)).toBe("PACKED");
  });

  it("requires the current active snapshot and task generation", async () => {
    const s = await seedPlanningScenario(context.db);
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    const snapshotId = "60000000-0000-4000-8000-000000000201";
    await context.db.insert(cyclePlanningSnapshots).values({
      id: snapshotId, ownerId: OWNER_ID, bakeCycleId: s.cycleId,
      generation: 1, status: "ACTIVE", lockRequestId: "60000000-0000-4000-8000-000000000202",
      inputFingerprint: "a".repeat(64), cycleNumber: 7, cycleName: "Legacy plan",
      targetProductionDate: "2026-08-29", primaryDeliveryDate: "2026-08-30",
      laborRateSatangPerHour: 12_000, defaultWasteAllowancePercent: "3.0000",
      timezone: "Asia/Bangkok", currency: "THB", costComplete: true, lockedAt: CLOCK.now(),
    });
    await context.db.update(bakeCycles).set({ activePlanningSnapshotId: snapshotId, status: "LOCKED" })
      .where(eq(bakeCycles.id, s.cycleId));
    await expect(commands.confirmOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!] }))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("rejects stale or absent frozen order membership and non-discloses foreign IDs", async () => {
    const s = await scenario();
    const foreign = await seedLockedPlanningScenario(context.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await context.db.delete(cycleOrderItemSnapshots).where(eq(cycleOrderItemSnapshots.sourceOrderId, s.orderIds[0]!));
    await context.db.delete(cycleOrderSnapshots).where(and(eq(cycleOrderSnapshots.planningSnapshotId, s.planningSnapshotId), eq(cycleOrderSnapshots.sourceOrderId, s.orderIds[0]!)));
    await expect(commands.confirmOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!] }))
      .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
    for (const orderId of [foreign.orderIds[0]!, MISSING_ID]) {
      await expect(commands.confirmOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [orderId] }))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
    }
  });

  it("non-discloses a real same-owner Order in a different Cycle", async () => {
    const s = await scenario();
    const [firstOrder] = await context.db.select().from(orders).where(eq(orders.id, s.orderIds[0]!));
    await context.db.insert(bakeCycles).values({
      id: OTHER_CYCLE_ID, ownerId: OWNER_ID, name: "Other Cycle", status: "OPEN",
      targetProductionDate: "2026-09-01", primaryDeliveryDate: "2026-09-02",
    });
    await context.db.insert(orders).values({
      ...firstOrder!, id: OTHER_CYCLE_ORDER_ID, bakeCycleId: OTHER_CYCLE_ID,
      fulfillmentStatus: "NEW",
    });
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    for (const orderId of [OTHER_CYCLE_ORDER_ID, MISSING_ID]) {
      await expect(commands.confirmOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [orderId] }))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
    }
  });

  it("rejects a command against a Cycle cancelled after the Operations UI read", async () => {
    const s = await scenario();
    expect((await createOperationsQueryService(context.db, CLOCK)
      .getCycleOperations(OWNER_ID, s.cycleId)).kind).toBe("READY");
    await createCycleService(context.db).changeStatus(OWNER_ID, s.cycleId, "CANCELLED");
    await expect(createOrderOperationsCommandService(context.db, CLOCK).confirmOrders(OWNER_ID, {
      cycleId: s.cycleId, orderIds: [s.orderIds[0]!],
    })).rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
    expect(await status(s.orderIds[0]!)).toBe("CONFIRMED");
  });

  it("rejects a batch when an active item is absent from its frozen order", async () => {
    const s = await scenario();
    await context.db.delete(cycleOrderItemSnapshots)
      .where(eq(cycleOrderItemSnapshots.sourceOrderItemId, s.firstItem.id));
    await expect(createOrderOperationsCommandService(context.db, CLOCK)
      .confirmOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!] }))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
    expect(await status(s.orderIds[0]!)).toBe("CONFIRMED");
  });

  it("rolls back a delivery batch when one snapshotted order is not PACKED", async () => {
    const s = await scenario();
    await inProduction(s.cycleId);
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: s.secondItem.quantity, expectedPackedQuantity: 0 });
    await commands.confirmOrderPacked(OWNER_ID, { cycleId: s.cycleId, orderId: s.orderIds[1]! });
    await expect(commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!, s.orderIds[1]!] }))
      .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    expect(await status(s.orderIds[1]!)).toBe("PACKED");
  });

  it("delivers two fully packed Orders atomically and accepts the same full batch retry", async () => {
    const s = await scenario();
    await inProduction(s.cycleId);
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await commands.startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [s.orderIds[0]!] });
    for (const item of [s.firstItem, s.secondItem]) {
      await commands.setPackedQuantity(OWNER_ID, {
        cycleId: s.cycleId, orderItemId: item.id,
        packedQuantity: item.quantity, expectedPackedQuantity: 0,
      });
      await commands.confirmOrderPacked(OWNER_ID, { cycleId: s.cycleId, orderId: item.orderId });
    }
    const input = { cycleId: s.cycleId, orderIds: [s.orderIds[1]!, s.orderIds[0]!] };
    expect((await commands.deliverOrders(OWNER_ID, input)).map((row) => [row.id, row.fulfillmentStatus]))
      .toEqual([[s.orderIds[0]!, "DELIVERED"], [s.orderIds[1]!, "DELIVERED"]]);
    await commands.deliverOrders(OWNER_ID, input);
    expect(await Promise.all(s.orderIds.slice(0, 2).map(status)))
      .toEqual(["DELIVERED", "DELIVERED"]);
  });

  it("serializes missing packing progress as zero, sets absolute target, and permits exact retry", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await inProduction(s.cycleId);
    const input = { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: 3, expectedPackedQuantity: 0 };
    expect(await commands.setPackedQuantity(OWNER_ID, input)).toMatchObject({ packedQuantity: 3 });
    expect(await commands.setPackedQuantity(OWNER_ID, input)).toMatchObject({ packedQuantity: 3 });
    const rows = await context.db.select().from(orderItemPackingProgress).where(eq(orderItemPackingProgress.orderItemId, s.secondItem.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedAt).toEqual(CLOCK.now());
    await expect(commands.setPackedQuantity(OWNER_ID, { ...input, packedQuantity: 1 }))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("checks quantity bounds before an exact retry and rejects inactive or non-snapshotted items", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await inProduction(s.cycleId);
    const base = { cycleId: s.cycleId, orderItemId: s.secondItem.id, expectedPackedQuantity: 0 };
    await expect(commands.setPackedQuantity(OWNER_ID, { ...base, packedQuantity: -1 }))
      .rejects.toMatchObject({ kind: "PACKED_QUANTITY_OUT_OF_RANGE" });
    await expect(commands.setPackedQuantity(OWNER_ID, { ...base, packedQuantity: s.secondItem.quantity + 1 }))
      .rejects.toMatchObject({ kind: "PACKED_QUANTITY_OUT_OF_RANGE" });
    await context.db.delete(cycleOrderItemSnapshots).where(eq(cycleOrderItemSnapshots.sourceOrderItemId, s.secondItem.id));
    await expect(commands.setPackedQuantity(OWNER_ID, { ...base, packedQuantity: 1 }))
      .rejects.toMatchObject({ kind: "NOT_FOUND" });
    await context.db.update(orderItems).set({ active: false }).where(eq(orderItems.id, s.secondItem.id));
    await expect(commands.setPackedQuantity(OWNER_ID, { ...base, packedQuantity: 1 }))
      .rejects.toMatchObject({ kind: "NOT_FOUND" });
  });

  it("requires exact packing, then supports reopen and delivery with terminal immutability", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    await inProduction(s.cycleId);
    const order = { cycleId: s.cycleId, orderId: s.secondItem.orderId };
    await expect(commands.confirmOrderPacked(OWNER_ID, order)).rejects.toMatchObject({ kind: "PACKING_INCOMPLETE" });
    await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: s.secondItem.quantity, expectedPackedQuantity: 0 });
    await commands.confirmOrderPacked(OWNER_ID, order);
    await commands.confirmOrderPacked(OWNER_ID, order);
    await expect(commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: 1, expectedPackedQuantity: s.secondItem.quantity }))
      .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    await commands.reopenOrderPacking(OWNER_ID, order);
    await commands.reopenOrderPacking(OWNER_ID, order);
    await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: 1, expectedPackedQuantity: s.secondItem.quantity });
    await expect(commands.confirmOrderPacked(OWNER_ID, order)).rejects.toMatchObject({ kind: "PACKING_INCOMPLETE" });
    await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: s.secondItem.quantity, expectedPackedQuantity: 1 });
    await commands.confirmOrderPacked(OWNER_ID, order);
    await commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [order.orderId] });
    await commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: [order.orderId] });
    await expect(commands.reopenOrderPacking(OWNER_ID, order)).rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    await expect(commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: s.secondItem.id, packedQuantity: s.secondItem.quantity, expectedPackedQuantity: 0 }))
      .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
  });

  it("rejects packing while Cycle is locked and does not disclose unknown/foreign item IDs", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    const base = { cycleId: s.cycleId, packedQuantity: 1, expectedPackedQuantity: 0 };
    await expect(commands.setPackedQuantity(OWNER_ID, { ...base, orderItemId: s.secondItem.id }))
      .rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
    await inProduction(s.cycleId);
    const foreign = await seedLockedPlanningScenario(context.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const [foreignItem] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, foreign.orderIds[1]!));
    for (const orderItemId of [MISSING_ID, foreignItem!.id]) {
      await expect(commands.setPackedQuantity(OWNER_ID, { ...base, orderItemId }))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
    }
  });
});
