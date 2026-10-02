import type {
  OperationsCompletion,
  OperationsOrder,
  OperationsOrderItem,
  OperationsTask,
  OperationsTaskBuckets,
} from "./types";

const bangkokDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function bangkokDateKey(value: Date): string {
  const parts = bangkokDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new RangeError("Could not format Bangkok date");
  return `${year}-${month}-${day}`;
}

function compareStrings(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function compareTasks(left: OperationsTask, right: OperationsTask): number {
  return left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.id.localeCompare(right.id);
}

export function bucketOperationsTasks(
  tasks: readonly OperationsTask[],
  now: Date,
): OperationsTaskBuckets {
  const today = bangkokDateKey(now);
  const overdue: OperationsTask[] = [];
  const todayTasks: OperationsTask[] = [];
  const future: OperationsTask[] = [];

  for (const task of tasks) {
    const taskDate = bangkokDateKey(task.scheduledAt);
    if (taskDate < today) overdue.push(task);
    else if (taskDate === today) todayTasks.push(task);
    else future.push(task);
  }

  return {
    overdue: overdue.sort(compareTasks),
    today: todayTasks.sort(compareTasks),
    future: future.sort(compareTasks),
  };
}

export function compareOperationsOrders(left: OperationsOrder, right: OperationsOrder): number {
  return compareStrings(left.confirmedDeliveryDate, right.confirmedDeliveryDate)
    || compareStrings(left.confirmedDeliveryTime, right.confirmedDeliveryTime)
    || compareStrings(left.deliveryMethodName, right.deliveryMethodName)
    || left.customerName.localeCompare(right.customerName)
    || left.id.localeCompare(right.id);
}

export function isPackingComplete(
  items: readonly Pick<OperationsOrderItem, "quantity" | "packedQuantity">[],
): boolean {
  return items.length > 0 && items.every((item) => item.packedQuantity === item.quantity);
}

function checkedOutstandingTotal(total: number, balanceSatang: number): number {
  if (!Number.isSafeInteger(balanceSatang) || balanceSatang < 0) {
    throw new RangeError("Outstanding balance must be a non-negative safe integer");
  }
  const next = total + balanceSatang;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError("Outstanding balance exceeds the safe integer range");
  }
  return next;
}

export function buildOperationsCompletion(
  tasks: readonly Pick<OperationsTask, "status">[],
  orders: readonly Pick<OperationsOrder, "fulfillmentStatus" | "paymentStatus" | "balanceSatang">[],
): OperationsCompletion {
  const remainingTaskCount = tasks.filter(
    (task) => task.status !== "DONE" && task.status !== "SKIPPED",
  ).length;
  const activeOrders = orders.filter((order) => order.fulfillmentStatus !== "CANCELLED");
  const remainingOrderCount = activeOrders.filter(
    (order) => order.fulfillmentStatus !== "DELIVERED",
  ).length;
  const unpaidOrders = activeOrders.filter(
    (order) => order.paymentStatus === "UNPAID" || order.paymentStatus === "PARTIAL",
  );
  const outstandingSatang = unpaidOrders.reduce(
    (total, order) => checkedOutstandingTotal(total, order.balanceSatang),
    0,
  );

  return {
    ready: remainingTaskCount === 0 && remainingOrderCount === 0,
    remainingTaskCount,
    remainingOrderCount,
    unpaidOrderCount: unpaidOrders.length,
    outstandingSatang,
  };
}
