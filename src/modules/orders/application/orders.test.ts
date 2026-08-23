import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "drizzle-orm/logger";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { products } from "@/modules/products/db/schema";
import { createOrderService, type OrderInput } from "./orders";

async function seedMasters(
  db: DatabaseClient,
  ownerId = OWNER_ID,
  suffix = "",
) {
  const [method] = await db
    .insert(deliveryMethods)
    .values({
      ownerId,
      name: `KEX Same Day${suffix}`,
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
      requiresDeliveryLocation: true,
    })
    .returning();
  const [focaccia] = await db
    .insert(products)
    .values({
      ownerId,
      name: `Focaccia${suffix}`,
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    })
    .returning();
  const [scone] = await db
    .insert(products)
    .values({
      ownerId,
      name: `Scone${suffix}`,
      sellingUnit: "piece",
      defaultUnitPriceSatang: 8000,
    })
    .returning();
  const [customer] = await db
    .insert(customers)
    .values({
      ownerId,
      name: `คุณเมย์${suffix}`,
      contactHandle: `@may${suffix}`,
      phone: "0812345678",
      defaultDeliveryMethodId: method!.id,
      defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
      defaultDeliveryNote: "โทรก่อนส่ง",
    })
    .returning();
  const [cycle] = await db
    .insert(bakeCycles)
    .values({
      ownerId,
      name: `รอบส่ง 30 ส.ค.${suffix}`,
      status: "OPEN",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    })
    .returning();

  return {
    method: method!,
    focaccia: focaccia!,
    scone: scone!,
    customer: customer!,
    cycle: cycle!,
  };
}

function orderInput(
  masters: Awaited<ReturnType<typeof seedMasters>>,
  overrides: Partial<OrderInput> = {},
): OrderInput {
  return {
    customerId: masters.customer.id,
    bakeCycleId: masters.cycle.id,
    sourceChannel: "INSTAGRAM",
    requestedDeliveryDate: "2026-08-30",
    confirmedDeliveryDate: "2026-08-30",
    deliveryMethodId: masters.method.id,
    deliveryFeeChargedSatang: 12000,
    deliveryCostSatang: 12000,
    deliveryFeePayer: "CUSTOMER",
    discountSatang: 2000,
    amountPaidSatang: 20000,
    deliveryLocation: "บางรัก กรุงเทพฯ",
    deliveryNote: "โทรก่อนส่ง",
    specialInstructions: "แยกถุง",
    items: [
      {
        productId: masters.focaccia.id,
        quantity: 2,
        unitPriceSatang: 22000,
        lineNote: "",
      },
      {
        productId: masters.scone.id,
        quantity: 1,
        unitPriceSatang: 8000,
        lineNote: "ไม่อุ่น",
      },
    ],
    ...overrides,
  };
}

describe("order service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createOrderService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createOrderService(context.db);
  });

  afterEach(async () => context.close());

  it("locks the owned cycle before create and rejects after cancellation", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query);
        },
      } satisfies Logger,
    });
    service = createOrderService(context.db);
    const masters = await seedMasters(context.db);

    queries.length = 0;
    await service.create(OWNER_ID, orderInput(masters));
    expect(
      queries.some(
        (query) =>
          query.includes('from "bake_cycles"') &&
          query.toLowerCase().includes("for update"),
      ),
    ).toBe(true);

    await context.db
      .update(bakeCycles)
      .set({ status: "CANCELLED" })
      .where(
        and(
          eq(bakeCycles.ownerId, OWNER_ID),
          eq(bakeCycles.id, masters.cycle.id),
        ),
      );
    await expect(
      service.create(OWNER_ID, orderInput(masters)),
    ).rejects.toThrow("Cancelled cycle cannot accept orders");
  });

  it("serializes payment-state mutations with an order lock and compare-and-swap", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query);
        },
      } satisfies Logger,
    });
    service = createOrderService(context.db);
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));

    async function expectSerializedPaymentMutation(
      mutate: () => Promise<unknown>,
    ) {
      queries.length = 0;
      await mutate();
      expect(
        queries.some(
          (query) =>
            query.includes('from "orders"') &&
            query.toLowerCase().includes("for update"),
        ),
      ).toBe(true);
      const updateQuery = queries.find((query) =>
        query.toLowerCase().startsWith('update "orders"'),
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery!.slice(updateQuery!.toLowerCase().indexOf(" where ")))
        .toContain('"orders"."payment_status"');
    }

    await expectSerializedPaymentMutation(() =>
      service.markRefunded(OWNER_ID, created.id),
    );
    await expectSerializedPaymentMutation(() =>
      service.update(
        OWNER_ID,
        created.id,
        orderInput(masters, { amountPaidSatang: 62000 }),
      ),
    );
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      paymentStatus: "REFUNDED",
      amountPaidSatang: 62000,
    });
    await expectSerializedPaymentMutation(() =>
      service.restorePaymentTracking(OWNER_ID, created.id),
    );
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      paymentStatus: "PAID",
      amountPaidSatang: 62000,
    });
  });

  it("creates a multi-item order and keeps copied commercial values historical", async () => {
    const masters = await seedMasters(context.db);

    const created = await service.create(OWNER_ID, orderInput(masters));

    expect(created.totals).toEqual({
      subtotalSatang: 52000,
      grandTotalSatang: 62000,
      balanceSatang: 42000,
      overpaidSatang: 0,
      paymentStatus: "PARTIAL",
    });
    expect(created.paymentStatus).toBe("PARTIAL");
    expect(created.items).toHaveLength(2);

    await context.db
      .update(products)
      .set({ defaultUnitPriceSatang: 99000 })
      .where(
        and(
          eq(products.ownerId, OWNER_ID),
          eq(products.id, masters.focaccia.id),
        ),
      );
    await context.db
      .update(customers)
      .set({
        defaultDeliveryLocation: "เชียงใหม่",
        defaultDeliveryNote: "ฝากไว้หน้าบ้าน",
      })
      .where(
        and(
          eq(customers.ownerId, OWNER_ID),
          eq(customers.id, masters.customer.id),
        ),
      );
    await context.db
      .update(deliveryMethods)
      .set({
        defaultCustomerFeeSatang: 50000,
        defaultInternalCostSatang: 45000,
      })
      .where(
        and(
          eq(deliveryMethods.ownerId, OWNER_ID),
          eq(deliveryMethods.id, masters.method.id),
        ),
      );

    const fetched = await service.get(OWNER_ID, created.id);
    expect(
      Object.fromEntries(
        fetched.items.map((item) => [item.productId, item.unitPriceSatang]),
      ),
    ).toEqual({
      [masters.focaccia.id]: 22000,
      [masters.scone.id]: 8000,
    });
    expect(fetched).toMatchObject({
      deliveryLocation: "บางรัก กรุงเทพฯ",
      deliveryNote: "โทรก่อนส่ง",
      deliveryFeeChargedSatang: 12000,
      deliveryCostSatang: 12000,
    });
  });

  it("replaces every item when an update succeeds", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));

    const updated = await service.update(
      OWNER_ID,
      created.id,
      orderInput(masters, {
        discountSatang: 5000,
        items: [
          {
            productId: masters.scone.id,
            quantity: 3,
            unitPriceSatang: 9000,
            lineNote: "แพ็กเดี่ยว",
          },
        ],
      }),
    );

    expect(updated.discountSatang).toBe(5000);
    expect(updated.items).toEqual([
      expect.objectContaining({
        productId: masters.scone.id,
        quantity: 3,
        unitPriceSatang: 9000,
        lineNote: "แพ็กเดี่ยว",
      }),
    ]);
    expect(
      await context.db
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.ownerId, OWNER_ID),
            eq(orderItems.orderId, created.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it("rolls back both header and items when replacement validation fails", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));
    const [foreignProduct] = await context.db
      .insert(products)
      .values({
        ownerId: OTHER_OWNER_ID,
        name: "Other owner's loaf",
        sellingUnit: "piece",
        defaultUnitPriceSatang: 1000,
      })
      .returning();
    const before = await service.get(OWNER_ID, created.id);

    await expect(
      service.update(
        OWNER_ID,
        created.id,
        orderInput(masters, {
          discountSatang: 7000,
          items: [
            {
              productId: masters.scone.id,
              quantity: 2,
              unitPriceSatang: 8000,
            },
            {
              productId: foreignProduct!.id,
              quantity: 1,
              unitPriceSatang: 1000,
            },
          ],
        }),
      ),
    ).rejects.toThrow("Product not found");

    const after = await service.get(OWNER_ID, created.id);
    expect(after.discountSatang).toBe(before.discountSatang);
    expect(
      after.items.map(({ productId, quantity, unitPriceSatang, lineNote }) => ({
        productId,
        quantity,
        unitPriceSatang,
        lineNote,
      })),
    ).toEqual(
      before.items.map(
        ({ productId, quantity, unitPriceSatang, lineNote }) => ({
          productId,
          quantity,
          unitPriceSatang,
          lineNote,
        }),
      ),
    );
  });

  it("rejects empty orders, cancelled cycles, and every cross-owner reference", async () => {
    const masters = await seedMasters(context.db);
    const foreign = await seedMasters(context.db, OTHER_OWNER_ID, " foreign");
    const [cancelledCycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "Cancelled cycle",
        status: "CANCELLED",
        targetProductionDate: "2026-09-05",
        primaryDeliveryDate: "2026-09-06",
      })
      .returning();

    await expect(
      service.create(OWNER_ID, orderInput(masters, { items: [] })),
    ).rejects.toThrow("Invalid order");
    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, { bakeCycleId: cancelledCycle!.id }),
      ),
    ).rejects.toThrow(/cancelled/i);
    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, { customerId: foreign.customer.id }),
      ),
    ).rejects.toThrow("Customer not found");
    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, { bakeCycleId: foreign.cycle.id }),
      ),
    ).rejects.toThrow("Cycle not found");
    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, {
          items: [
            {
              productId: foreign.focaccia.id,
              quantity: 1,
              unitPriceSatang: 22000,
            },
          ],
        }),
      ),
    ).rejects.toThrow("Product not found");
    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, { deliveryMethodId: foreign.method.id }),
      ),
    ).rejects.toThrow("Delivery method not found");

    expect(
      await context.db
        .select()
        .from(orders)
        .where(eq(orders.ownerId, OWNER_ID)),
    ).toHaveLength(0);
  });

  it("rejects persisted money and quantity above PostgreSQL integer range", async () => {
    const masters = await seedMasters(context.db);
    const maximum = await service.create(
      OWNER_ID,
      orderInput(masters, {
        deliveryFeeChargedSatang: 0,
        deliveryCostSatang: 2_147_483_647,
        discountSatang: 0,
        amountPaidSatang: 0,
        items: [{
          productId: masters.focaccia.id,
          quantity: 1,
          unitPriceSatang: 2_147_483_647,
        }],
      }),
    );
    expect(maximum.deliveryCostSatang).toBe(2_147_483_647);
    expect(maximum.items[0]?.unitPriceSatang).toBe(2_147_483_647);

    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, { deliveryCostSatang: 2_147_483_648 }),
      ),
    ).rejects.toThrow("Invalid order");
    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, {
          items: [{
            productId: masters.focaccia.id,
            quantity: 2_147_483_648,
            unitPriceSatang: 1,
          }],
        }),
      ),
    ).rejects.toThrow("Invalid order");
  });

  it("returns active create options and re-includes historical edit references", async () => {
    const active = await seedMasters(context.db);
    const [inactiveMethod] = await context.db
      .insert(deliveryMethods)
      .values({
        ownerId: OWNER_ID,
        name: "Retired courier",
        defaultCustomerFeeSatang: 3000,
        defaultInternalCostSatang: 4000,
        requiresDeliveryLocation: false,
        active: false,
      })
      .returning();
    const [inactiveProduct] = await context.db
      .insert(products)
      .values({
        ownerId: OWNER_ID,
        name: "Retired bread",
        sellingUnit: "piece",
        defaultUnitPriceSatang: 5000,
        active: false,
      })
      .returning();
    const [inactiveCustomer] = await context.db
      .insert(customers)
      .values({
        ownerId: OWNER_ID,
        name: "Past customer",
        defaultDeliveryMethodId: inactiveMethod!.id,
        defaultDeliveryLocation: "Old address",
        defaultDeliveryNote: "Old note",
        active: false,
      })
      .returning();
    const [advancedCycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "Already producing",
        status: "IN_PRODUCTION",
        targetProductionDate: "2026-09-05",
        primaryDeliveryDate: "2026-09-06",
      })
      .returning();
    const [draftCycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "Draft cycle",
        status: "DRAFT",
        targetProductionDate: "2026-09-12",
        primaryDeliveryDate: "2026-09-13",
      })
      .returning();

    const createOptions = await service.formOptions(OWNER_ID);
    expect(createOptions.customers.map(({ id }) => id)).toEqual([
      active.customer.id,
    ]);
    expect(createOptions.products.map(({ id }) => id).sort()).toEqual(
      [active.focaccia.id, active.scone.id].sort(),
    );
    expect(createOptions.deliveryMethods.map(({ id }) => id)).toEqual([
      active.method.id,
    ]);
    expect(createOptions.bakeCycles.map(({ id }) => id).sort()).toEqual(
      [active.cycle.id, draftCycle!.id].sort(),
    );
    expect(createOptions.customers[0]).toMatchObject({
      defaultDeliveryMethodId: active.method.id,
      defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
      defaultDeliveryNote: "โทรก่อนส่ง",
    });
    expect(createOptions.deliveryMethods[0]).toMatchObject({
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
      requiresDeliveryLocation: true,
    });

    const editOptions = await service.formOptions(OWNER_ID, {
      customerId: inactiveCustomer!.id,
      bakeCycleId: advancedCycle!.id,
      productIds: [inactiveProduct!.id],
      deliveryMethodId: inactiveMethod!.id,
    });
    expect(editOptions.customers.map(({ id }) => id)).toContain(
      inactiveCustomer!.id,
    );
    expect(editOptions.products.map(({ id }) => id)).toContain(
      inactiveProduct!.id,
    );
    expect(editOptions.deliveryMethods.map(({ id }) => id)).toContain(
      inactiveMethod!.id,
    );
    expect(editOptions.bakeCycles.map(({ id }) => id)).toContain(
      advancedCycle!.id,
    );
  });

  it("lists owner-scoped orders with server filters and totals from stored lines", async () => {
    const masters = await seedMasters(context.db);
    const [secondCustomer] = await context.db
      .insert(customers)
      .values({
        ownerId: OWNER_ID,
        name: "คุณอ้อม",
        contactHandle: "@aom",
      })
      .returning();
    const older = await service.create(OWNER_ID, orderInput(masters));
    const newer = await service.create(
      OWNER_ID,
      orderInput(masters, {
        customerId: secondCustomer!.id,
        amountPaidSatang: 62000,
      }),
    );
    await service.updateFulfillmentStatus(
      OWNER_ID,
      newer.id,
      "IN_PRODUCTION",
    );
    await context.db
      .update(orders)
      .set({ createdAt: new Date("2026-08-20T00:00:00Z") })
      .where(eq(orders.id, older.id));
    await context.db
      .update(orders)
      .set({ createdAt: new Date("2026-08-21T00:00:00Z") })
      .where(eq(orders.id, newer.id));
    await context.db
      .update(orderItems)
      .set({ unitPriceSatang: 25000 })
      .where(
        and(
          eq(orderItems.ownerId, OWNER_ID),
          eq(orderItems.orderId, older.id),
          eq(orderItems.productId, masters.focaccia.id),
        ),
      );

    const listed = await service.list(OWNER_ID);
    expect(listed.map(({ id }) => id)).toEqual([newer.id, older.id]);
    expect(listed.find(({ id }) => id === older.id)?.totals).toMatchObject({
      subtotalSatang: 58000,
      grandTotalSatang: 68000,
      balanceSatang: 48000,
    });
    expect(await service.list(OWNER_ID, { query: "อ้อม" })).toEqual([
      expect.objectContaining({ id: newer.id, customerName: "คุณอ้อม" }),
    ]);
    expect(await service.list(OWNER_ID, { customerId: masters.customer.id }))
      .toEqual([expect.objectContaining({ id: older.id })]);
    expect(await service.list(OWNER_ID, { bakeCycleId: masters.cycle.id }))
      .toHaveLength(2);
    expect(await service.list(OWNER_ID, { paymentStatus: "PAID" })).toEqual([
      expect.objectContaining({ id: newer.id }),
    ]);
    expect(
      await service.list(OWNER_ID, { fulfillmentStatus: "IN_PRODUCTION" }),
    ).toEqual([expect.objectContaining({ id: newer.id })]);
    await expect(service.get(OTHER_OWNER_ID, older.id)).rejects.toThrow(
      "Order not found",
    );
    expect(await service.list(OTHER_OWNER_ID)).toEqual([]);
  });

  it("summarizes live cycle money and demand without cancelled orders", async () => {
    const masters = await seedMasters(context.db);
    await context.db
      .update(products)
      .set({ sellingUnit: "kg" })
      .where(
        and(
          eq(products.ownerId, OWNER_ID),
          eq(products.id, masters.scone.id),
        ),
      );
    const [emptyCycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบถัดไป",
        status: "OPEN",
        targetProductionDate: "2026-09-05",
        primaryDeliveryDate: "2026-09-06",
      })
      .returning();

    await service.create(OWNER_ID, orderInput(masters));
    await service.create(
      OWNER_ID,
      orderInput(masters, {
        deliveryFeeChargedSatang: 0,
        deliveryCostSatang: 0,
        discountSatang: 0,
        amountPaidSatang: 0,
        items: [
          {
            productId: masters.focaccia.id,
            quantity: 1,
            unitPriceSatang: 0,
          },
        ],
      }),
    );
    const cancelled = await service.create(
      OWNER_ID,
      orderInput(masters, {
        deliveryFeeChargedSatang: 0,
        deliveryCostSatang: 0,
        discountSatang: 0,
        amountPaidSatang: 0,
        items: [
          {
            productId: masters.scone.id,
            quantity: 4,
            unitPriceSatang: 1000,
          },
        ],
      }),
    );
    await service.cancel(OWNER_ID, cancelled.id);

    expect(
      await service.getCycleSummary(OWNER_ID, masters.cycle.id),
    ).toEqual({
      activeOrderCount: 2,
      cancelledOrderCount: 1,
      grandTotalSatang: 62000,
      amountPaidSatang: 20000,
      balanceSatang: 42000,
      demand: [
        {
          productId: masters.focaccia.id,
          productName: "Focaccia",
          sellingUnit: "piece",
          quantity: 3,
        },
        {
          productId: masters.scone.id,
          productName: "Scone",
          sellingUnit: "kg",
          quantity: 1,
        },
      ],
    });

    const summaries = await service.listCycleSummaries(OWNER_ID, [
      masters.cycle.id,
      emptyCycle!.id,
    ]);
    expect([...summaries.keys()]).toEqual([
      masters.cycle.id,
      emptyCycle!.id,
    ]);
    expect(summaries.get(emptyCycle!.id)).toEqual({
      activeOrderCount: 0,
      cancelledOrderCount: 0,
      grandTotalSatang: 0,
      amountPaidSatang: 0,
      balanceSatang: 0,
      demand: [],
    });
    await expect(
      service.getCycleSummary(OTHER_OWNER_ID, masters.cycle.id),
    ).rejects.toThrow("Cycle not found");
    await expect(
      service.listCycleSummaries(OTHER_OWNER_ID, [masters.cycle.id]),
    ).rejects.toThrow("Cycle not found");
  });

  it("preserves refunds on ordinary edits and supports explicit tracking restoration", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));

    const refunded = await service.markRefunded(OWNER_ID, created.id);
    expect(refunded.paymentStatus).toBe("REFUNDED");

    const edited = await service.update(
      OWNER_ID,
      created.id,
      orderInput(masters, { amountPaidSatang: 62000 }),
    );
    expect(edited.paymentStatus).toBe("REFUNDED");
    expect(edited.totals.paymentStatus).toBe("PAID");

    const restored = await service.restorePaymentTracking(OWNER_ID, created.id);
    expect(restored.paymentStatus).toBe("PAID");

    const producing = await service.updateFulfillmentStatus(
      OWNER_ID,
      created.id,
      "IN_PRODUCTION",
    );
    expect(producing.fulfillmentStatus).toBe("IN_PRODUCTION");
    const cancelled = await service.cancel(OWNER_ID, created.id);
    expect(cancelled.fulfillmentStatus).toBe("CANCELLED");
    expect(cancelled.items).toHaveLength(2);

    await expect(
      service.updateFulfillmentStatus(
        OTHER_OWNER_ID,
        created.id,
        "DELIVERED",
      ),
    ).rejects.toThrow("Order not found");
    await expect(
      service.markRefunded(OTHER_OWNER_ID, created.id),
    ).rejects.toThrow("Order not found");
    await expect(
      service.restorePaymentTracking(OTHER_OWNER_ID, created.id),
    ).rejects.toThrow("Order not found");
  });

  it("moves a new order directly to packed and cancels without deleting its items", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));

    expect(created.fulfillmentStatus).toBe("NEW");
    const packed = await service.updateFulfillmentStatus(
      OWNER_ID,
      created.id,
      "PACKED",
    );
    expect(packed.fulfillmentStatus).toBe("PACKED");

    const cancelled = await service.cancel(OWNER_ID, created.id);
    expect(cancelled.fulfillmentStatus).toBe("CANCELLED");
    expect(cancelled.items).toHaveLength(2);
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      fulfillmentStatus: "CANCELLED",
      items: expect.arrayContaining([
        expect.objectContaining({ productId: masters.focaccia.id }),
        expect.objectContaining({ productId: masters.scone.id }),
      ]),
    });
  });

  it("rejects backward fulfillment transitions without changing the order", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));
    await service.updateFulfillmentStatus(OWNER_ID, created.id, "PACKED");

    await expect(
      service.updateFulfillmentStatus(OWNER_ID, created.id, "CONFIRMED"),
    ).rejects.toThrow("Invalid fulfillment transition");
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      fulfillmentStatus: "PACKED",
    });
  });

  it("requires explicit cancellation and never revives a cancelled order", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));

    await expect(
      service.updateFulfillmentStatus(OWNER_ID, created.id, "CANCELLED"),
    ).rejects.toThrow("Invalid fulfillment transition");
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      fulfillmentStatus: "NEW",
    });

    await service.cancel(OWNER_ID, created.id);
    await expect(
      service.updateFulfillmentStatus(OWNER_ID, created.id, "NEW"),
    ).rejects.toThrow("Invalid fulfillment transition");
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      fulfillmentStatus: "CANCELLED",
      items: [
        expect.objectContaining({ productId: masters.focaccia.id }),
        expect.objectContaining({ productId: masters.scone.id }),
      ],
    });
  });

  it("allows no transition or cancellation after delivery", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));
    await service.updateFulfillmentStatus(OWNER_ID, created.id, "DELIVERED");

    await expect(
      service.updateFulfillmentStatus(OWNER_ID, created.id, "PACKED"),
    ).rejects.toThrow("Invalid fulfillment transition");
    await expect(service.cancel(OWNER_ID, created.id)).rejects.toThrow(
      "Invalid fulfillment transition",
    );
    await expect(service.get(OWNER_ID, created.id)).resolves.toMatchObject({
      fulfillmentStatus: "DELIVERED",
    });
  });

  it.each([
    [0, "UNPAID"],
    [20000, "PARTIAL"],
    [62000, "PAID"],
  ] as const)(
    "restores a refunded order with %i satang paid to %s",
    async (amountPaidSatang, expectedStatus) => {
      const masters = await seedMasters(context.db);
      const created = await service.create(
        OWNER_ID,
        orderInput(masters, { amountPaidSatang }),
      );
      await service.markRefunded(OWNER_ID, created.id);

      const edited = await service.update(
        OWNER_ID,
        created.id,
        orderInput(masters, { amountPaidSatang }),
      );
      expect(edited.paymentStatus).toBe("REFUNDED");

      const restored = await service.restorePaymentTracking(
        OWNER_ID,
        created.id,
      );
      expect(restored.paymentStatus).toBe(expectedStatus);
    },
  );

  it("combines every list filter while keeping customer search owner-scoped", async () => {
    const masters = await seedMasters(context.db);
    const foreign = await seedMasters(context.db, OTHER_OWNER_ID, " foreign");
    const [otherCustomer] = await context.db
      .insert(customers)
      .values({
        ownerId: OWNER_ID,
        name: "คุณอ้อม",
        contactHandle: "@aom",
      })
      .returning();

    const matching = await service.create(
      OWNER_ID,
      orderInput(masters, { amountPaidSatang: 62000 }),
    );
    await service.updateFulfillmentStatus(OWNER_ID, matching.id, "PACKED");
    await service.create(
      OWNER_ID,
      orderInput(masters, {
        customerId: otherCustomer!.id,
        amountPaidSatang: 62000,
      }),
    );
    await createOrderService(context.db).create(
      OTHER_OWNER_ID,
      orderInput(foreign, { amountPaidSatang: 62000 }),
    );

    const listed = await service.list(OWNER_ID, {
      query: "เมย์",
      bakeCycleId: masters.cycle.id,
      customerId: masters.customer.id,
      paymentStatus: "PAID",
      fulfillmentStatus: "PACKED",
    });

    expect(listed).toEqual([
      expect.objectContaining({
        id: matching.id,
        ownerId: OWNER_ID,
        customerId: masters.customer.id,
        bakeCycleId: masters.cycle.id,
        paymentStatus: "PAID",
        fulfillmentStatus: "PACKED",
      }),
    ]);
  });
});
