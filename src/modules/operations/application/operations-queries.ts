import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { customers } from "@/modules/customers/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import { normalizeConfirmedDeliveryTime } from "@/modules/orders/domain/order-form";
import { calculateOrderTotals } from "@/modules/orders/domain/totals";
import { orderItemPackingProgress } from "@/modules/operations/db/schema";
import { bucketOperationsTasks, buildOperationsCompletion, compareOperationsOrders } from "@/modules/operations/domain/rules";
import {
  OperationsStateError,
  type CycleOperationsHeader,
  type CycleOperationsOption,
  type CycleOperationsView,
  type OperationsClock,
  type OperationsOrder,
  type OperationsTask,
} from "@/modules/operations/domain/types";
import {
  cycleOrderItemSnapshots,
  cycleOrderSnapshots,
  cyclePlanningSnapshots,
} from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import { cycleConsumptionContexts } from "@/modules/consumption/db/schema";
import { loadConsumptionSource } from "@/modules/consumption/application/load-consumption-source";
import { cycleInventoryCounts } from "@/modules/shopping/db/schema";

const uuidSchema = z.string().uuid();
const SYSTEM_CLOCK: OperationsClock = { now: () => new Date() };
const statusRank = { IN_PRODUCTION: 0, LOCKED: 1 } as const;

export function compareOperationsCycles(
  left: Pick<CycleOperationsOption, "id" | "status" | "primaryDeliveryDate" | "cycleNumber">,
  right: Pick<CycleOperationsOption, "id" | "status" | "primaryDeliveryDate" | "cycleNumber">,
): number {
  return statusRank[left.status as keyof typeof statusRank] - statusRank[right.status as keyof typeof statusRank]
    || left.primaryDeliveryDate.localeCompare(right.primaryDeliveryDate)
    || left.cycleNumber - right.cycleNumber
    || left.id.localeCompare(right.id);
}

function notFound(): never {
  throw new OperationsStateError("NOT_FOUND", "Operations cycle not found");
}

function staleData(): never {
  throw new OperationsStateError("STALE_DATA", "Operations snapshot is stale");
}

function toHeader(
  cycle: typeof bakeCycles.$inferSelect,
  snapshot?: typeof cyclePlanningSnapshots.$inferSelect,
): CycleOperationsHeader {
  return {
    id: cycle.id,
    cycleNumber: snapshot?.cycleNumber ?? cycle.cycleNumber,
    name: snapshot?.cycleName ?? cycle.name,
    status: cycle.status,
    targetProductionDate: snapshot?.targetProductionDate ?? cycle.targetProductionDate,
    primaryDeliveryDate: snapshot?.primaryDeliveryDate ?? cycle.primaryDeliveryDate,
  };
}

function toOption(cycle: typeof bakeCycles.$inferSelect): CycleOperationsOption {
  return {
    id: cycle.id,
    cycleNumber: cycle.cycleNumber,
    name: cycle.name,
    status: cycle.status,
    primaryDeliveryDate: cycle.primaryDeliveryDate,
  };
}

function toTask(row: typeof cycleTasks.$inferSelect): OperationsTask {
  return {
    id: row.id,
    taskGenerationId: row.cycleTaskGenerationId,
    origin: row.origin,
    sourceTemplateName: row.sourceTemplateName,
    sourceActivityName: row.sourceActivityName,
    title: row.title,
    productId: row.productId,
    productName: row.productName,
    batchCount: row.batchCount?.toString() ?? null,
    scheduledAt: row.scheduledAt,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    notes: row.notes,
    sequence: row.sequence,
    status: row.status,
    skipReason: row.skipReason,
  };
}

function compareTasks(left: OperationsTask, right: OperationsTask): number {
  return left.scheduledAt.getTime() - right.scheduledAt.getTime()
    || left.sequence - right.sequence
    || (left.productName ?? "").localeCompare(right.productName ?? "")
    || left.id.localeCompare(right.id);
}

function time(value: string | null): string | null {
  return value === null ? null : normalizeConfirmedDeliveryTime(value);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((id) => rightSet.has(id));
}

export function createOperationsQueryService(
  db: DatabaseClient,
  clock: OperationsClock = SYSTEM_CLOCK,
) {
  return {
    async getCycleOperations(ownerId: string, cycleId: string): Promise<CycleOperationsView> {
      const parsedOwner = uuidSchema.safeParse(ownerId);
      const parsedCycle = uuidSchema.safeParse(cycleId);
      if (!parsedOwner.success || !parsedCycle.success) notFound();
      const verifiedOwnerId = parsedOwner.data;
      const verifiedCycleId = parsedCycle.data;
      const [cycle] = await db.select().from(bakeCycles).where(and(
        eq(bakeCycles.ownerId, verifiedOwnerId),
        eq(bakeCycles.id, verifiedCycleId),
      )).limit(1);
      if (!cycle) notFound();

      const candidateCycles = await db.select().from(bakeCycles).where(and(
        eq(bakeCycles.ownerId, verifiedOwnerId),
        inArray(bakeCycles.status, ["LOCKED", "IN_PRODUCTION"]),
      ));
      const cycleOptions = candidateCycles.sort(compareOperationsCycles).map(toOption);
      if ((cycle.status === "COMPLETED" || cycle.status === "CANCELLED")
        && !cycleOptions.some((option) => option.id === cycle.id)) {
        cycleOptions.push(toOption(cycle));
      }

      if (!cycle.activePlanningSnapshotId) {
        return {
          kind: "NO_GENERATION",
          cycle: toHeader(cycle),
          cycleOptions,
          reason: "NO_ACTIVE_PLAN",
        };
      }
      const [snapshot] = await db.select().from(cyclePlanningSnapshots).where(and(
        eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
        eq(cyclePlanningSnapshots.bakeCycleId, verifiedCycleId),
        eq(cyclePlanningSnapshots.id, cycle.activePlanningSnapshotId),
      )).limit(1);
      if (!snapshot) {
        return {
          kind: "NO_GENERATION",
          cycle: toHeader(cycle),
          cycleOptions,
          reason: "NO_ACTIVE_PLAN",
        };
      }
      const [taskGeneration] = await db.select().from(cycleTaskGenerations).where(and(
        eq(cycleTaskGenerations.ownerId, verifiedOwnerId),
        eq(cycleTaskGenerations.bakeCycleId, verifiedCycleId),
        eq(cycleTaskGenerations.planningSnapshotId, snapshot.id),
      )).limit(1);
      if (!taskGeneration) {
        return {
          kind: "NO_GENERATION",
          cycle: toHeader(cycle, snapshot),
          cycleOptions,
          reason: "LEGACY_PLAN",
        };
      }

      const [taskRows, snapshotOrders, snapshotItems, liveOrders, productOptions] = await Promise.all([
        db.select().from(cycleTasks).where(and(
          eq(cycleTasks.ownerId, verifiedOwnerId),
          eq(cycleTasks.cycleTaskGenerationId, taskGeneration.id),
          isNull(cycleTasks.deletedAt),
        )),
        db.select().from(cycleOrderSnapshots).where(and(
          eq(cycleOrderSnapshots.ownerId, verifiedOwnerId),
          eq(cycleOrderSnapshots.planningSnapshotId, snapshot.id),
        )),
        db.select().from(cycleOrderItemSnapshots).where(and(
          eq(cycleOrderItemSnapshots.ownerId, verifiedOwnerId),
          eq(cycleOrderItemSnapshots.planningSnapshotId, snapshot.id),
        )),
        db.select().from(orders).where(and(
          eq(orders.ownerId, verifiedOwnerId),
          eq(orders.bakeCycleId, verifiedCycleId),
        )),
        db.select({ id: products.id, name: products.name }).from(products)
          .where(and(eq(products.ownerId, verifiedOwnerId), eq(products.active, true)))
          .orderBy(asc(products.name), asc(products.id)),
      ]);
      const tasks = taskRows.map(toTask).sort(compareTasks);
      const activeLiveOrders = liveOrders.filter((row) => row.fulfillmentStatus !== "CANCELLED");
      if (!sameIds(activeLiveOrders.map((row) => row.id), snapshotOrders.map((row) => row.sourceOrderId))) {
        staleData();
      }

      const liveOrderIds = liveOrders.map((row) => row.id);
      const liveItems = liveOrderIds.length === 0 ? [] : await db.select().from(orderItems).where(and(
        eq(orderItems.ownerId, verifiedOwnerId),
        inArray(orderItems.orderId, liveOrderIds),
      ));
      const liveItemIds = liveItems.map((row) => row.id);
      const customerIds = [...new Set(liveOrders.map((row) => row.customerId))];
      const productIds = [...new Set(liveItems.map((row) => row.productId))];
      const methodIds = [...new Set(liveOrders.map((row) => row.deliveryMethodId).filter((id): id is string => id !== null))];
      const [packingRows, customerRows, productRows, methodRows] = await Promise.all([
        liveItemIds.length === 0 ? Promise.resolve([]) : db.select().from(orderItemPackingProgress).where(and(
          eq(orderItemPackingProgress.ownerId, verifiedOwnerId),
          inArray(orderItemPackingProgress.orderItemId, liveItemIds),
        )),
        customerIds.length === 0 ? Promise.resolve([]) : db.select().from(customers).where(and(
          eq(customers.ownerId, verifiedOwnerId), inArray(customers.id, customerIds),
        )),
        productIds.length === 0 ? Promise.resolve([]) : db.select().from(products).where(and(
          eq(products.ownerId, verifiedOwnerId), inArray(products.id, productIds),
        )),
        methodIds.length === 0 ? Promise.resolve([]) : db.select().from(deliveryMethods).where(and(
          eq(deliveryMethods.ownerId, verifiedOwnerId), inArray(deliveryMethods.id, methodIds),
        )),
      ]);
      const liveOrderById = new Map(liveOrders.map((row) => [row.id, row]));
      const liveItemById = new Map(liveItems.map((row) => [row.id, row]));
      const packingByItemId = new Map(packingRows.map((row) => [row.orderItemId, row.packedQuantity]));
      const customersById = new Map(customerRows.map((row) => [row.id, row.name]));
      const productsById = new Map(productRows.map((row) => [row.id, row.name]));
      const methodsById = new Map(methodRows.map((row) => [row.id, row.name]));
      const snapshotItemsByOrderId = new Map<string, typeof snapshotItems>();
      for (const row of snapshotItems) {
        const group = snapshotItemsByOrderId.get(row.sourceOrderId) ?? [];
        group.push(row);
        snapshotItemsByOrderId.set(row.sourceOrderId, group);
      }

      const activeOrders: OperationsOrder[] = snapshotOrders.map((row) => {
        const live = liveOrderById.get(row.sourceOrderId);
        if (!live || live.fulfillmentStatus === "CANCELLED") staleData();
        const items = snapshotItemsByOrderId.get(row.sourceOrderId) ?? [];
        const activeItems = liveItems.filter((item) => item.orderId === live.id && item.active);
        if (!sameIds(items.map((item) => item.sourceOrderItemId), activeItems.map((item) => item.id))) staleData();
        const viewItems = items.map((item) => {
          const liveItem = liveItemById.get(item.sourceOrderItemId);
          if (!liveItem || liveItem.orderId !== live.id || !liveItem.active) staleData();
          return {
            id: item.sourceOrderItemId,
            productName: item.productName,
            quantity: item.quantity,
            packedQuantity: packingByItemId.get(item.sourceOrderItemId) ?? 0,
            unitPriceSatang: item.unitPriceSatang,
            lineNote: item.lineNote,
          };
        });
        return {
          id: live.id,
          customerName: row.customerName,
          confirmedDeliveryDate: row.confirmedDeliveryDate,
          confirmedDeliveryTime: time(row.confirmedDeliveryTime),
          deliveryMethodName: row.deliveryMethodName,
          deliveryNote: row.deliveryNote,
          specialInstructions: row.specialInstructions,
          grandTotalSatang: row.grandTotalSatang,
          amountPaidSatang: live.amountPaidSatang,
          balanceSatang: Math.max(row.grandTotalSatang - live.amountPaidSatang, 0),
          paymentStatus: live.paymentStatus,
          fulfillmentStatus: live.fulfillmentStatus,
          items: viewItems,
        };
      }).sort(compareOperationsOrders);

      const cancelledOrders: OperationsOrder[] = liveOrders
        .filter((row) => row.fulfillmentStatus === "CANCELLED")
        .map((row) => {
          const activeItems = liveItems.filter((item) => item.orderId === row.id && item.active)
            .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
          const totals = calculateOrderTotals({
            items: activeItems,
            discountSatang: row.discountSatang,
            deliveryFeeChargedSatang: row.deliveryFeeChargedSatang,
            amountPaidSatang: row.amountPaidSatang,
          });
          const customerName = customersById.get(row.customerId);
          if (!customerName) staleData();
          return {
            id: row.id,
            customerName,
            confirmedDeliveryDate: row.confirmedDeliveryDate,
            confirmedDeliveryTime: time(row.confirmedDeliveryTime),
            deliveryMethodName: row.deliveryMethodId ? methodsById.get(row.deliveryMethodId) ?? null : null,
            deliveryNote: row.deliveryNote,
            specialInstructions: row.specialInstructions,
            grandTotalSatang: totals.grandTotalSatang,
            amountPaidSatang: row.amountPaidSatang,
            balanceSatang: totals.balanceSatang,
            paymentStatus: row.paymentStatus,
            fulfillmentStatus: row.fulfillmentStatus,
            items: activeItems.map((item) => {
              const productName = productsById.get(item.productId);
              if (!productName) staleData();
              return {
                id: item.id,
                productName,
                quantity: item.quantity,
                packedQuantity: packingByItemId.get(item.id) ?? 0,
                unitPriceSatang: item.unitPriceSatang,
                lineNote: item.lineNote,
              };
            }),
          };
        }).sort(compareOperationsOrders);

      const consumptionRequired = cycle.consumptionPolicy === "CONSUMPTION_V1";
      const [consumptionContext] = consumptionRequired ? await db.select().from(cycleConsumptionContexts).where(and(
        eq(cycleConsumptionContexts.ownerId, verifiedOwnerId), eq(cycleConsumptionContexts.bakeCycleId, cycle.id),
        eq(cycleConsumptionContexts.planningSnapshotId, snapshot.id),
      )).limit(1) : [];
      let startBlockedByStockCheck = false;
      if (consumptionRequired && cycle.status === "LOCKED") {
        const source = await loadConsumptionSource(db, verifiedOwnerId, snapshot.id);
        const counts = await db.select().from(cycleInventoryCounts).where(and(
          eq(cycleInventoryCounts.ownerId, verifiedOwnerId), eq(cycleInventoryCounts.bakeCycleId, cycle.id),
          eq(cycleInventoryCounts.planningSnapshotId, snapshot.id),
        ));
        startBlockedByStockCheck = !sameIds(source.map((i) => i.inventoryItemId), counts.map((i) => i.inventoryItemId));
      }

      return {
        kind: "READY",
        cycle: toHeader(cycle, snapshot),
        cycleOptions,
        generation: {
          id: taskGeneration.id,
          planningSnapshotId: snapshot.id,
          generation: taskGeneration.generation,
        },
        tasks,
        products: productOptions,
        taskBuckets: bucketOperationsTasks(tasks, clock.now()),
        orders: activeOrders,
        cancelledOrders,
        completion: buildOperationsCompletion(tasks, activeOrders),
        consumption: { required: consumptionRequired, recorded: consumptionContext?.currentRevisionId != null, startBlockedByStockCheck },
      };
    },
  };
}
