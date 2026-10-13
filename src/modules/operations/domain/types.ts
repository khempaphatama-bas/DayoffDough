import type { ProductOption } from "@/modules/production/domain/types";

export const operationsErrorKinds = [
  "NOT_FOUND",
  "STALE_DATA",
  "INVALID_CYCLE_STATE",
  "INVALID_ORDER_STATE",
  "PACKING_INCOMPLETE",
  "PACKED_QUANTITY_OUT_OF_RANGE",
  "PAYMENT_OUT_OF_RANGE",
  "UNLOCK_BLOCKED_BY_OPERATIONS",
  "CYCLE_COMPLETION_BLOCKED",
] as const;

export type OperationsErrorKind = (typeof operationsErrorKinds)[number];

export class OperationsStateError extends Error {
  constructor(
    readonly kind: OperationsErrorKind,
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "OperationsStateError";
  }
}

export type OperationsClock = Readonly<{ now(): Date }>;

export type CycleOperationsHeader = Readonly<{
  id: string;
  cycleNumber: number;
  name: string;
  status: "DRAFT" | "OPEN" | "LOCKED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED";
  targetProductionDate: string;
  primaryDeliveryDate: string;
}>;

export type CycleOperationsOption = Readonly<{
  id: string;
  cycleNumber: number;
  name: string;
  status: CycleOperationsHeader["status"];
  primaryDeliveryDate: string;
}>;

export type OperationsTask = Readonly<{
  id: string;
  taskGenerationId: string;
  origin: "TEMPLATE" | "MANUAL";
  sourceTemplateName: string | null;
  sourceActivityName: string | null;
  title: string;
  productId: string | null;
  productName: string | null;
  batchCount: string | null;
  scheduledAt: Date;
  estimatedDurationMinutes: number;
  notes: string | null;
  sequence: number;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED";
  skipReason: string | null;
}>;

export type OperationsTaskBuckets = Readonly<{
  overdue: readonly OperationsTask[];
  today: readonly OperationsTask[];
  future: readonly OperationsTask[];
}>;

export type OperationsOrderItem = Readonly<{
  id: string;
  productName: string;
  quantity: number;
  packedQuantity: number;
  unitPriceSatang: number;
  lineNote: string | null;
}>;

export type OperationsOrder = Readonly<{
  id: string;
  customerName: string;
  confirmedDeliveryDate: string | null;
  confirmedDeliveryTime: string | null;
  deliveryMethodName: string | null;
  deliveryNote: string | null;
  specialInstructions: string | null;
  grandTotalSatang: number;
  amountPaidSatang: number;
  balanceSatang: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  fulfillmentStatus: "NEW" | "CONFIRMED" | "IN_PRODUCTION" | "PACKED" | "DELIVERED" | "CANCELLED";
  items: readonly OperationsOrderItem[];
}>;

export type OperationsCompletion = Readonly<{
  ready: boolean;
  remainingTaskCount: number;
  remainingOrderCount: number;
  unpaidOrderCount: number;
  outstandingSatang: number;
}>;

export type CycleOperationsView =
  | Readonly<{
      kind: "READY";
      cycle: CycleOperationsHeader;
      cycleOptions: readonly CycleOperationsOption[];
      generation: Readonly<{
        id: string;
        planningSnapshotId: string;
        generation: number;
      }>;
      tasks: readonly OperationsTask[];
      products: readonly ProductOption[];
      taskBuckets: OperationsTaskBuckets;
      orders: readonly OperationsOrder[];
      cancelledOrders: readonly OperationsOrder[];
      completion: OperationsCompletion;
    }>
  | Readonly<{
      kind: "NO_GENERATION";
      cycle: CycleOperationsHeader;
      cycleOptions: readonly CycleOperationsOption[];
      reason: "NO_ACTIVE_PLAN" | "LEGACY_PLAN";
    }>;
