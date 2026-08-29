import type { DatabaseClient } from "@/lib/db/types";
import { and, asc, desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  cycleCostSnapshots,
  cycleMaterialRequirements,
  cycleOrderItemSnapshots,
  cycleOrderSnapshots,
  cyclePackagingRequirements,
  cyclePlanningSnapshots,
  cyclePlanningWarnings,
  cycleProductCostSnapshots,
  cycleProductPlans,
  cycleRecipePlans,
} from "@/modules/planning/db/schema";
import { buildPlanningPreview } from "@/modules/planning/domain/build-preview";
import type {
  PlanningCycleCost,
  PlanningIssue,
  PlanningMaterialRequirement,
  PlanningOrderSnapshot,
  PlanningPackagingRequirement,
  PlanningPreview,
  PlanningProductCost,
  PlanningProductPlan,
  PlanningRecipePlan,
} from "@/modules/planning/domain/types";
import type { UnitCode } from "@/modules/units/domain/units";
import { loadPlanningSource } from "./load-source";

export type PlanningGenerationSummary = Readonly<{
  id: string;
  cycleId: string;
  generation: number;
  status: "ACTIVE" | "SUPERSEDED";
  costComplete: boolean;
  lockedAt: Date;
  unlockedAt: Date | null;
  unlockReason: string | null;
  unlockedFromStatus: "LOCKED" | "IN_PRODUCTION" | null;
}>;

export type PlanningGenerationView = PlanningGenerationSummary &
  Readonly<{
    cycleName: string;
    warnings: ReadonlyArray<PlanningIssue>;
    orders: ReadonlyArray<PlanningOrderSnapshot>;
    productPlans: ReadonlyArray<PlanningProductPlan>;
    recipePlans: ReadonlyArray<PlanningRecipePlan>;
    materialRequirements: ReadonlyArray<PlanningMaterialRequirement>;
    packagingRequirements: ReadonlyArray<PlanningPackagingRequirement>;
    productCosts: ReadonlyArray<PlanningProductCost>;
    cycleCost: PlanningCycleCost;
  }>;

export type PlanningClock = Readonly<{ now(): Date }>;

const SYSTEM_CLOCK: PlanningClock = { now: () => new Date() };
const uuidSchema = z.string().uuid();

function toGenerationSummary(
  row: typeof cyclePlanningSnapshots.$inferSelect,
): PlanningGenerationSummary {
  return {
    id: row.id,
    cycleId: row.bakeCycleId,
    generation: row.generation,
    status: row.status,
    costComplete: row.costComplete,
    lockedAt: row.lockedAt,
    unlockedAt: row.unlockedAt,
    unlockReason: row.unlockReason,
    unlockedFromStatus:
      row.unlockedFromStatus === "LOCKED" ||
      row.unlockedFromStatus === "IN_PRODUCTION"
        ? row.unlockedFromStatus
        : null,
  };
}

function generationNotFound(): never {
  throw new Error("Planning generation not found");
}

export function createPlanningQueryService(
  db: DatabaseClient,
  clock: PlanningClock = SYSTEM_CLOCK,
) {
  return {
    async preview(ownerId: string, cycleId: string): Promise<PlanningPreview> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (!parsedOwnerId.success || !parsedCycleId.success) {
        throw new Error("Cycle not found");
      }
      const asOf = clock.now();
      const source = await loadPlanningSource(
        db,
        parsedOwnerId.data,
        parsedCycleId.data,
        asOf,
      );
      return buildPlanningPreview(source);
    },

    async listGenerations(
      ownerId: string,
      cycleId: string,
    ): Promise<ReadonlyArray<PlanningGenerationSummary>> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (!parsedOwnerId.success || !parsedCycleId.success) {
        generationNotFound();
      }
      const [cycle] = await db
        .select({ id: bakeCycles.id })
        .from(bakeCycles)
        .where(
          and(
            eq(bakeCycles.ownerId, parsedOwnerId.data),
            eq(bakeCycles.id, parsedCycleId.data),
          ),
        )
        .limit(1);
      if (!cycle) generationNotFound();
      const rows = await db
        .select()
        .from(cyclePlanningSnapshots)
        .where(
          and(
            eq(cyclePlanningSnapshots.ownerId, parsedOwnerId.data),
            eq(cyclePlanningSnapshots.bakeCycleId, parsedCycleId.data),
          ),
        )
        .orderBy(desc(cyclePlanningSnapshots.generation));
      return rows.map(toGenerationSummary);
    },

    async getGeneration(
      ownerId: string,
      cycleId: string,
      generation?: number,
    ): Promise<PlanningGenerationView> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (
        !parsedOwnerId.success ||
        !parsedCycleId.success ||
        (generation !== undefined &&
          (!Number.isSafeInteger(generation) || generation <= 0))
      ) {
        generationNotFound();
      }
      const verifiedOwnerId = parsedOwnerId.data;
      const verifiedCycleId = parsedCycleId.data;

      let planningSnapshotId: string;
      if (generation === undefined) {
        const [cycle] = await db
          .select({
            activePlanningSnapshotId: bakeCycles.activePlanningSnapshotId,
          })
          .from(bakeCycles)
          .where(
            and(
              eq(bakeCycles.ownerId, verifiedOwnerId),
              eq(bakeCycles.id, verifiedCycleId),
            ),
          )
          .limit(1);
        if (!cycle?.activePlanningSnapshotId) generationNotFound();
        planningSnapshotId = cycle.activePlanningSnapshotId;
      } else {
        const [selected] = await db
          .select({ id: cyclePlanningSnapshots.id })
          .from(cyclePlanningSnapshots)
          .where(
            and(
              eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
              eq(cyclePlanningSnapshots.bakeCycleId, verifiedCycleId),
              eq(cyclePlanningSnapshots.generation, generation),
            ),
          )
          .limit(1);
        if (!selected) generationNotFound();
        planningSnapshotId = selected.id;
      }

      const ownedSnapshot = and(
        eq(cyclePlanningSnapshots.ownerId, verifiedOwnerId),
        eq(cyclePlanningSnapshots.bakeCycleId, verifiedCycleId),
        eq(cyclePlanningSnapshots.id, planningSnapshotId),
      );
      const [snapshot] = await db
        .select()
        .from(cyclePlanningSnapshots)
        .where(ownedSnapshot)
        .limit(1);
      if (!snapshot) generationNotFound();

      const childScope = (
        ownerColumn: AnyPgColumn,
        snapshotColumn: AnyPgColumn,
      ) =>
        and(
          eq(ownerColumn, verifiedOwnerId),
          eq(snapshotColumn, planningSnapshotId),
        );

      const [
        warningRows,
        orderRows,
        orderItemRows,
        recipeRows,
        productRows,
        materialRows,
        packagingRows,
        productCostRows,
        cycleCostRows,
      ] = await Promise.all([
        db
          .select()
          .from(cyclePlanningWarnings)
          .where(childScope(
            cyclePlanningWarnings.ownerId,
            cyclePlanningWarnings.planningSnapshotId,
          ))
          .orderBy(asc(cyclePlanningWarnings.id)),
        db
          .select()
          .from(cycleOrderSnapshots)
          .where(childScope(
            cycleOrderSnapshots.ownerId,
            cycleOrderSnapshots.planningSnapshotId,
          ))
          .orderBy(asc(cycleOrderSnapshots.id)),
        db
          .select()
          .from(cycleOrderItemSnapshots)
          .where(childScope(
            cycleOrderItemSnapshots.ownerId,
            cycleOrderItemSnapshots.planningSnapshotId,
          ))
          .orderBy(asc(cycleOrderItemSnapshots.id)),
        db
          .select()
          .from(cycleRecipePlans)
          .where(childScope(
            cycleRecipePlans.ownerId,
            cycleRecipePlans.planningSnapshotId,
          ))
          .orderBy(asc(cycleRecipePlans.sourceProductId)),
        db
          .select()
          .from(cycleProductPlans)
          .where(childScope(
            cycleProductPlans.ownerId,
            cycleProductPlans.planningSnapshotId,
          ))
          .orderBy(asc(cycleProductPlans.sourceProductId)),
        db
          .select()
          .from(cycleMaterialRequirements)
          .where(childScope(
            cycleMaterialRequirements.ownerId,
            cycleMaterialRequirements.planningSnapshotId,
          ))
          .orderBy(asc(cycleMaterialRequirements.id)),
        db
          .select()
          .from(cyclePackagingRequirements)
          .where(childScope(
            cyclePackagingRequirements.ownerId,
            cyclePackagingRequirements.planningSnapshotId,
          ))
          .orderBy(asc(cyclePackagingRequirements.id)),
        db
          .select()
          .from(cycleProductCostSnapshots)
          .where(childScope(
            cycleProductCostSnapshots.ownerId,
            cycleProductCostSnapshots.planningSnapshotId,
          ))
          .orderBy(asc(cycleProductCostSnapshots.id)),
        db
          .select()
          .from(cycleCostSnapshots)
          .where(childScope(
            cycleCostSnapshots.ownerId,
            cycleCostSnapshots.planningSnapshotId,
          ))
          .limit(1),
      ]);
      const cycleCostRow = cycleCostRows[0];
      if (!cycleCostRow) generationNotFound();

      const itemsByOrderSnapshotId = new Map<
        string,
        PlanningOrderSnapshot["items"][number][]
      >();
      for (const item of orderItemRows) {
        const mapped = {
          id: item.sourceOrderItemId,
          productId: item.sourceProductId,
          productName: item.productName,
          sellingUnit: item.sellingUnit as UnitCode,
          quantity: item.quantity,
          unitPriceSatang: item.unitPriceSatang,
          lineNote: item.lineNote,
        };
        const existing = itemsByOrderSnapshotId.get(item.orderSnapshotId);
        if (existing) existing.push(mapped);
        else itemsByOrderSnapshotId.set(item.orderSnapshotId, [mapped]);
      }

      const orders: PlanningOrderSnapshot[] = orderRows.map((order) => ({
        id: order.sourceOrderId,
        customerId: order.sourceCustomerId,
        customerName: order.customerName,
        deliveryMethodId: order.sourceDeliveryMethodId,
        deliveryMethodName: order.deliveryMethodName,
        deliveryRequiresLocation: order.deliveryRequiresLocation,
        requestedDeliveryDate: order.requestedDeliveryDate,
        confirmedDeliveryDate: order.confirmedDeliveryDate,
        deliveryLocation: order.deliveryLocation,
        deliveryNote: order.deliveryNote,
        specialInstructions: order.specialInstructions,
        sourceChannel: order.sourceChannel,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        deliveryFeePayer: order.deliveryFeePayer,
        deliveryFeeChargedSatang: order.deliveryFeeChargedSatang,
        deliveryCostSatang: order.deliveryCostSatang,
        discountSatang: order.discountSatang,
        amountPaidSatang: order.amountPaidSatang,
        items: itemsByOrderSnapshotId.get(order.id) ?? [],
        subtotalSatang: order.subtotalSatang,
        grandTotalSatang: order.grandTotalSatang,
        balanceSatang: order.balanceSatang,
      }));

      const recipePlans: PlanningRecipePlan[] = recipeRows.map((recipe) => ({
        productId: recipe.sourceProductId,
        recipeId: recipe.sourceRecipeId,
        recipeVersionId: recipe.sourceRecipeVersionId,
        recipeName: recipe.recipeName,
        versionCode: recipe.versionCode,
        instructions: recipe.instructions,
        baseYieldQuantity: recipe.baseYieldQuantity,
        yieldUnit: recipe.yieldUnit as UnitCode,
        yieldInSellingUnit: recipe.yieldInSellingUnit,
        sellingUnit: recipe.sellingUnit as UnitCode,
        laborMinutesPerBatch: recipe.laborMinutesPerBatch,
        utilityCostSatangPerBatch: recipe.utilityCostSatangPerBatch,
        wasteAllowancePercent: recipe.wasteAllowancePercent,
        wasteAllowanceSource: recipe.wasteAllowanceSource,
      }));

      const productIdByPlanId = new Map(
        productRows.map((product) => [product.id, product.sourceProductId]),
      );
      const productPlans: PlanningProductPlan[] = productRows.map((product) => ({
        productId: product.sourceProductId,
        productName: product.productName,
        sellingUnit: product.sellingUnit as UnitCode,
        orderedQuantity: String(product.orderedQuantity),
        yieldInSellingUnit:
          recipeRows.find((recipe) => recipe.id === product.recipePlanId)
            ?.yieldInSellingUnit ?? generationNotFound(),
        suggestedBatchCount: product.suggestedBatchCount,
        selectedBatchCount: product.selectedBatchCount,
        overrideReason: product.overrideReason,
        plannedOutput: product.plannedOutput,
        outputDifference: product.outputDifference,
      }));

      const materialRequirements: PlanningMaterialRequirement[] =
        materialRows.map((requirement) => ({
          productId:
            productIdByPlanId.get(requirement.productPlanId) ??
            generationNotFound(),
          recipeIngredientId: requirement.sourceRecipeIngredientId,
          inventoryItemId: requirement.inventoryItemId,
          inventoryItemName: requirement.inventoryItemName,
          baseUnit: requirement.baseUnit as UnitCode,
          quantityPerBatch: requirement.quantityPerBatch,
          selectedBatchCount: requirement.selectedBatchCount,
          baseRequirement: requirement.baseRequirement,
          wasteAllowancePercent: requirement.wasteAllowancePercent,
          wasteQuantity: requirement.wasteQuantity,
          plannedRequirement: requirement.plannedRequirement,
          baseCostSatang: requirement.baseCostSatang,
          wasteCostSatang: requirement.wasteCostSatang,
        }));

      const packagingRequirements: PlanningPackagingRequirement[] =
        packagingRows.map((requirement) => ({
          packagingRuleId: requirement.sourcePackagingRuleId,
          scope: requirement.scope,
          consumptionBasis: requirement.consumptionBasis,
          productId: requirement.sourceProductId,
          deliveryMethodId: requirement.sourceDeliveryMethodId,
          targetName: requirement.targetName,
          inventoryItemId: requirement.inventoryItemId,
          inventoryItemName: requirement.inventoryItemName,
          baseUnit: requirement.baseUnit as UnitCode,
          ruleQuantity: requirement.ruleQuantity,
          multiplier: requirement.multiplier,
          plannedRequirement: requirement.plannedRequirement,
          costSatang: requirement.costSatang,
        }));

      const productCosts: PlanningProductCost[] = productCostRows.map((cost) => {
        const productId =
          productIdByPlanId.get(cost.productPlanId) ?? generationNotFound();
        const missingInventoryItemIds = new Set([
          ...materialRows
            .filter(
              (requirement) =>
                requirement.productPlanId === cost.productPlanId &&
                (requirement.baseCostSatang === null ||
                  requirement.wasteCostSatang === null),
            )
            .map((requirement) => requirement.inventoryItemId),
          ...packagingRows
            .filter(
              (requirement) =>
                requirement.productPlanId === cost.productPlanId &&
                requirement.costSatang === null,
            )
            .map((requirement) => requirement.inventoryItemId),
        ]);
        return {
          productId,
          knownBaseIngredientCostSatang:
            cost.knownBaseIngredientCostSatang,
          knownWasteCostSatang: cost.knownWasteCostSatang,
          knownProductPackagingCostSatang:
            cost.knownProductPackagingCostSatang,
          laborCostSatang: cost.laborCostSatang,
          utilityCostSatang: cost.utilityCostSatang,
          knownProductionCostSatang: cost.knownProductionCostSatang,
          completeProductionCostSatang: cost.completeProductionCostSatang,
          costComplete: cost.costComplete,
          missingPriceCount: missingInventoryItemIds.size,
        };
      });

      const warnings: PlanningIssue[] = warningRows.map((warning) => ({
        code: warning.code as PlanningIssue["code"],
        scope: warning.scope,
        sourceEntityId: warning.sourceEntityId,
        message: warning.message,
        context: warning.context,
      }));
      const cycleCost: PlanningCycleCost = {
        knownBaseIngredientCostSatang:
          cycleCostRow.knownBaseIngredientCostSatang,
        knownWasteCostSatang: cycleCostRow.knownWasteCostSatang,
        knownProductPackagingCostSatang:
          cycleCostRow.knownProductPackagingCostSatang,
        knownDeliveryPackagingCostSatang:
          cycleCostRow.knownDeliveryPackagingCostSatang,
        laborCostSatang: cycleCostRow.laborCostSatang,
        utilityCostSatang: cycleCostRow.utilityCostSatang,
        knownProductionCostSatang: cycleCostRow.knownProductionCostSatang,
        completeProductionCostSatang:
          cycleCostRow.completeProductionCostSatang,
        missingPriceCount: cycleCostRow.missingPriceCount,
        costComplete: cycleCostRow.costComplete,
      };

      return {
        ...toGenerationSummary(snapshot),
        cycleName: snapshot.cycleName,
        warnings,
        orders,
        productPlans,
        recipePlans,
        materialRequirements,
        packagingRequirements,
        productCosts,
        cycleCost,
      };
    },
  };
}
