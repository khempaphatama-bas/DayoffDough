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
import {
  lockOwnedBakeCycle,
  lockOwnedBakeCycles,
  lockOwnedOrder,
} from "@/lib/db/row-locks";
import { customers } from "@/modules/customers/db/schema";
import type { BakeCycleStatus } from "@/modules/cycles/application/cycles";
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
import {
  aggregateProductionDemand,
  type ProductDemand,
  type ProductionDemandLine,
} from "@/modules/orders/domain/production-demand";
import { products } from "@/modules/products/db/schema";
import type { UnitCode } from "@/modules/units/domain/units";

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
  cycleStatus: BakeCycleStatus;
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

export type CycleOrderSummary = Readonly<{
  activeOrderCount: number;
  cancelledOrderCount: number;
  grandTotalSatang: number;
  amountPaidSatang: number;
  balanceSatang: number;
  demand: ReadonlyArray<ProductDemand>;
}>;

const uuidSchema = z.string().uuid();
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const moneySchema = z.number().int().min(0).max(POSTGRES_INTEGER_MAX);
const orderItemSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1).max(POSTGRES_INTEGER_MAX),
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
const fulfillmentFlow: ReadonlyArray<OrderFulfillmentStatus> = [
  "NEW",
  "CONFIRMED",
  "IN_PRODUCTION",
  "PACKED",
  "DELIVERED",
];

type OrderRow = typeof orders.$inferSelect;
type OrderWriteInput = z.infer<typeof orderInputSchema>;
type QueryReader = Pick<DatabaseClient, "select">;
type OrderItemWriter = Pick<
  DatabaseClient,
  "select" | "update" | "insert"
>;

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

function isProductionEditable(status: BakeCycleStatus): boolean {
  return status === "DRAFT" || status === "OPEN";
}

function sameOrderItems(
  current: OrderDetail["items"],
  next: OrderWriteInput["items"],
): boolean {
  return (
    current.length === next.length &&
    current.every((item, index) => {
      const nextItem = next[index];
      return (
        nextItem !== undefined &&
        item.productId === nextItem.productId &&
        item.quantity === nextItem.quantity &&
        item.unitPriceSatang === nextItem.unitPriceSatang &&
        (item.lineNote ?? "") === (nextItem.lineNote ?? "")
      );
    })
  );
}

function productionInputChanged(
  current: OrderDetail,
  next: OrderWriteInput,
): boolean {
  return (
    current.customerId !== next.customerId ||
    current.bakeCycleId !== next.bakeCycleId ||
    current.sourceChannel !== next.sourceChannel ||
    current.requestedDeliveryDate !== next.requestedDeliveryDate ||
    current.confirmedDeliveryDate !== next.confirmedDeliveryDate ||
    current.deliveryMethodId !== next.deliveryMethodId ||
    (current.deliveryLocation ?? "") !== next.deliveryLocation ||
    (current.deliveryNote ?? "") !== next.deliveryNote ||
    (current.specialInstructions ?? "") !== next.specialInstructions ||
    current.deliveryFeeChargedSatang !== next.deliveryFeeChargedSatang ||
    current.deliveryCostSatang !== next.deliveryCostSatang ||
    current.deliveryFeePayer !== next.deliveryFeePayer ||
    current.discountSatang !== next.discountSatang ||
    !sameOrderItems(current.items, next.items)
  );
}

function checkedSummaryAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Cycle summary exceeds the safe integer range");
  }
  return total;
}

function emptyCycleSummary(): CycleOrderSummary {
  return {
    activeOrderCount: 0,
    cancelledOrderCount: 0,
    grandTotalSatang: 0,
    amountPaidSatang: 0,
    balanceSatang: 0,
    demand: [],
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

  const [customerRows, cycleRows, methodRows, itemRows] = await Promise.all([
    reader
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(
        and(
          eq(customers.ownerId, ownerId),
          inArray(customers.id, customerIds),
        ),
      ),
    reader
      .select({
        id: bakeCycles.id,
        name: bakeCycles.name,
        status: bakeCycles.status,
      })
      .from(bakeCycles)
      .where(
        and(
          eq(bakeCycles.ownerId, ownerId),
          inArray(bakeCycles.id, cycleIds),
        ),
      ),
    deliveryMethodIds.length === 0
      ? Promise.resolve([])
      : reader
          .select({ id: deliveryMethods.id, name: deliveryMethods.name })
          .from(deliveryMethods)
          .where(
            and(
              eq(deliveryMethods.ownerId, ownerId),
              inArray(deliveryMethods.id, deliveryMethodIds),
            ),
          ),
    reader
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.ownerId, ownerId),
          inArray(orderItems.orderId, orderIds),
          eq(orderItems.active, true),
        ),
      )
      .orderBy(
        asc(orderItems.orderId),
        asc(orderItems.position),
        asc(orderItems.id),
      ),
  ]);
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
  const cycleStatusById = new Map(
    cycleRows.map((cycle) => [cycle.id, cycle.status]),
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
      cycleStatus: cycleStatusById.get(order.bakeCycleId) ?? "CANCELLED",
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

type LockedBakeCycle = NonNullable<
  Awaited<ReturnType<typeof lockOwnedBakeCycle>>
>;

async function lockExistingOrderAndCycles(
  reader: QueryReader,
  ownerId: string,
  orderId: string,
  requestedCycleId?: string,
): Promise<Readonly<{
  order: OrderRow;
  cyclesById: ReadonlyMap<string, LockedBakeCycle>;
}>> {
  const [observed] = await reader
    .select({ id: orders.id, bakeCycleId: orders.bakeCycleId })
    .from(orders)
    .where(and(eq(orders.ownerId, ownerId), eq(orders.id, orderId)))
    .limit(1);
  if (!observed) throw new Error("Order not found");

  const cycleIds = [
    observed.bakeCycleId,
    ...(requestedCycleId === undefined ? [] : [requestedCycleId]),
  ];
  const expectedCycleIds = [...new Set(cycleIds)];
  const lockedCycles = await lockOwnedBakeCycles(
    reader,
    ownerId,
    expectedCycleIds,
  );
  if (lockedCycles.length !== expectedCycleIds.length) {
    throw new Error("Cycle not found");
  }

  const order = await lockOwnedOrder(reader, ownerId, orderId);
  if (!order) throw new Error("Order not found");
  if (order.bakeCycleId !== observed.bakeCycleId) {
    throw new Error("Order changed while locking");
  }
  return {
    order,
    cyclesById: new Map(lockedCycles.map((cycle) => [cycle.id, cycle])),
  };
}

async function reconcileOrderItems(
  writer: OrderItemWriter,
  ownerId: string,
  orderId: string,
  currentItems: OrderDetail["items"],
  nextItems: OrderWriteInput["items"],
): Promise<void> {
  const archivedIds = currentItems.flatMap((current, position) => {
    const next = nextItems[position];
    return next?.productId === current.productId ? [] : [current.id];
  });
  if (archivedIds.length > 0) {
    await writer
      .update(orderItems)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(orderItems.ownerId, ownerId),
          eq(orderItems.orderId, orderId),
          inArray(orderItems.id, archivedIds),
          eq(orderItems.active, true),
        ),
      );
  }

  for (const [position, next] of nextItems.entries()) {
    const current = currentItems[position];
    if (current?.productId === next.productId) {
      const [updated] = await writer
        .update(orderItems)
        .set({
          quantity: next.quantity,
          unitPriceSatang: next.unitPriceSatang,
          lineNote: next.lineNote ?? null,
          position,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orderItems.ownerId, ownerId),
            eq(orderItems.orderId, orderId),
            eq(orderItems.id, current.id),
            eq(orderItems.active, true),
          ),
        )
        .returning({ id: orderItems.id });
      if (!updated) throw new Error("Order items changed");
      continue;
    }
    await writer.insert(orderItems).values({
      ownerId,
      orderId,
      productId: next.productId,
      quantity: next.quantity,
      unitPriceSatang: next.unitPriceSatang,
      lineNote: next.lineNote ?? null,
      position,
      active: true,
    });
  }
}

export function createOrderService(db: DatabaseClient) {
  async function listCycleSummaries(
    ownerId: string,
    cycleIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, CycleOrderSummary>> {
    const parsedOwnerId = uuidSchema.safeParse(ownerId);
    const parsedCycleIds = z.array(uuidSchema).safeParse(cycleIds);
    if (!parsedOwnerId.success || !parsedCycleIds.success) {
      throw new Error("Cycle not found");
    }
    const uniqueCycleIds = [...new Set(parsedCycleIds.data)];
    if (uniqueCycleIds.length === 0) return new Map();

    const cycleRows = await db
      .select({ id: bakeCycles.id })
      .from(bakeCycles)
      .where(
        and(
          eq(bakeCycles.ownerId, parsedOwnerId.data),
          inArray(bakeCycles.id, uniqueCycleIds),
        ),
      );
    if (cycleRows.length !== uniqueCycleIds.length) {
      throw new Error("Cycle not found");
    }

    const summaryByCycleId = new Map<string, CycleOrderSummary>(
      uniqueCycleIds.map((cycleId) => [cycleId, emptyCycleSummary()]),
    );
    const orderRows = await db
      .select({
        id: orders.id,
        bakeCycleId: orders.bakeCycleId,
        fulfillmentStatus: orders.fulfillmentStatus,
        deliveryFeeChargedSatang: orders.deliveryFeeChargedSatang,
        discountSatang: orders.discountSatang,
        amountPaidSatang: orders.amountPaidSatang,
      })
      .from(orders)
      .where(
        and(
          eq(orders.ownerId, parsedOwnerId.data),
          inArray(orders.bakeCycleId, uniqueCycleIds),
        ),
      );
    if (orderRows.length === 0) return summaryByCycleId;

    const orderIds = orderRows.map((order) => order.id);
    const itemRows = await db
      .select({
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        unitPriceSatang: orderItems.unitPriceSatang,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.ownerId, parsedOwnerId.data),
          inArray(orderItems.orderId, orderIds),
          eq(orderItems.active, true),
        ),
      );
    const productIds = [...new Set(itemRows.map((item) => item.productId))];
    const productRows =
      productIds.length === 0
        ? []
        : await db
            .select({
              id: products.id,
              name: products.name,
              sellingUnit: products.sellingUnit,
            })
            .from(products)
            .where(
              and(
                eq(products.ownerId, parsedOwnerId.data),
                inArray(products.id, productIds),
              ),
            );
    if (productRows.length !== productIds.length) {
      throw new Error("Product not found");
    }
    const productById = new Map(
      productRows.map((product) => [product.id, product]),
    );
    const itemsByOrderId = new Map<
      string,
      Array<(typeof itemRows)[number]>
    >();
    for (const item of itemRows) {
      const grouped = itemsByOrderId.get(item.orderId);
      if (grouped) grouped.push(item);
      else itemsByOrderId.set(item.orderId, [item]);
    }
    const demandLinesByCycleId = new Map<string, ProductionDemandLine[]>();

    for (const order of orderRows) {
      const previous = summaryByCycleId.get(order.bakeCycleId);
      if (!previous) throw new Error("Cycle not found");
      const status = order.fulfillmentStatus as OrderFulfillmentStatus;
      const items = itemsByOrderId.get(order.id) ?? [];
      const demandLines = demandLinesByCycleId.get(order.bakeCycleId) ?? [];
      for (const item of items) {
        const product = productById.get(item.productId);
        if (!product) throw new Error("Product not found");
        demandLines.push({
          productId: item.productId,
          productName: product.name,
          sellingUnit: product.sellingUnit as UnitCode,
          quantity: item.quantity,
          fulfillmentStatus: status,
        });
      }
      demandLinesByCycleId.set(order.bakeCycleId, demandLines);

      if (status === "CANCELLED") {
        summaryByCycleId.set(order.bakeCycleId, {
          ...previous,
          cancelledOrderCount: checkedSummaryAdd(
            previous.cancelledOrderCount,
            1,
          ),
        });
        continue;
      }

      const totals = calculateOrderTotals({
        items,
        discountSatang: order.discountSatang,
        deliveryFeeChargedSatang: order.deliveryFeeChargedSatang,
        amountPaidSatang: order.amountPaidSatang,
      });
      summaryByCycleId.set(order.bakeCycleId, {
        ...previous,
        activeOrderCount: checkedSummaryAdd(previous.activeOrderCount, 1),
        grandTotalSatang: checkedSummaryAdd(
          previous.grandTotalSatang,
          totals.grandTotalSatang,
        ),
        amountPaidSatang: checkedSummaryAdd(
          previous.amountPaidSatang,
          order.amountPaidSatang,
        ),
        balanceSatang: checkedSummaryAdd(
          previous.balanceSatang,
          totals.balanceSatang,
        ),
      });
    }

    for (const cycleId of uniqueCycleIds) {
      const summary = summaryByCycleId.get(cycleId);
      if (!summary) throw new Error("Cycle not found");
      summaryByCycleId.set(cycleId, {
        ...summary,
        demand: aggregateProductionDemand(
          demandLinesByCycleId.get(cycleId) ?? [],
        ),
      });
    }
    return summaryByCycleId;
  }

  async function transitionFulfillmentStatus(
    ownerId: string,
    orderId: string,
    status: OrderFulfillmentStatus,
    explicitCancellation: boolean,
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
      const locked = await lockExistingOrderAndCycles(
        tx,
        parsedOwnerId.data,
        parsedOrderId.data,
      );
      const existing = locked.order;
      const cycle = locked.cyclesById.get(existing.bakeCycleId);
      if (!cycle) throw new Error("Cycle not found");
      if (explicitCancellation && !isProductionEditable(cycle.status)) {
        throw new Error("Cycle production inputs are locked");
      }

      const currentStatus =
        existing.fulfillmentStatus as OrderFulfillmentStatus;
      const currentIndex = fulfillmentFlow.indexOf(currentStatus);
      const nextIndex = fulfillmentFlow.indexOf(parsedStatus.data);
      const canCancel =
        explicitCancellation &&
        parsedStatus.data === "CANCELLED" &&
        currentStatus !== "CANCELLED" &&
        currentStatus !== "DELIVERED";
      const canMoveForward =
        !explicitCancellation &&
        parsedStatus.data !== "CANCELLED" &&
        currentIndex >= 0 &&
        nextIndex > currentIndex;
      if (!canCancel && !canMoveForward) {
        throw new Error("Invalid fulfillment transition");
      }

      const [updated] = await tx
        .update(orders)
        .set({ fulfillmentStatus: parsedStatus.data, updatedAt: new Date() })
        .where(
          and(
            eq(orders.ownerId, parsedOwnerId.data),
            eq(orders.id, parsedOrderId.data),
            eq(orders.fulfillmentStatus, existing.fulfillmentStatus),
          ),
        )
        .returning({ id: orders.id });
      if (!updated) throw new Error("Invalid fulfillment transition");
      return requireOrderDetail(
        tx,
        parsedOwnerId.data,
        parsedOrderId.data,
      );
    });
  }

  async function updateFulfillmentStatus(
    ownerId: string,
    orderId: string,
    status: OrderFulfillmentStatus,
  ): Promise<OrderDetail> {
    return transitionFulfillmentStatus(ownerId, orderId, status, false);
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
      const { order: existing } = await lockExistingOrderAndCycles(
        tx,
        parsedOwnerId.data,
        parsedOrderId.data,
      );
      if (!existing) throw new Error("Order not found");

      const [updated] = await tx
        .update(orders)
        .set({ paymentStatus: "REFUNDED", updatedAt: new Date() })
        .where(
          and(
            eq(orders.ownerId, parsedOwnerId.data),
            eq(orders.id, parsedOrderId.data),
            eq(orders.paymentStatus, existing.paymentStatus),
          ),
        )
        .returning({ id: orders.id });
      if (!updated) throw new Error("Payment status changed");
      return requireOrderDetail(
        tx,
        parsedOwnerId.data,
        parsedOrderId.data,
      );
    });
  }

  return {
    async getCycleSummary(
      ownerId: string,
      cycleId: string,
    ): Promise<CycleOrderSummary> {
      const summaries = await listCycleSummaries(ownerId, [cycleId]);
      const summary = summaries.get(cycleId);
      if (!summary) throw new Error("Cycle not found");
      return summary;
    },

    listCycleSummaries,

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

      const [customerRows, productRows, methodRows, cycleRows] =
        await Promise.all([
          db
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
            .orderBy(asc(customers.name)),
          db
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
            .orderBy(asc(products.name)),
          db
            .select({
              id: deliveryMethods.id,
              name: deliveryMethods.name,
              defaultCustomerFeeSatang:
                deliveryMethods.defaultCustomerFeeSatang,
              defaultInternalCostSatang:
                deliveryMethods.defaultInternalCostSatang,
              requiresDeliveryLocation:
                deliveryMethods.requiresDeliveryLocation,
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
            .orderBy(asc(deliveryMethods.name)),
          db
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
            ),
        ]);

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
        const [cycle] = await lockOwnedBakeCycles(
          tx,
          parsed.ownerId,
          [parsed.input.bakeCycleId],
        );
        if (!cycle) throw new Error("Cycle not found");
        if (!isProductionEditable(cycle.status)) {
          throw new Error("Cycle production inputs are locked");
        }
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
          items.map((item, position) => ({
            ownerId: parsed.ownerId,
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceSatang: item.unitPriceSatang,
            lineNote: item.lineNote ?? null,
            position,
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
        const locked = await lockExistingOrderAndCycles(
          tx,
          parsed.ownerId,
          parsedOrderId.data,
          parsed.input.bakeCycleId,
        );
        const existing = locked.order;
        const current = await requireOrderDetail(
          tx,
          parsed.ownerId,
          parsedOrderId.data,
        );
        const productionChanged = productionInputChanged(
          current,
          parsed.input,
        );
        const itemsChanged = !sameOrderItems(current.items, parsed.input.items);
        if (productionChanged) {
          const sourceCycle = locked.cyclesById.get(existing.bakeCycleId);
          const destinationCycle = locked.cyclesById.get(
            parsed.input.bakeCycleId,
          );
          if (!sourceCycle || !destinationCycle) {
            throw new Error("Cycle not found");
          }
          if (
            !isProductionEditable(sourceCycle.status) ||
            !isProductionEditable(destinationCycle.status)
          ) {
            throw new Error("Cycle production inputs are locked");
          }
        }

        await validateOwnedReferences(tx, parsed.ownerId, parsed.input);
        const { items, ...header } = parsed.input;
        const [updated] = await tx
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
              eq(orders.bakeCycleId, existing.bakeCycleId),
              eq(orders.paymentStatus, existing.paymentStatus),
            ),
          )
          .returning({ id: orders.id });
        if (!updated) throw new Error("Payment status changed");
        if (itemsChanged) {
          await reconcileOrderItems(
            tx,
            parsed.ownerId,
            parsedOrderId.data,
            current.items,
            items,
          );
        }
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
      return transitionFulfillmentStatus(ownerId, orderId, "CANCELLED", true);
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
        const { order: existing } = await lockExistingOrderAndCycles(
          tx,
          parsedOwnerId.data,
          parsedOrderId.data,
        );
        if (!existing) throw new Error("Order not found");
        const detail = await requireOrderDetail(
          tx,
          parsedOwnerId.data,
          parsedOrderId.data,
        );
        const [updated] = await tx
          .update(orders)
          .set({
            paymentStatus: detail.totals.paymentStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orders.ownerId, parsedOwnerId.data),
              eq(orders.id, parsedOrderId.data),
              eq(orders.paymentStatus, existing.paymentStatus),
            ),
          )
          .returning({ id: orders.id });
        if (!updated) throw new Error("Payment status changed");
        return requireOrderDetail(
          tx,
          parsedOwnerId.data,
          parsedOrderId.data,
        );
      });
    },
  };
}
