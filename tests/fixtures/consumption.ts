import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { createCycleOperationsCommandService } from "@/modules/operations/application/cycle-commands";
import { cycleTaskGenerations, productionTemplates, productionTemplateActivities } from "@/modules/production/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { loadShoppingSource } from "@/modules/shopping/application/load-shopping-source";
import { createShoppingCommandService } from "@/modules/shopping/application/shopping-commands";
import { OWNER_ID } from "./owner";
import { seedLockedPlanningScenario } from "./planning";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { cycleConsumptionContexts, cycleConsumptionItems } from "@/modules/consumption/db/schema";
import type { ConfirmUseInput } from "@/modules/consumption/domain/types";
import { canonicalQuantity } from "@/modules/consumption/domain/rules";
import { canonicalizeUseRequest } from "@/modules/consumption/domain/request-manifest";
import type { PreparedConsumptionOperation } from "@/modules/consumption/application/command-support";
import { orders, orderItems } from "@/modules/orders/db/schema";
import { products, recipes, recipeVersions } from "@/modules/products/db/schema";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { inventoryMovements } from "@/modules/inventory/db/schema";
import { StorageDecimal } from "@/modules/shopping/domain/storage";

// Complete legitimate initial-use rows for raw SQL integrity tests. Quantities
// follow the immutable source, and callers mutate only the attack under test.
export async function prepareConsumptionFixture(db: DatabaseClient, ownerId: string, cycleId: string) {
  const [context] = await db.select().from(cycleConsumptionContexts).where(and(eq(cycleConsumptionContexts.ownerId, ownerId), eq(cycleConsumptionContexts.bakeCycleId, cycleId)));
  if (!context) throw new Error("Fixture requires a started consumption context");
  const source = await db.select().from(cycleConsumptionItems).where(and(eq(cycleConsumptionItems.ownerId, ownerId), eq(cycleConsumptionItems.contextId, context.id))).orderBy(cycleConsumptionItems.inventoryItemId);
  const ledger = await readStockLedger(db, ownerId, source.map((row) => row.inventoryItemId));
  const input: ConfirmUseInput = { cycleId, planningSnapshotId: context.planningSnapshotId, contextId: context.id,
    requestId: randomUUID(), items: source.map((row) => ({ inventoryItemId: row.inventoryItemId, usedQuantity: canonicalQuantity(row.plannedQuantity), basis: "PLANNED", reason: null })),
    expectedLedger: ledger.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId })),
    confirmTakenOutOfUse: true, confirmEmpty: source.length === 0, reason: source.length === 0 ? "No planned inventory" : null };
  const operationId = randomUUID();
  const revisionId = randomUUID();
  const confirmedAt = new Date("2026-10-24T12:00:00Z");
  const revisionItems = input.items.map((item) => ({ ...item, ownerId, contextId: context.id, revisionId,
    mode: "DIRECT" as const, quantityDelta: item.usedQuantity === "0" ? "0" : `-${item.usedQuantity}`,
    initialCountMovementId: ledger.find((row) => row.inventoryItemId === item.inventoryItemId)!.countMovementId,
    movementId: randomUUID(), settlementCountMovementId: null }));
  const prepared: PreparedConsumptionOperation = {
    operation: { id: operationId, ownerId, requestId: input.requestId, kind: "CONFIRM", canonicalManifest: canonicalizeUseRequest("CONFIRM", input), resultRevisionIds: [revisionId], resultCountMovementIds: [] },
    revisions: [{ id: revisionId, ownerId, contextId: context.id, operationId, revisionNumber: 1, previousRevisionId: null, reason: input.reason }],
    revisionItems,
    usageMovements: revisionItems.map((item) => ({ id: item.movementId, ownerId, inventoryItemId: item.inventoryItemId, type: "CONSUMPTION", quantityDeltaInBaseUnit: item.quantityDelta,
      referenceType: "CONSUMPTION_REVISION", referenceId: revisionId, occurredAt: confirmedAt, notes: item.reason })),
    countMovements: [], pointerUpdates: [{ contextId: context.id, expectedRevisionId: null, newRevisionId: revisionId }],
  };
  return { input, prepared, confirmedAt };
}

export async function confirmConsumptionStock(db: DatabaseClient, ownerId: string, cycleId: string, planningSnapshotId?: string) {
  if (!planningSnapshotId) {
    const [cycle] = await db.select().from(bakeCycles).where(and(eq(bakeCycles.ownerId, ownerId), eq(bakeCycles.id, cycleId)));
    if (!cycle?.activePlanningSnapshotId) throw new Error("Fixture needs a current plan");
    planningSnapshotId = cycle.activePlanningSnapshotId;
  }
  const source = await loadShoppingSource(db, ownerId, planningSnapshotId);
  if (source.length) await createShoppingCommandService(db).confirmStock(ownerId, {
    cycleId, planningSnapshotId, confirmationRequestId: randomUUID(), countedAt: new Date(),
    counts: source.map((item) => ({ inventoryItemId: item.inventoryItemId, countedQuantity: item.requiredQuantity })),
  });
}

export async function seedConsumptionScenario(db: DatabaseClient, input: {
  ownerId?: string; idSet?: "PRIMARY" | "SECONDARY"; start?: boolean;
} = {}) {
  const ownerId = input.ownerId ?? OWNER_ID;
  const s = await seedLockedPlanningScenario(db, input);
  const [generation] = await db.select().from(cycleTaskGenerations).where(and(
    eq(cycleTaskGenerations.ownerId, ownerId), eq(cycleTaskGenerations.planningSnapshotId, s.planningSnapshotId),
  ));
  await confirmConsumptionStock(db, ownerId, s.cycleId, s.planningSnapshotId);
  if (input.start !== false) await createCycleOperationsCommandService(db).startCycle(ownerId, { cycleId: s.cycleId });
  return { cycleId: s.cycleId, planningSnapshotId: s.planningSnapshotId, taskGenerationId: generation!.id,
    itemIds: [s.ingredientItemId, s.packagingItemId] };
}

// Three real locked sources: two share flour+boxes; a packaging-only product
// gives the third a boxes-only source. All initial checks happen before start.
export async function seedSharedConsumptionScenario(db: DatabaseClient, boxesBalance = "12") {
  const first = await seedConsumptionScenario(db, { start: false });
  const [order] = await db.select().from(orders).where(eq(orders.bakeCycleId, first.cycleId));
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order!.id));
  const [packProduct] = await db.insert(products).values({ ownerId: OWNER_ID, name: "Packaging-only product", sellingUnit: "piece", defaultUnitPriceSatang: 100 }).returning();
  const [recipe] = await db.insert(recipes).values({ ownerId: OWNER_ID, productId: packProduct!.id, name: "Packaging-only recipe" }).returning();
  const [version] = await db.insert(recipeVersions).values({ ownerId: OWNER_ID, recipeId: recipe!.id, versionCode: "v1",
    baseYieldQuantity: "1", yieldUnit: "piece", laborMinutesPerBatch: 0, utilityCostSatangPerBatch: 0, instructions: "Pack prepared product" }).returning();
  await db.update(products).set({ activeRecipeVersionId: version!.id }).where(eq(products.id, packProduct!.id));
  const [template] = await db.insert(productionTemplates).values({ ownerId: OWNER_ID, name: "Packaging-only production", scope: "PRODUCT", productId: packProduct!.id, active: true }).returning();
  await db.insert(productionTemplateActivities).values({ ownerId: OWNER_ID, productionTemplateId: template!.id,
    name: "Pack prepared product", offsetDaysFromDelivery: 1, defaultTime: "05:00", estimatedDurationMinutes: 10, sequence: 1, active: true });
  await db.insert(productPackagingRules).values({ ownerId: OWNER_ID, scope: "PRODUCT", productId: packProduct!.id,
    inventoryItemId: first.itemIds[1]!, consumptionBasis: "PER_PRODUCT_UNIT", quantityInBaseUnit: "1" });
  async function addCycle(productId: string, name: string) {
    const [cycle] = await db.insert(bakeCycles).values({ ownerId: OWNER_ID, name, status: "OPEN",
      targetProductionDate: "2026-08-29", primaryDeliveryDate: "2026-08-30" }).returning();
    const [added] = await db.insert(orders).values({ ownerId: OWNER_ID, bakeCycleId: cycle!.id, customerId: order!.customerId,
      confirmedDeliveryDate: "2026-08-30", deliveryMethodId: order!.deliveryMethodId, deliveryLocation: order!.deliveryLocation,
      fulfillmentStatus: "CONFIRMED" }).returning();
    await db.insert(orderItems).values({ ownerId: OWNER_ID, orderId: added!.id, productId, quantity: 1, unitPriceSatang: 100, position: 0 });
    const preview = await createPlanningQueryService(db).preview(OWNER_ID, cycle!.id);
    if (preview.blockers.length) throw new Error(`Shared fixture ${name}: ${JSON.stringify(preview.blockers)}`);
    await createPlanningCommandService(db).lock(OWNER_ID, { cycleId: cycle!.id, lockRequestId: randomUUID(), inputFingerprint: preview.inputFingerprint, overrides: [] });
    await confirmConsumptionStock(db, OWNER_ID, cycle!.id);
    return cycle!.id;
  }
  const second = await addCycle(line!.productId, "Second shared source");
  const boxesOnly = await addCycle(packProduct!.id, "Uncounted-only source");
  const ledger = await readStockLedger(db, OWNER_ID, first.itemIds);
  for (const [index, inventoryItemId] of first.itemIds.entries()) {
    const remaining = index === 0 ? "50" : boxesBalance;
    await db.insert(inventoryMovements).values({ ownerId: OWNER_ID, inventoryItemId, type: "COUNT", countedQuantityInBaseUnit: remaining,
      quantityDeltaInBaseUnit: new StorageDecimal(remaining).minus(ledger.find((l) => l.inventoryItemId === inventoryItemId)!.balance).toFixed(), occurredAt: new Date() });
  }
  for (const cycleId of [first.cycleId, second, boxesOnly]) await createCycleOperationsCommandService(db).startCycle(OWNER_ID, { cycleId });
  const contexts = [];
  for (const cycleId of [first.cycleId, second, boxesOnly]) contexts.push((await prepareConsumptionFixture(db, OWNER_ID, cycleId)).input);
  return { itemIds: first.itemIds, contexts };
}
