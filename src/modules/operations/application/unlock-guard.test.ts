import { eq } from "drizzle-orm";
import { confirmConsumptionStock } from "@tests/fixtures/consumption";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario, seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { orderItems } from "@/modules/orders/db/schema";
import { createCycleOperationsCommandService } from "./cycle-commands";
import { createOrderOperationsCommandService } from "./order-commands";
import { assertCycleOperationsUnlockAllowed } from "./unlock-guard";

describe("operations unlock guard", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());

  it.each(["IN_PRODUCTION", "PACKED", "DELIVERED"] as const)(
    "blocks unlock after an order reaches %s",
    async (status) => {
      const scenario = await seedLockedPlanningScenario(context.db);
      const orderId = scenario.orderIds[1]!;
      const cycles = createCycleOperationsCommandService(context.db);
      const orderCommands = createOrderOperationsCommandService(context.db);
      await confirmConsumptionStock(context.db, OWNER_ID, scenario.cycleId);
      await cycles.startCycle(OWNER_ID, { cycleId: scenario.cycleId });
      await orderCommands.startOrders(OWNER_ID, { cycleId: scenario.cycleId, orderIds: [orderId] });
      if (status === "PACKED" || status === "DELIVERED") {
        const [item] = await context.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        await orderCommands.setPackedQuantity(OWNER_ID, {
          cycleId: scenario.cycleId, orderItemId: item!.id,
          packedQuantity: item!.quantity, expectedPackedQuantity: 0,
        });
        await orderCommands.confirmOrderPacked(OWNER_ID, { cycleId: scenario.cycleId, orderId });
      }
      if (status === "DELIVERED") {
        await orderCommands.deliverOrders(OWNER_ID, { cycleId: scenario.cycleId, orderIds: [orderId] });
      }

      await expect(assertCycleOperationsUnlockAllowed(context.db, OWNER_ID, scenario.cycleId))
        .rejects.toMatchObject({ kind: "UNLOCK_BLOCKED_BY_OPERATIONS", message: "Cycle operations have started" });
    },
  );

  it("allows a cycle whose orders are only new, confirmed, or cancelled", async () => {
    const scenario = await seedPlanningScenario(context.db);
    await expect(assertCycleOperationsUnlockAllowed(context.db, OWNER_ID, scenario.cycleId))
      .resolves.toBeUndefined();
  });

  it("blocks after positive Packing progress and ignores another owner's operational rows", async () => {
    const own = await seedPlanningScenario(context.db);
    const foreign = await seedLockedPlanningScenario(context.db, {
      ownerId: OTHER_OWNER_ID, idSet: "SECONDARY",
    });
    await confirmConsumptionStock(context.db, OTHER_OWNER_ID, foreign.cycleId);
    await createCycleOperationsCommandService(context.db).startCycle(
      OTHER_OWNER_ID, { cycleId: foreign.cycleId },
    );
    const commands = createOrderOperationsCommandService(context.db);
    await commands.startOrders(OTHER_OWNER_ID, {
      cycleId: foreign.cycleId, orderIds: [foreign.orderIds[0]!],
    });
    const [item] = await context.db.select().from(orderItems)
      .where(eq(orderItems.orderId, foreign.orderIds[0]!));
    await commands.setPackedQuantity(OTHER_OWNER_ID, {
      cycleId: foreign.cycleId, orderItemId: item!.id,
      packedQuantity: 1, expectedPackedQuantity: 0,
    });
    await expect(assertCycleOperationsUnlockAllowed(context.db, OTHER_OWNER_ID, foreign.cycleId))
      .rejects.toMatchObject({ kind: "UNLOCK_BLOCKED_BY_OPERATIONS" });
    await expect(assertCycleOperationsUnlockAllowed(context.db, OWNER_ID, own.cycleId))
      .resolves.toBeUndefined();
  });
});
