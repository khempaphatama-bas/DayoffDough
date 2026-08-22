import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
} from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import {
  deliveryFeePayer,
  orderFulfillmentStatus,
  orderItems,
  orderPaymentStatus,
  orders,
  orderSourceChannel,
} from "@/modules/orders/db/schema";
import {
  calculateOrderTotals,
  type OrderTotals,
} from "@/modules/orders/domain/totals";
import { products } from "@/modules/products/db/schema";

export type OrderItemInput = Readonly<{
  productId: string;
  quantity: number;
  unitPriceSatang: number;
  lineNote?: string;
}>;

export type OrderInput = Readonly<{
  customerId: string;
  bakeCycleId: string;
  sourceChannel: "INSTAGRAM" | "FACEBOOK" | "PHONE" | "OTHER" | null;
  requestedDeliveryDate: string | null;
  confirmedDeliveryDate: string | null;
  deliveryMethodId: string | null;
  deliveryFeeChargedSatang: number;
  deliveryCostSatang: number;
  deliveryFeePayer: "CUSTOMER" | "BAKERY" | "SHARED";
  discountSatang: number;
  amountPaidSatang: number;
  deliveryLocation: string;
  deliveryNote: string;
  specialInstructions: string;
  items: ReadonlyArray<OrderItemInput>;
}>;

export type OrderListFilters = Readonly<{
  query?: string;
  bakeCycleId?: string;
  customerId?: string;
  paymentStatus?: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  fulfillmentStatus?:
    | "NEW"
    | "CONFIRMED"
    | "IN_PRODUCTION"
    | "PACKED"
    | "DELIVERED"
    | "CANCELLED";
}>;

export type OrderFulfillmentStatus =
  | "NEW"
  | "CONFIRMED"
  | "IN_PRODUCTION"
  | "PACKED"
  | "DELIVERED"
  | "CANCELLED";

export type OrderFormOptionIncludes = Readonly<{
  customerId: string;
  bakeCycleId: string;
  productIds: ReadonlyArray<string>;
  deliveryMethodId: string | null;
}>;

export type OrderDetailItem = Readonly<{
  id: string;
  ownerId: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceSatang: number;
  lineNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type OrderDetail = Readonly<{
  id: string;
  ownerId: string;
  customerId: string;
  customerName: string;
  bakeCycleId: string;
  cycleName: string;
  sourceChannel: (typeof orderSourceChannel)[number] | null;
  requestedDeliveryDate: string | null;
  confirmedDeliveryDate: string | null;
  deliveryMethodId: string | null;
  deliveryMethodName: string | null;
  deliveryFeeChargedSatang: number;
  deliveryCostSatang: number;
  deliveryFeePayer: (typeof deliveryFeePayer)[number];
  discountSatang: number;
  amountPaidSatang: number;
  deliveryLocation: string | null;
  deliveryNote: string | null;
  specialInstructions: string | null;
  paymentStatus: (typeof orderPaymentStatus)[number];
  fulfillmentStatus: OrderFulfillmentStatus;
  createdAt: Date;
  updatedAt: Date;
  items: ReadonlyArray<OrderDetailItem>;
  totals: OrderTotals;
}>;

export type OrderFormOptions = Readonly<{
  customers: ReadonlyArray<
    Readonly<{
      id: string;
      name: string;
      contactHandle: string | null;
      phone: string | null;
      defaultDeliveryMethodId: string | null;
      defaultDeliveryLocation: string | null;
      defaultDeliveryNote: string | null;
      active: boolean;
    }>
  >;
  products: ReadonlyArray<
    Readonly<{
      id: string;
      name: string;
      defaultUnitPriceSatang: number;
      active: boolean;
    }>
  >;
  deliveryMethods: ReadonlyArray<
    Readonly<{
      id: string;
      name: string;
      defaultCustomerFeeSatang: number;
      defaultInternalCostSatang: number;
      requiresDeliveryLocation: boolean;
      active: boolean;
    }>
  >;
  bakeCycles: ReadonlyArray<
    Readonly<{
      id: string;
      cycleNumber: number;
      name: string;
      status: (typeof bakeCycles.$inferSelect)["status"];
      targetProductionDate: string;
      primaryDeliveryDate: string;
    }>
  >;
}>;

const uuidSchema = z.string().uuid();
const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const orderItemSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  unitPriceSatang: moneySchema,
  lineNote: z.string().trim().max(2000).optional(),
});
const orderInputSchema = z.object({
  customerId: uuidSchema,
  bakeCycleId: uuidSchema,
  sourceChannel: z.enum(orderSourceChannel).nullable(),
  requestedDeliveryDate: z.iso.date().nullable(),
  confirmedDeliveryDate: z.iso.date().nullable(),
  deliveryMethodId: uuidSchema.nullable(),
  deliveryFeeChargedSatang: moneySchema,
  deliveryCostSatang: moneySchema,
  deliveryFeePayer: z.enum(deliveryFeePayer),
  discountSatang: moneySchema,
  amountPaidSatang: moneySchema,
  deliveryLocation: z.string().trim().max(2000),
  deliveryNote: z.string().trim().max(2000),
  specialInstructions: z.string().trim().max(2000),
  items: z.array(orderItemSchema).min(1),
});
const orderFiltersSchema = z.object({
  query: z.string().trim().max(200).optional(),
  bakeCycleId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  paymentStatus: z.enum(orderPaymentStatus).optional(),
  fulfillmentStatus: z.enum(orderFulfillmentStatus).optional(),
});
const orderFormIncludesSchema = z.object({
  customerId: uuidSchema,
  bakeCycleId: uuidSchema,
  productIds: z.array(uuidSchema),
  deliveryMethodId: uuidSchema.nullable(),
});
const fulfillmentStatusSchema = z.enum(orderFulfillmentStatus);

type OrderRow = typeof orders.$inferSelect;
type OrderWriteInput = z.infer<typeof orderInputSchema>;
type QueryReader = Pick<DatabaseClient, "select">;

function parseOrderWrite(
  ownerId: string,
  input: OrderInput,
): Readonly<{
  ownerId: string;
  input: OrderWriteInput;
  totals: OrderTotals;
}> {
  const parsedOwnerId = uuidSchema.safeParse(ownerId);
  const parsedInput = orderInputSchema.safeParse(input);
  if (!parsedOwnerId.success || !parsedInput.success) {
    throw new Error("Invalid order");
  }
  return {
    ownerId: parsedOwnerId.data,
    input: parsedInput.data,
    totals: calculateOrderTotals(parsedInput.data),
  };
}

async function validateOwnedReferences(
  reader: QueryReader,
  ownerId: string,
  input: OrderWriteInput,
): Promise<void> {
  const [customer] = await reader
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(eq(customers.ownerId, ownerId), eq(customers.id, input.customerId)),
    )
    .limit(1);
  if (!customer) throw new Error("Customer not found");

  const [cycle] = await reader
    .select({ id: bakeCycles.id, status: bakeCycles.status })
    .from(bakeCycles)
    .where(
      and(
        eq(bakeCycles.ownerId, ownerId),
        eq(bakeCycles.id, input.bakeCycleId),
      ),
    )
    .limit(1);
  if (!cycle) throw new Error("Cycle not found");
  if (cycle.status === "CANCELLED") {
    throw new Error("Cancelled cycle cannot accept orders");
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const productRows = await reader
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.ownerId, ownerId),
        inArray(products.id, productIds),
      ),
    );
  if (productRows.length !== productIds.length) {
    throw new Error("Product not found");
  }

  if (input.deliveryMethodId !== null) {
    const [method] = await reader
      .select({ id: deliveryMethods.id })
      .from(deliveryMethods)
      .where(
        and(
          eq(deliveryMethods.ownerId, ownerId),
          eq(deliveryMethods.id, input.deliveryMethodId),
        ),
      )
      .limit(1);
    if (!method) throw new Error("Delivery method not found");
  }
}

async function buildOrderDetails(
  reader: QueryReader,
  ownerId: string,
  orderRows: ReadonlyArray<OrderRow>,
): Promise<ReadonlyArray<OrderDetail>> {
  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((order) => order.id);
  const customerIds = [...new Set(orderRows.map((order) => order.customerId))];
  const cycleIds = [...new Set(orderRows.map((order) => order.bakeCycleId))];
  const deliveryMethodIds = [
    ...new Set(
      orderRows.flatMap((order) =>
        order.deliveryMethodId === null ? [] : [order.deliveryMethodId],
      ),
    ),
  ];

  const customerRows = await reader
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(
      and(
        eq(customers.ownerId, ownerId),
        inArray(customers.id, customerIds),
      ),
    );
  const cycleRows = await reader
    .select({ id: bakeCycles.id, name: bakeCycles.name })
    .from(bakeCycles)
    .where(
      and(
        eq(bakeCycles.ownerId, ownerId),
        inArray(bakeCycles.id, cycleIds),
      ),
    );
  const methodRows =
    deliveryMethodIds.length === 0
      ? []
      : await reader
          .select({ id: deliveryMethods.id, name: deliveryMethods.name })
          .from(deliveryMethods)
          .where(
            and(
              eq(deliveryMethods.ownerId, ownerId),
              inArray(deliveryMethods.id, deliveryMethodIds),
            ),
          );
  const itemRows = await reader
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.ownerId, ownerId),
        inArray(orderItems.orderId, orderIds),
      ),
    )
    .orderBy(asc(orderItems.createdAt));
  const productIds = [...new Set(itemRows.map((item) => item.productId))];
  const productRows =
    productIds.length === 0
      ? []
      : await reader
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(
            and(
              eq(products.ownerId, ownerId),
              inArray(products.id, productIds),
            ),
          );

  const customerNameById = new Map(
    customerRows.map((customer) => [customer.id, customer.name]),
  );
  const cycleNameById = new Map(
    cycleRows.map((cycle) => [cycle.id, cycle.name]),
  );
  const methodNameById = new Map(
    methodRows.map((method) => [method.id, method.name]),
  );
  const productNameById = new Map(
    productRows.map((product) => [product.id, product.name]),
  );
  const itemsByOrderId = new Map<string, OrderDetailItem[]>();
  for (const item of itemRows) {
    const detailItem: OrderDetailItem = {
      ...item,
      productName: productNameById.get(item.productId) ?? "Unknown product",
    };
    const groupedItems = itemsByOrderId.get(item.orderId);
    if (groupedItems) {
      groupedItems.push(detailItem);
    } else {
      itemsByOrderId.set(item.orderId, [detailItem]);
    }
  }

  return orderRows.map((order): OrderDetail => {
    const items = itemsByOrderId.get(order.id) ?? [];
    return {
      ...order,
      customerName:
        customerNameById.get(order.customerId) ?? "Unknown customer",
      cycleName: cycleNameById.get(order.bakeCycleId) ?? "Unknown cycle",
      deliveryMethodName:
        order.deliveryMethodId === null
          ? null
          : (methodNameById.get(order.deliveryMethodId) ??
            "Unknown delivery method"),
      fulfillmentStatus: order.fulfillmentStatus as OrderFulfillmentStatus,
      items,
      totals: calculateOrderTotals({
        items,
        discountSatang: order.discountSatang,
        deliveryFeeChargedSatang: order.deliveryFeeChargedSatang,
        amountPaidSatang: order.amountPaidSatang,
      }),
    };
  });
}

async function requireOrderDetail(
  reader: QueryReader,
  ownerId: string,
  orderId: string,
): Promise<OrderDetail> {
  const [order] = await reader
    .select()
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), eq(orders.id, orderId)))
    .limit(1);
  if (!order) throw new Error("Order not found");
  const [detail] = await buildOrderDetails(reader, ownerId, [order]);
  if (!detail) throw new Error("Order not found");
  return detail;
}

export function createOrderService(db: DatabaseClient) {
  async function updateFulfillmentStatus(
    ownerId: string,
    orderId: string,
    status: OrderFulfillmentStatus,
  ): Promise<OrderDetail> {
    const parsedOwnerId = uuidSchema.safeParse(ownerId);
    const parsedOrderId = uuidSchema.safeParse(orderId);
    const parsedStatus = fulfillmentStatusSchema.safeParse(status);
    if (
      !parsedOwnerId.success ||
      !parsedOrderId.success ||
      !parsedStatus.success
    ) {
      throw new Error("Invalid fulfillment status");
    }

    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(orders)
        .set({ fulfillmentStatus: parsedStatus.data, updatedAt: new Date() })
        .where(
          and(
            eq(orders.ownerId, parsedOwnerId.data),
            eq(orders.id, parsedOrderId.data),
          ),
        )
        .returning({ id: orders.id });
      if (!updated) throw new Error("Order not found");
      return requireOrderDetail(
        tx,
        parsedOwnerId.data,
        parsedOrderId.data,
      );
    });
  }

  async function markRefunded(
    ownerId: string,
    orderId: string,
  ): Promise<OrderDetail> {
    const parsedOwnerId = uuidSchema.safeParse(ownerId);
    const parsedOrderId = uuidSchema.safeParse(orderId);
    if (!parsedOwnerId.success || !parsedOrderId.success) {
      throw new Error("Order not found");
    }

    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(orders)
        .set({ paymentStatus: "REFUNDED", updatedAt: new Date() })
        .where(
          and(
            eq(orders.ownerId, parsedOwnerId.data),
            eq(orders.id, parsedOrderId.data),
          ),
        )
        .returning({ id: orders.id });
      if (!updated) throw new Error("Order not found");
      return requireOrderDetail(
        tx,
        parsedOwnerId.data,
        parsedOrderId.data,
      );
    });
  }

  return {
    async formOptions(
      ownerId: string,
      include?: OrderFormOptionIncludes,
    ): Promise<OrderFormOptions> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedInclude =
        include === undefined
          ? undefined
          : orderFormIncludesSchema.safeParse(include);
      if (
        !parsedOwnerId.success ||
        (parsedInclude !== undefined && !parsedInclude.success)
      ) {
        throw new Error("Invalid order form options");
      }
      const included = parsedInclude?.data;
      const includedProductIds = included
        ? [...new Set(included.productIds)]
        : [];

      const customerRows = await db
        .select({
          id: customers.id,
          name: customers.name,
          contactHandle: customers.contactHandle,
          phone: customers.phone,
          defaultDeliveryMethodId: customers.defaultDeliveryMethodId,
          defaultDeliveryLocation: customers.defaultDeliveryLocation,
          defaultDeliveryNote: customers.defaultDeliveryNote,
          active: customers.active,
        })
        .from(customers)
        .where(
          and(
            eq(customers.ownerId, parsedOwnerId.data),
            included
              ? or(
                  eq(customers.active, true),
                  eq(customers.id, included.customerId),
                )
              : eq(customers.active, true),
          ),
        )
        .orderBy(asc(customers.name));
      const productRows = await db
        .select({
          id: products.id,
          name: products.name,
          defaultUnitPriceSatang: products.defaultUnitPriceSatang,
          active: products.active,
        })
        .from(products)
        .where(
          and(
            eq(products.ownerId, parsedOwnerId.data),
            includedProductIds.length > 0
              ? or(
                  eq(products.active, true),
                  inArray(products.id, includedProductIds),
                )
              : eq(products.active, true),
          ),
        )
        .orderBy(asc(products.name));
      const methodRows = await db
        .select({
          id: deliveryMethods.id,
          name: deliveryMethods.name,
          defaultCustomerFeeSatang: deliveryMethods.defaultCustomerFeeSatang,
          defaultInternalCostSatang: deliveryMethods.defaultInternalCostSatang,
          requiresDeliveryLocation: deliveryMethods.requiresDeliveryLocation,
          active: deliveryMethods.active,
        })
        .from(deliveryMethods)
        .where(
          and(
            eq(deliveryMethods.ownerId, parsedOwnerId.data),
            included?.deliveryMethodId
              ? or(
                  eq(deliveryMethods.active, true),
                  eq(deliveryMethods.id, included.deliveryMethodId),
                )
              : eq(deliveryMethods.active, true),
          ),
        )
        .orderBy(asc(deliveryMethods.name));
      const cycleRows = await db
        .select({
          id: bakeCycles.id,
          cycleNumber: bakeCycles.cycleNumber,
          name: bakeCycles.name,
          status: bakeCycles.status,
          targetProductionDate: bakeCycles.targetProductionDate,
          primaryDeliveryDate: bakeCycles.primaryDeliveryDate,
        })
        .from(bakeCycles)
        .where(
          and(
            eq(bakeCycles.ownerId, parsedOwnerId.data),
            included
              ? or(
                  inArray(bakeCycles.status, ["DRAFT", "OPEN"]),
                  eq(bakeCycles.id, included.bakeCycleId),
                )
              : inArray(bakeCycles.status, ["DRAFT", "OPEN"]),
          ),
        )
        .orderBy(
          desc(bakeCycles.primaryDeliveryDate),
          desc(bakeCycles.cycleNumber),
        );

      return {
        customers: customerRows,
        products: productRows,
        deliveryMethods: methodRows,
        bakeCycles: cycleRows,
      };
    },

    async create(ownerId: string, input: OrderInput): Promise<OrderDetail> {
      const parsed = parseOrderWrite(ownerId, input);
      return db.transaction(async (tx) => {
        await validateOwnedReferences(tx, parsed.ownerId, parsed.input);
        const { items, ...header } = parsed.input;
        const [order] = await tx
          .insert(orders)
          .values({
            ownerId: parsed.ownerId,
            ...header,
            paymentStatus: parsed.totals.paymentStatus,
          })
          .returning({ id: orders.id });
        if (!order) throw new Error("Failed to create order");
        await tx.insert(orderItems).values(
          items.map((item) => ({
            ownerId: parsed.ownerId,
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceSatang: item.unitPriceSatang,
            lineNote: item.lineNote ?? null,
          })),
        );
        return requireOrderDetail(tx, parsed.ownerId, order.id);
      });
    },

    async update(
      ownerId: string,
      orderId: string,
      input: OrderInput,
    ): Promise<OrderDetail> {
      const parsed = parseOrderWrite(ownerId, input);
      const parsedOrderId = uuidSchema.safeParse(orderId);
      if (!parsedOrderId.success) throw new Error("Order not found");

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ paymentStatus: orders.paymentStatus })
          .from(orders)
          .where(
            and(
              eq(orders.ownerId, parsed.ownerId),
              eq(orders.id, parsedOrderId.data),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("Order not found");

        await validateOwnedReferences(tx, parsed.ownerId, parsed.input);
        const { items, ...header } = parsed.input;
        await tx
          .update(orders)
          .set({
            ...header,
            paymentStatus:
              existing.paymentStatus === "REFUNDED"
                ? "REFUNDED"
                : parsed.totals.paymentStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orders.ownerId, parsed.ownerId),
              eq(orders.id, parsedOrderId.data),
            ),
          );
        await tx
          .delete(orderItems)
          .where(
            and(
              eq(orderItems.ownerId, parsed.ownerId),
              eq(orderItems.orderId, parsedOrderId.data),
            ),
          );
        await tx.insert(orderItems).values(
          items.map((item) => ({
            ownerId: parsed.ownerId,
            orderId: parsedOrderId.data,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceSatang: item.unitPriceSatang,
            lineNote: item.lineNote ?? null,
          })),
        );
        return requireOrderDetail(tx, parsed.ownerId, parsedOrderId.data);
      });
    },

    async get(ownerId: string, orderId: string): Promise<OrderDetail> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedOrderId = uuidSchema.safeParse(orderId);
      if (!parsedOwnerId.success || !parsedOrderId.success) {
        throw new Error("Order not found");
      }
      return requireOrderDetail(db, parsedOwnerId.data, parsedOrderId.data);
    },

    async list(
      ownerId: string,
      filters: OrderListFilters = {},
    ): Promise<ReadonlyArray<OrderDetail>> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedFilters = orderFiltersSchema.safeParse(filters);
      if (!parsedOwnerId.success || !parsedFilters.success) {
        throw new Error("Invalid order filters");
      }
      const query = parsedFilters.data.query;
      const matchingCustomerIds = query
        ? db
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.ownerId, parsedOwnerId.data),
                or(
                  ilike(customers.name, `%${query}%`),
                  ilike(customers.contactHandle, `%${query}%`),
                  ilike(customers.phone, `%${query}%`),
                ),
              ),
            )
        : undefined;
      const orderRows = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.ownerId, parsedOwnerId.data),
            parsedFilters.data.bakeCycleId
              ? eq(orders.bakeCycleId, parsedFilters.data.bakeCycleId)
              : undefined,
            parsedFilters.data.customerId
              ? eq(orders.customerId, parsedFilters.data.customerId)
              : undefined,
            parsedFilters.data.paymentStatus
              ? eq(orders.paymentStatus, parsedFilters.data.paymentStatus)
              : undefined,
            parsedFilters.data.fulfillmentStatus
              ? eq(
                  orders.fulfillmentStatus,
                  parsedFilters.data.fulfillmentStatus,
                )
              : undefined,
            query && matchingCustomerIds
              ? or(
                  inArray(orders.customerId, matchingCustomerIds),
                  ilike(orders.deliveryLocation, `%${query}%`),
                  ilike(orders.deliveryNote, `%${query}%`),
                  ilike(orders.specialInstructions, `%${query}%`),
                )
              : undefined,
          ),
        )
        .orderBy(desc(orders.createdAt));
      return buildOrderDetails(db, parsedOwnerId.data, orderRows);
    },

    updateFulfillmentStatus,

    async cancel(ownerId: string, orderId: string): Promise<OrderDetail> {
      return updateFulfillmentStatus(ownerId, orderId, "CANCELLED");
    },

    markRefunded,

    async restorePaymentTracking(
      ownerId: string,
      orderId: string,
    ): Promise<OrderDetail> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedOrderId = uuidSchema.safeParse(orderId);
      if (!parsedOwnerId.success || !parsedOrderId.success) {
        throw new Error("Order not found");
      }

      return db.transaction(async (tx) => {
        const detail = await requireOrderDetail(
          tx,
          parsedOwnerId.data,
          parsedOrderId.data,
        );
        await tx
          .update(orders)
          .set({
            paymentStatus: detail.totals.paymentStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orders.ownerId, parsedOwnerId.data),
              eq(orders.id, parsedOrderId.data),
            ),
          );
        return requireOrderDetail(
          tx,
          parsedOwnerId.data,
          parsedOrderId.data,
        );
      });
    },
  };
}
