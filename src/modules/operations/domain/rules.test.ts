import { describe, expect, it } from "vitest";
import {
  bucketOperationsTasks,
  buildOperationsCompletion,
  compareOperationsOrders,
  isPackingComplete,
} from "./rules";
import type { OperationsOrder, OperationsTask } from "./types";

function task(overrides: Partial<OperationsTask>): OperationsTask {
  return {
    id: "task",
    taskGenerationId: "generation",
    origin: "TEMPLATE",
    sourceTemplateName: null,
    sourceActivityName: null,
    title: "เตรียมแป้ง",
    productId: null,
    productName: null,
    batchCount: null,
    scheduledAt: new Date("2026-09-22T03:00:00.000Z"),
    estimatedDurationMinutes: 30,
    notes: null,
    sequence: 1,
    status: "PENDING",
    skipReason: null,
    ...overrides,
  };
}

function order(overrides: Partial<OperationsOrder>): OperationsOrder {
  return {
    id: "order",
    customerName: "Ada",
    confirmedDeliveryDate: "2026-09-23",
    confirmedDeliveryTime: null,
    deliveryMethodName: "Pickup",
    grandTotalSatang: 100_000,
    amountPaidSatang: 100_000,
    balanceSatang: 0,
    paymentStatus: "PAID",
    fulfillmentStatus: "DELIVERED",
    items: [
      {
        id: "item",
        productName: "Focaccia",
        quantity: 1,
        packedQuantity: 1,
        unitPriceSatang: 100_000,
        lineNote: null,
      },
    ],
    ...overrides,
  };
}

const TASKS = [
  task({ id: "future", scheduledAt: new Date("2026-09-23T17:00:00.000Z") }),
  task({ id: "today", scheduledAt: new Date("2026-09-22T19:00:00.000Z") }),
  task({ id: "late", scheduledAt: new Date("2026-09-22T03:00:00.000Z") }),
  task({ id: "midnight", scheduledAt: new Date("2026-09-22T17:00:00.000Z") }),
];

const TIMED_ORDER = order({ confirmedDeliveryTime: "09:00" });
const UNTIMED_ORDER = order({ confirmedDeliveryTime: null });

const DONE_TASKS = [
  task({ id: "done", status: "DONE" }),
  task({ id: "skipped", status: "SKIPPED", skipReason: "ไม่ต้องทำแล้ว" }),
];
const PENDING_TASKS = [task({ id: "pending", status: "PENDING" })];
const DELIVERED_PARTIAL_ORDERS = [
  order({
    paymentStatus: "PARTIAL",
    amountPaidSatang: 58_000,
    balanceSatang: 42_000,
  }),
];

describe("bucketOperationsTasks", () => {
  it("groups Bangkok overdue and today while keeping future collapsed data", () => {
    const buckets = bucketOperationsTasks(
      TASKS,
      new Date("2026-09-22T17:30:00.000Z"),
    );

    expect(buckets.overdue.map(({ id }) => id)).toEqual(["late"]);
    expect(buckets.today.map(({ id }) => id)).toEqual(["midnight", "today"]);
    expect(buckets.future.map(({ id }) => id)).toEqual(["future"]);
  });

  it("orders tasks by instant and then id within a Bangkok day", () => {
    const buckets = bucketOperationsTasks([
      task({ id: "z", scheduledAt: new Date("2026-09-22T17:00:00.000Z") }),
      task({ id: "a", scheduledAt: new Date("2026-09-22T17:00:00.000Z") }),
    ], new Date("2026-09-22T17:30:00.000Z"));

    expect(buckets.today.map(({ id }) => id)).toEqual(["a", "z"]);
  });
});

describe("compareOperationsOrders", () => {
  it("sorts a timed delivery before an untimed delivery on the same date", () => {
    expect([UNTIMED_ORDER, TIMED_ORDER].sort(compareOperationsOrders))
      .toEqual([TIMED_ORDER, UNTIMED_ORDER]);
  });

  it("uses delivery method, customer, and id to deterministically break ties", () => {
    const orders = [
      order({ id: "b", deliveryMethodName: "Delivery", customerName: "Bea" }),
      order({ id: "c", deliveryMethodName: "Delivery", customerName: "Ada" }),
      order({ id: "a", deliveryMethodName: "Delivery", customerName: "Ada" }),
      order({ id: "d", deliveryMethodName: "Pickup", customerName: "Ada" }),
    ];

    expect(orders.sort(compareOperationsOrders).map(({ id }) => id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });
});

describe("isPackingComplete", () => {
  it("requires at least one item and exact packed quantities", () => {
    expect(isPackingComplete([])).toBe(false);
    expect(isPackingComplete([
      { quantity: 2, packedQuantity: 2 },
      { quantity: 1, packedQuantity: 1 },
    ])).toBe(true);
    expect(isPackingComplete([{ quantity: 2, packedQuantity: 1 }])).toBe(false);
    expect(isPackingComplete([{ quantity: 2, packedQuantity: 3 }])).toBe(false);
  });
});

describe("buildOperationsCompletion", () => {
  it("allows completion with unpaid warnings but not unfinished work", () => {
    expect(buildOperationsCompletion(DONE_TASKS, DELIVERED_PARTIAL_ORDERS)).toEqual({
      ready: true,
      remainingTaskCount: 0,
      remainingOrderCount: 0,
      unpaidOrderCount: 1,
      outstandingSatang: 42_000,
    });
    expect(buildOperationsCompletion(PENDING_TASKS, DELIVERED_PARTIAL_ORDERS).ready)
      .toBe(false);
  });

  it("excludes cancelled orders while counting unfinished delivery and payment", () => {
    expect(buildOperationsCompletion([], [
      order({
        id: "cancelled",
        fulfillmentStatus: "CANCELLED",
        paymentStatus: "UNPAID",
        amountPaidSatang: 0,
        balanceSatang: 100_000,
      }),
      order({
        id: "pending-delivery",
        fulfillmentStatus: "PACKED",
        paymentStatus: "UNPAID",
        amountPaidSatang: 0,
        balanceSatang: 25_000,
      }),
    ])).toEqual({
      ready: false,
      remainingTaskCount: 0,
      remainingOrderCount: 1,
      unpaidOrderCount: 1,
      outstandingSatang: 25_000,
    });
  });

  it("rejects an outstanding total that exceeds the safe integer range", () => {
    expect(() => buildOperationsCompletion([], [
      order({ id: "one", paymentStatus: "PARTIAL", balanceSatang: Number.MAX_SAFE_INTEGER }),
      order({ id: "two", paymentStatus: "PARTIAL", balanceSatang: 1 }),
    ])).toThrow(RangeError);
  });
});
