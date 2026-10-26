import { eq } from "drizzle-orm";
import { confirmConsumptionStock } from "@tests/fixtures/consumption";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import { createCycleOperationsCommandService } from "./cycle-commands";
import { createOrderOperationsCommandService } from "./order-commands";
import { createPaymentOperationsCommandService } from "./payment-commands";

const MISSING_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const CLOCK = { now: () => new Date("2026-08-29T05:00:00.000Z") };

describe("payment operations commands", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  async function scenario() {
    const value = await seedLockedPlanningScenario(context.db);
    const orderId = value.orderIds[0]!;
    await context.db.update(orders).set({ amountPaidSatang: 0, paymentStatus: "UNPAID" }).where(eq(orders.id, orderId));
    return { ...value, orderId };
  }

  async function paid(orderId: string) {
    const [row] = await context.db.select().from(orders).where(eq(orders.id, orderId));
    return { amountPaidSatang: row!.amountPaidSatang, paymentStatus: row!.paymentStatus, updatedAt: row!.updatedAt };
  }

  it("sets an absolute cumulative target, derives PARTIAL, and preserves an exact retry", async () => {
    const s = await scenario();
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    const input = { orderId: s.orderId, targetAmountPaidSatang: 20_000, expectedAmountPaidSatang: 0 };
    expect(await payment.setOrderAmountPaid(OWNER_ID, input)).toMatchObject({
      orderId: s.orderId, amountPaidSatang: 20_000, grandTotalSatang: 65_000,
      balanceSatang: 45_000, paymentStatus: "PARTIAL",
    });
    expect(await payment.setOrderAmountPaid(OWNER_ID, input)).toMatchObject({ amountPaidSatang: 20_000 });
    expect(await paid(s.orderId)).toMatchObject({ amountPaidSatang: 20_000, paymentStatus: "PARTIAL", updatedAt: CLOCK.now() });
    await expect(payment.setOrderAmountPaid(OWNER_ID, { ...input, targetAmountPaidSatang: 30_000 }))
      .rejects.toMatchObject({ kind: "STALE_DATA" });
  });

  it("permits a zero correction and exact full payment but rejects one satang over", async () => {
    const s = await scenario();
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    await payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 20_000, expectedAmountPaidSatang: 0 });
    expect(await payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 0, expectedAmountPaidSatang: 20_000 }))
      .toMatchObject({ amountPaidSatang: 0, balanceSatang: 65_000, paymentStatus: "UNPAID" });
    expect(await payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 65_000, expectedAmountPaidSatang: 0 }))
      .toMatchObject({ amountPaidSatang: 65_000, balanceSatang: 0, paymentStatus: "PAID" });
    await expect(payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 65_001, expectedAmountPaidSatang: 65_000 }))
      .rejects.toMatchObject({ kind: "PAYMENT_OUT_OF_RANGE" });
    expect(await paid(s.orderId)).toMatchObject({ amountPaidSatang: 65_000, paymentStatus: "PAID" });
  });

  it("rejects malformed, negative, fractional, and unsafe cumulative inputs", async () => {
    const s = await scenario();
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    for (const targetAmountPaidSatang of [-1, 1.5, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang, expectedAmountPaidSatang: 0 }))
        .rejects.toMatchObject({ kind: "PAYMENT_OUT_OF_RANGE" });
    }
    expect(await paid(s.orderId)).toMatchObject({ amountPaidSatang: 0, paymentStatus: "UNPAID" });
  });

  it("uses the live active-item total and rejects a safe-integer overflow", async () => {
    const s = await scenario();
    const [item] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, s.orderId));
    await context.db.update(orderItems).set({ quantity: 2_147_483_647, unitPriceSatang: 2_147_483_647 })
      .where(eq(orderItems.id, item!.id));
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    await expect(payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 1, expectedAmountPaidSatang: 0 }))
      .rejects.toMatchObject({ kind: "PAYMENT_OUT_OF_RANGE" });
  });

  it("keeps refunded and cancelled records read-only, including exact-value retries", async () => {
    const s = await scenario();
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    const cancelledId = s.orderIds[2]!;
    for (const input of [
      { orderId: cancelledId, targetAmountPaidSatang: 0, expectedAmountPaidSatang: 0 },
      { orderId: cancelledId, targetAmountPaidSatang: 1, expectedAmountPaidSatang: 0 },
    ]) {
      await expect(payment.setOrderAmountPaid(OWNER_ID, input)).rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    }
    await context.db.update(orders).set({ paymentStatus: "REFUNDED" }).where(eq(orders.id, s.orderId));
    await expect(payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 0, expectedAmountPaidSatang: 0 }))
      .rejects.toMatchObject({ kind: "INVALID_ORDER_STATE" });
    await context.db.update(orders).set({ paymentStatus: "UNPAID" }).where(eq(orders.id, s.orderId));
    await context.db.update(bakeCycles).set({ status: "CANCELLED" }).where(eq(bakeCycles.id, s.cycleId));
    await expect(payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 0, expectedAmountPaidSatang: 0 }))
      .rejects.toMatchObject({ kind: "INVALID_CYCLE_STATE" });
  });

  it("accepts payment after delivery and cycle completion", async () => {
    const s = await scenario();
    const commands = createOrderOperationsCommandService(context.db, CLOCK);
    const cycles = createCycleOperationsCommandService(context.db, CLOCK);
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    await confirmConsumptionStock(context.db, OWNER_ID, s.cycleId);
    await cycles.startCycle(OWNER_ID, { cycleId: s.cycleId });
    await commands.startOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: s.orderIds.slice(0, 2) });
    for (const orderId of s.orderIds.slice(0, 2)) {
      const [item] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, orderId!));
      await commands.setPackedQuantity(OWNER_ID, { cycleId: s.cycleId, orderItemId: item!.id, packedQuantity: item!.quantity, expectedPackedQuantity: 0 });
      await commands.confirmOrderPacked(OWNER_ID, { cycleId: s.cycleId, orderId: orderId! });
    }
    await commands.deliverOrders(OWNER_ID, { cycleId: s.cycleId, orderIds: s.orderIds.slice(0, 2) });
    expect(await payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 20_000, expectedAmountPaidSatang: 0 }))
      .toMatchObject({ amountPaidSatang: 20_000 });
    const [generation] = await context.db.select().from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, s.planningSnapshotId));
    await context.db.update(cycleTasks).set({ status: "DONE" }).where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
    await cycles.completeCycle(OWNER_ID, { cycleId: s.cycleId, expectedTaskGenerationId: generation!.id, confirmation: true });
    expect(await payment.setOrderAmountPaid(OWNER_ID, { orderId: s.orderId, targetAmountPaidSatang: 65_000, expectedAmountPaidSatang: 20_000 }))
      .toMatchObject({ amountPaidSatang: 65_000, paymentStatus: "PAID" });
  });

  it("does not disclose unknown or cross-owner order IDs", async () => {
    await scenario();
    const foreign = await seedLockedPlanningScenario(context.db, { ownerId: OTHER_OWNER_ID, idSet: "SECONDARY" });
    const payment = createPaymentOperationsCommandService(context.db, CLOCK);
    for (const orderId of [MISSING_ID, foreign.orderIds[0]!]) {
      await expect(payment.setOrderAmountPaid(OWNER_ID, { orderId, targetAmountPaidSatang: 0, expectedAmountPaidSatang: 0 }))
        .rejects.toMatchObject({ kind: "NOT_FOUND", message: "Operations record not found" });
    }
  });
});
