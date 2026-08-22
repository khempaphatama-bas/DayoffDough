import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { products } from "@/modules/products/db/schema";

describe("Phase 2 order schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("stores a valid owner-scoped multi-item order", async () => {
    const [method] = await context.db.insert(deliveryMethods).values({
      ownerId: OWNER_ID,
      name: "KEX Same Day",
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
      requiresDeliveryLocation: true,
    }).returning();
    const [product] = await context.db.insert(products).values({
      ownerId: OWNER_ID,
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    }).returning();
    const [customer] = await context.db.insert(customers).values({
      ownerId: OWNER_ID,
      name: "May",
      defaultDeliveryMethodId: method!.id,
    }).returning();
    const [cycle] = await context.db.insert(bakeCycles).values({
      ownerId: OWNER_ID,
      name: "รอบส่ง 30 ส.ค.",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    }).returning();
    const [order] = await context.db.insert(orders).values({
      ownerId: OWNER_ID,
      customerId: customer!.id,
      bakeCycleId: cycle!.id,
      deliveryMethodId: method!.id,
    }).returning();
    await context.db.insert(orderItems).values({
      ownerId: OWNER_ID,
      orderId: order!.id,
      productId: product!.id,
      quantity: 2,
      unitPriceSatang: 22000,
    });

    expect(cycle!.cycleNumber).toBeGreaterThan(0);
  });

  it("rejects zero item quantity and cross-owner relationships", async () => {
    const [method] = await context.db.insert(deliveryMethods).values({
      ownerId: OWNER_ID,
      name: "Pickup",
      defaultCustomerFeeSatang: 0,
      defaultInternalCostSatang: 0,
    }).returning();
    const [foreignCustomer] = await context.db.insert(customers).values({
      ownerId: OTHER_OWNER_ID,
      name: "Other owner customer",
    }).returning();
    const [customer] = await context.db.insert(customers).values({
      ownerId: OWNER_ID,
      name: "Owner customer",
    }).returning();
    const [product] = await context.db.insert(products).values({
      ownerId: OWNER_ID,
      name: "Scone",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 8000,
    }).returning();
    const [cycle] = await context.db.insert(bakeCycles).values({
      ownerId: OWNER_ID,
      name: "Owner cycle",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    }).returning();

    await expect(context.db.insert(orders).values({
      ownerId: OWNER_ID,
      customerId: foreignCustomer!.id,
      bakeCycleId: cycle!.id,
    })).rejects.toThrow();

    const [order] = await context.db.insert(orders).values({
      ownerId: OWNER_ID,
      customerId: customer!.id,
      bakeCycleId: cycle!.id,
    }).returning();

    await expect(context.db.insert(orderItems).values({
      ownerId: OWNER_ID,
      orderId: order!.id,
      productId: product!.id,
      quantity: 0,
      unitPriceSatang: 8000,
    })).rejects.toThrow();
    expect(method!.requiresDeliveryLocation).toBe(true);
  });
});
