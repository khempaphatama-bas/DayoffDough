import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "drizzle-orm/logger";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import {
  createPlanningCommandService,
  PlanningStaleError,
} from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { products } from "@/modules/products/db/schema";
import {
  createOrderService,
  type OrderDetail,
  type OrderInput,
} from "./orders";

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
    confirmedDeliveryTime: null,
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

function orderDetailInput(
  detail: OrderDetail,
  overrides: Partial<OrderInput> = {},
): OrderInput {
  return {
    customerId: detail.customerId,
    bakeCycleId: detail.bakeCycleId,
    sourceChannel: detail.sourceChannel,
    requestedDeliveryDate: detail.requestedDeliveryDate,
    confirmedDeliveryDate: detail.confirmedDeliveryDate,
    confirmedDeliveryTime: detail.confirmedDeliveryTime,
    deliveryMethodId: detail.deliveryMethodId,
    deliveryFeeChargedSatang: detail.deliveryFeeChargedSatang,
    deliveryCostSatang: detail.deliveryCostSatang,
    deliveryFeePayer: detail.deliveryFeePayer,
    discountSatang: detail.discountSatang,
    amountPaidSatang: detail.amountPaidSatang,
    deliveryLocation: detail.deliveryLocation ?? "",
    deliveryNote: detail.deliveryNote ?? "",
    specialInstructions: detail.specialInstructions ?? "",
    items: detail.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceSatang: item.unitPriceSatang,
      lineNote: item.lineNote ?? "",
    })),
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
    ).rejects.toThrow("Cycle production inputs are locked");
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

  it("returns cycle status through the existing owner-scoped batched cycle lookup", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    service = createOrderService(context.db);
    const masters = await seedMasters(context.db);
    const first = await service.create(OWNER_ID, orderInput(masters));
    await service.create(OWNER_ID, orderInput(masters));
    await context.db
      .update(bakeCycles)
      .set({ status: "LOCKED" })
      .where(eq(bakeCycles.id, masters.cycle.id));

    queries.length = 0;
    const listed = await service.list(OWNER_ID);

    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          cycleName: masters.cycle.name,
          cycleStatus: "LOCKED",
        }),
      ]),
    );
    const cycleQueries = queries.filter(
      (query) =>
        query.includes('from "bake_cycles"') &&
        !query.includes("for update"),
    );
    expect(cycleQueries).toHaveLength(1);
    expect(cycleQueries[0]).toContain('"status"');
  });

  it.each([
    "LOCKED",
    "IN_PRODUCTION",
    "COMPLETED",
    "CANCELLED",
  ] as const)(
    "freezes production inputs and cancellation while allowing money and forward progress in %s",
    async (cycleStatus) => {
      const masters = await seedMasters(context.db);
      const created = await service.create(OWNER_ID, orderInput(masters));
      const [destination] = await context.db
        .insert(bakeCycles)
        .values({
          ownerId: OWNER_ID,
          name: "Editable destination",
          status: "OPEN",
          targetProductionDate: "2026-09-05",
          primaryDeliveryDate: "2026-09-06",
        })
        .returning();
      await context.db
        .update(bakeCycles)
        .set({ status: cycleStatus })
        .where(eq(bakeCycles.id, masters.cycle.id));
      const beforeRejectedWrites = await service.get(OWNER_ID, created.id);
      const [orderCountBefore] = await context.db
        .select({ value: sql<number>`count(*)` })
        .from(orders);

      await expect(
        service.create(OWNER_ID, orderInput(masters)),
      ).rejects.toThrow("Cycle production inputs are locked");
      await expect(
        service.update(
          OWNER_ID,
          created.id,
          orderInput(masters, { discountSatang: 3000 }),
        ),
      ).rejects.toThrow("Cycle production inputs are locked");
      await expect(
        service.update(
          OWNER_ID,
          created.id,
          orderInput(masters, { bakeCycleId: destination!.id }),
        ),
      ).rejects.toThrow("Cycle production inputs are locked");
      await expect(service.cancel(OWNER_ID, created.id)).rejects.toThrow(
        "Cycle production inputs are locked",
      );

      expect(await service.get(OWNER_ID, created.id)).toEqual(
        beforeRejectedWrites,
      );
      const [orderCountAfter] = await context.db
        .select({ value: sql<number>`count(*)` })
        .from(orders);
      expect(orderCountAfter!.value).toBe(orderCountBefore!.value);
      await expect(
        context.db
          .select({ status: bakeCycles.status })
          .from(bakeCycles)
          .where(eq(bakeCycles.id, masters.cycle.id)),
      ).resolves.toEqual([{ status: cycleStatus }]);

      const paid = await service.update(
        OWNER_ID,
        created.id,
        orderInput(masters, {
          amountPaidSatang: 62000,
          items: [
            {
              productId: masters.focaccia.id,
              quantity: 2,
              unitPriceSatang: 22000,
            },
            {
              productId: masters.scone.id,
              quantity: 1,
              unitPriceSatang: 8000,
              lineNote: "ไม่อุ่น",
            },
          ],
        }),
      );
      expect(paid).toMatchObject({
        amountPaidSatang: 62000,
        cycleStatus,
      });
      await expect(service.markRefunded(OWNER_ID, created.id)).resolves
        .toMatchObject({ paymentStatus: "REFUNDED", cycleStatus });
      await expect(
        service.restorePaymentTracking(OWNER_ID, created.id),
      ).resolves.toMatchObject({ paymentStatus: "PAID", cycleStatus });
      await expect(
        service.updateFulfillmentStatus(OWNER_ID, created.id, "PACKED"),
      ).resolves.toMatchObject({
        fulfillmentStatus: "PACKED",
        cycleStatus,
      });
    },
  );

  it("rejects each individual frozen production-input mutation while normalizing line notes", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));
    const [alternateCustomer] = await context.db
      .insert(customers)
      .values({ ownerId: OWNER_ID, name: "Alternate customer" })
      .returning();
    const [alternateMethod] = await context.db
      .insert(deliveryMethods)
      .values({
        ownerId: OWNER_ID,
        name: "Alternate method",
        defaultCustomerFeeSatang: 0,
        defaultInternalCostSatang: 0,
        requiresDeliveryLocation: false,
      })
      .returning();
    const [alternateCycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "Alternate cycle",
        status: "OPEN",
        targetProductionDate: "2026-09-05",
        primaryDeliveryDate: "2026-09-06",
      })
      .returning();
    await context.db
      .update(bakeCycles)
      .set({ status: "LOCKED" })
      .where(eq(bakeCycles.id, masters.cycle.id));
    const baseline = orderInput(masters);
    const reversedItems = [...baseline.items].reverse();
    const cases: ReadonlyArray<
      readonly [string, Partial<OrderInput>]
    > = [
      ["customer", { customerId: alternateCustomer!.id }],
      ["cycle", { bakeCycleId: alternateCycle!.id }],
      ["source channel", { sourceChannel: "PHONE" }],
      ["requested date", { requestedDeliveryDate: "2026-08-31" }],
      ["confirmed date", { confirmedDeliveryDate: "2026-08-31" }],
      ["confirmed time", { confirmedDeliveryTime: "14:30" }],
      ["delivery method", { deliveryMethodId: alternateMethod!.id }],
      ["delivery location", { deliveryLocation: "เชียงใหม่" }],
      ["delivery note", { deliveryNote: "วางหน้าบ้าน" }],
      ["production note", { specialInstructions: "รวมถุง" }],
      ["charged delivery fee", { deliveryFeeChargedSatang: 13000 }],
      ["delivery cost", { deliveryCostSatang: 13000 }],
      ["delivery fee payer", { deliveryFeePayer: "BAKERY" }],
      ["discount", { discountSatang: 3000 }],
      [
        "item product",
        {
          items: [
            { ...baseline.items[0]!, productId: masters.scone.id },
            baseline.items[1]!,
          ],
        },
      ],
      [
        "item quantity",
        {
          items: [
            { ...baseline.items[0]!, quantity: 3 },
            baseline.items[1]!,
          ],
        },
      ],
      [
        "item unit price",
        {
          items: [
            { ...baseline.items[0]!, unitPriceSatang: 23000 },
            baseline.items[1]!,
          ],
        },
      ],
      [
        "item line note",
        {
          items: [
            { ...baseline.items[0]!, lineNote: "แพ็กเดี่ยว" },
            baseline.items[1]!,
          ],
        },
      ],
      ["item order", { items: reversedItems }],
    ];

    const before = await service.get(OWNER_ID, created.id);
    for (const [field, override] of cases) {
      await expect(
        service.update(
          OWNER_ID,
          created.id,
          orderInput(masters, override),
        ),
        field,
      ).rejects.toThrow("Cycle production inputs are locked");
      expect(await service.get(OWNER_ID, created.id), field).toEqual(before);
    }

    await expect(
      service.update(
        OWNER_ID,
        created.id,
        orderInput(masters, {
          amountPaidSatang: 21000,
          items: [
            {
              productId: masters.focaccia.id,
              quantity: 2,
              unitPriceSatang: 22000,
            },
            baseline.items[1]!,
          ],
        }),
      ),
    ).resolves.toMatchObject({ amountPaidSatang: 21000 });
  });

  it.each(["LOCKED", "IN_PRODUCTION", "COMPLETED"] as const)(
    "freezes delivery time but permits payment-only edits when the cycle is %s",
    async (cycleStatus) => {
      const masters = await seedMasters(context.db);
      const created = await service.create(OWNER_ID, orderInput(masters));
      await context.db
        .update(bakeCycles)
        .set({ status: cycleStatus })
        .where(eq(bakeCycles.id, masters.cycle.id));

      await expect(
        service.update(
          OWNER_ID,
          created.id,
          orderDetailInput(created, { confirmedDeliveryTime: "14:30" }),
        ),
      ).rejects.toThrow("Cycle production inputs are locked");

      await expect(
        service.update(
          OWNER_ID,
          created.id,
          orderDetailInput(created, { amountPaidSatang: 21_000 }),
        ),
      ).resolves.toMatchObject({
        confirmedDeliveryTime: null,
        amountPaidSatang: 21_000,
      });
    },
  );

  it("rejects overpayment on create and update even without the form boundary", async () => {
    const masters = await seedMasters(context.db);

    await expect(
      service.create(
        OWNER_ID,
        orderInput(masters, { amountPaidSatang: 62_001 }),
      ),
    ).rejects.toThrow("Invalid order");

    const created = await service.create(OWNER_ID, orderInput(masters));
    await expect(
      service.update(
        OWNER_ID,
        created.id,
        orderDetailInput(created, { amountPaidSatang: 62_001 }),
      ),
    ).rejects.toThrow("Invalid order");
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
            eq(orderItems.active, true),
          ),
        ),
    ).toHaveLength(1);
  });

  it("reconciles ordered active items while preserving and archiving source rows", async () => {
    const masters = await seedMasters(context.db);
    const created = await service.create(OWNER_ID, orderInput(masters));
    expect(created.items.map((item) => item.productId)).toEqual([
      masters.focaccia.id,
      masters.scone.id,
    ]);
    const originalItemIds = created.items.map((item) => item.id);

    const quantityEdited = await service.update(
      OWNER_ID,
      created.id,
      orderDetailInput(created, {
        items: created.items.map((item, index) => ({
          productId: item.productId,
          quantity: index === 0 ? 3 : item.quantity,
          unitPriceSatang: item.unitPriceSatang,
          lineNote: item.lineNote ?? "",
        })),
      }),
    );
    expect(quantityEdited.items.map((item) => item.id)).toEqual(
      originalItemIds,
    );

    const swapped = await service.update(
      OWNER_ID,
      created.id,
      orderDetailInput(quantityEdited, {
        items: [
          {
            productId: masters.scone.id,
            quantity: 4,
            unitPriceSatang: 9000,
            lineNote: "แพ็กเดี่ยว",
          },
        ],
      }),
    );
    expect(swapped.items).toEqual([
      expect.objectContaining({
        productId: masters.scone.id,
        quantity: 4,
        unitPriceSatang: 9000,
        lineNote: "แพ็กเดี่ยว",
      }),
    ]);
    expect(originalItemIds).not.toContain(swapped.items[0]!.id);

    const persistedRows = await context.db
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        position: orderItems.position,
        active: orderItems.active,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.ownerId, OWNER_ID),
          eq(orderItems.orderId, created.id),
        ),
      )
      .orderBy(orderItems.position, orderItems.id);
    expect(persistedRows).toHaveLength(3);
    expect(
      persistedRows.filter((item) => item.active),
    ).toEqual([
      {
        id: swapped.items[0]!.id,
        productId: masters.scone.id,
        quantity: 4,
        position: 0,
        active: true,
      },
    ]);
    expect(
      persistedRows
        .filter((item) => !item.active)
        .map(({ id, position, active }) => ({ id, position, active })),
    ).toEqual(
      expect.arrayContaining([
        { id: originalItemIds[0], position: 0, active: false },
        { id: originalItemIds[1], position: 1, active: false },
      ]),
    );
    await expect(
      service.getCycleSummary(OWNER_ID, masters.cycle.id),
    ).resolves.toMatchObject({
      demand: [
        expect.objectContaining({
          productId: masters.scone.id,
          quantity: 4,
        }),
      ],
    });
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
    ).rejects.toThrow("Cycle production inputs are locked");
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
    const persisted = await service.get(OWNER_ID, created.id);
    expect(persisted.items).toHaveLength(2);
    expect(persisted).toMatchObject({
      fulfillmentStatus: "CANCELLED",
      items: expect.arrayContaining([
        expect.objectContaining({ productId: masters.focaccia.id }),
        expect.objectContaining({ productId: masters.scone.id }),
      ]),
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

  it("locks unique cycles in sorted order before order rows for every write", async () => {
    const queries: Array<Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>> = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string, params: unknown[]) {
          queries.push({ sql: query.toLowerCase(), params: [...params] });
        },
      } satisfies Logger,
    });
    service = createOrderService(context.db);
    const masters = await seedMasters(context.db);

    queries.length = 0;
    const created = await service.create(OWNER_ID, orderInput(masters));
    const createCycleLock = queries.findIndex(
      ({ sql: query }) =>
        query.includes('from "bake_cycles"') && query.includes("for update"),
    );
    const orderInsert = queries.findIndex(({ sql: query }) =>
      query.startsWith('insert into "orders"'),
    );
    expect(createCycleLock).toBeGreaterThanOrEqual(0);
    expect(orderInsert).toBeGreaterThan(createCycleLock);

    const [destination] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "Move destination",
        status: "OPEN",
        targetProductionDate: "2026-09-05",
        primaryDeliveryDate: "2026-09-06",
      })
      .returning();
    queries.length = 0;
    await service.update(
      OWNER_ID,
      created.id,
      orderInput(masters, { bakeCycleId: destination!.id }),
    );
    const moveOrderLock = queries.findIndex(
      ({ sql: query }) =>
        query.includes('from "orders"') && query.includes("for update"),
    );
    const moveCycleLocks = queries
      .map((query, index) => ({ ...query, index }))
      .filter(
        ({ sql: query }) =>
          query.includes('from "bake_cycles"') && query.includes("for update"),
      );
    expect(moveCycleLocks.map(({ params }) => params[1])).toEqual(
      [masters.cycle.id, destination!.id].sort(),
    );
    expect(moveCycleLocks.every(({ index }) => index < moveOrderLock)).toBe(
      true,
    );

    async function expectCycleBeforeOrderLock(
      mutate: () => Promise<unknown>,
    ) {
      queries.length = 0;
      await mutate();
      const cycleLocks = queries
        .map((query, index) => ({ ...query, index }))
        .filter(
          ({ sql: query }) =>
            query.includes('from "bake_cycles"') &&
            query.includes("for update"),
        );
      const orderLock = queries.findIndex(
        ({ sql: query }) =>
          query.includes('from "orders"') && query.includes("for update"),
      );
      expect(cycleLocks).toHaveLength(1);
      expect(cycleLocks[0]!.params[1]).toBe(destination!.id);
      expect(cycleLocks[0]!.index).toBeLessThan(orderLock);
    }

    const movedInput = orderInput(masters, { bakeCycleId: destination!.id });
    await expectCycleBeforeOrderLock(() =>
      service.update(OWNER_ID, created.id, {
        ...movedInput,
        amountPaidSatang: 21000,
      }),
    );
    await expectCycleBeforeOrderLock(() =>
      service.updateFulfillmentStatus(OWNER_ID, created.id, "CONFIRMED"),
    );
    await expectCycleBeforeOrderLock(() =>
      service.markRefunded(OWNER_ID, created.id),
    );
    await expectCycleBeforeOrderLock(() =>
      service.restorePaymentTracking(OWNER_ID, created.id),
    );
    await expectCycleBeforeOrderLock(() => service.cancel(OWNER_ID, created.id));
  });

  it("racing planning lock and quantity update observes only a coherent committed order", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const planningClock = {
      now: () => new Date("2026-08-29T00:00:00.000Z"),
    };
    const planningQueries = createPlanningQueryService(
      context.db,
      planningClock,
    );
    const planningCommands = createPlanningCommandService(
      context.db,
      planningClock,
    );
    const ordersService = createOrderService(context.db);
    const before = await ordersService.get(OWNER_ID, scenario.orderIds[0]!);
    const oldQuantity = before.items[0]!.quantity;
    const newQuantity = oldQuantity + 2;
    const preview = await planningQueries.preview(OWNER_ID, scenario.cycleId);

    const [lockResult, updateResult] = await Promise.allSettled([
      planningCommands.lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId: "70707070-7070-4070-8070-707070707070",
        overrides: [],
      }),
      ordersService.update(
        OWNER_ID,
        before.id,
        orderDetailInput(before, {
          items: before.items.map((item, index) => ({
            productId: item.productId,
            quantity: index === 0 ? newQuantity : item.quantity,
            unitPriceSatang: item.unitPriceSatang,
            lineNote: item.lineNote ?? "",
          })),
        }),
      ),
    ]);

    if (lockResult.status === "fulfilled") {
      expect(updateResult.status).toBe("rejected");
      expect((updateResult as PromiseRejectedResult).reason).toMatchObject({
        message: "Cycle production inputs are locked",
      });
      const generation = await planningQueries.getGeneration(
        OWNER_ID,
        scenario.cycleId,
      );
      const snapshotted = generation.orders.find(
        (order) => order.id === before.id,
      );
      expect(snapshotted?.items[0]?.quantity).toBe(oldQuantity);
      expect(snapshotted?.subtotalSatang).toBe(
        oldQuantity * before.items[0]!.unitPriceSatang,
      );
    } else {
      expect(lockResult.reason).toBeInstanceOf(PlanningStaleError);
      expect(updateResult.status).toBe("fulfilled");
      const committed = await ordersService.get(OWNER_ID, before.id);
      expect(committed.items[0]?.quantity).toBe(newQuantity);
      expect(committed.totals.subtotalSatang).toBe(
        newQuantity * committed.items[0]!.unitPriceSatang,
      );
    }
  });
});
