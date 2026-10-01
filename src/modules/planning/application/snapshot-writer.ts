import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  cycleCostSnapshots,
  cycleInventoryPriceSnapshots,
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
import type { LockCycleInput } from "@/modules/planning/domain/lock-form";
import type {
  PlanningPreview,
  PlanningSettingsSnapshot,
} from "@/modules/planning/domain/types";
import type { PlanningGenerationSummary } from "./planning-queries";

type SnapshotWriter = Pick<DatabaseClient, "insert" | "update">;
type BakeCycleRow = typeof bakeCycles.$inferSelect;

export type PersistablePlanningPreview = PlanningPreview &
  Readonly<{ settings: PlanningSettingsSnapshot }>;

function requireMappedId(
  ids: ReadonlyMap<string, string>,
  sourceId: string,
  label: string,
): string {
  const id = ids.get(sourceId);
  if (!id) throw new Error(`Missing ${label} snapshot mapping: ${sourceId}`);
  return id;
}

export async function persistPlanningSnapshot(
  tx: SnapshotWriter,
  ownerId: string,
  cycle: BakeCycleRow,
  preview: PersistablePlanningPreview,
  input: LockCycleInput,
  generation: number,
  lockedAt: Date,
): Promise<PlanningGenerationSummary> {
  const [planningSnapshot] = await tx
    .insert(cyclePlanningSnapshots)
    .values({
      ownerId,
      bakeCycleId: cycle.id,
      generation,
      status: "ACTIVE",
      lockRequestId: input.lockRequestId,
      inputFingerprint: input.inputFingerprint,
      cycleNumber: preview.cycle.cycleNumber,
      cycleName: preview.cycle.name,
      orderCutoffAt: preview.cycle.orderCutoffAt,
      targetProductionDate: preview.cycle.targetProductionDate,
      primaryDeliveryDate: preview.cycle.primaryDeliveryDate!,
      laborRateSatangPerHour: preview.settings.laborRateSatangPerHour,
      defaultWasteAllowancePercent:
        preview.settings.defaultWasteAllowancePercent,
      timezone: preview.settings.timezone,
      currency: preview.settings.currency,
      costComplete: preview.cycleCost.costComplete,
      lockedAt,
    })
    .returning();
  if (!planningSnapshot) {
    throw new Error("Planning snapshot insert returned no row");
  }

  if (preview.warnings.length > 0) {
    await tx.insert(cyclePlanningWarnings).values(
      preview.warnings.map((warning) => ({
        ownerId,
        planningSnapshotId: planningSnapshot.id,
        code: warning.code,
        scope: warning.scope,
        sourceEntityId: warning.sourceEntityId,
        message: warning.message,
        context: warning.context,
      })),
    );
  }

  const orderSnapshotIds = new Map<string, string>();
  if (preview.orderSnapshots.length > 0) {
    const insertedOrders = await tx
      .insert(cycleOrderSnapshots)
      .values(
        preview.orderSnapshots.map((order) => ({
          ownerId,
          planningSnapshotId: planningSnapshot.id,
          sourceOrderId: order.id,
          sourceCustomerId: order.customerId,
          customerName: order.customerName,
          sourceDeliveryMethodId: order.deliveryMethodId,
          deliveryMethodName: order.deliveryMethodName,
          deliveryRequiresLocation: order.deliveryRequiresLocation,
          sourceChannel: order.sourceChannel,
          requestedDeliveryDate: order.requestedDeliveryDate,
          confirmedDeliveryDate: order.confirmedDeliveryDate,
          confirmedDeliveryTime: order.confirmedDeliveryTime,
          deliveryLocation: order.deliveryLocation,
          deliveryNote: order.deliveryNote,
          specialInstructions: order.specialInstructions,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          deliveryFeePayer: order.deliveryFeePayer,
          deliveryFeeChargedSatang: order.deliveryFeeChargedSatang,
          deliveryCostSatang: order.deliveryCostSatang,
          discountSatang: order.discountSatang,
          amountPaidSatang: order.amountPaidSatang,
          subtotalSatang: order.subtotalSatang,
          grandTotalSatang: order.grandTotalSatang,
          balanceSatang: order.balanceSatang,
        })),
      )
      .returning({
        id: cycleOrderSnapshots.id,
        sourceOrderId: cycleOrderSnapshots.sourceOrderId,
      });
    for (const order of insertedOrders) {
      orderSnapshotIds.set(order.sourceOrderId, order.id);
    }
  }

  const orderItems = preview.orderSnapshots.flatMap((order) =>
    order.items.map((item) => ({
      ownerId,
      planningSnapshotId: planningSnapshot.id,
      orderSnapshotId: requireMappedId(
        orderSnapshotIds,
        order.id,
        "order",
      ),
      sourceOrderId: order.id,
      sourceOrderItemId: item.id,
      sourceProductId: item.productId,
      productName: item.productName,
      sellingUnit: item.sellingUnit,
      quantity: item.quantity,
      unitPriceSatang: item.unitPriceSatang,
      lineNote: item.lineNote,
    })),
  );
  if (orderItems.length > 0) {
    await tx.insert(cycleOrderItemSnapshots).values(orderItems);
  }

  const recipePlanIds = new Map<string, string>();
  if (preview.recipePlans.length > 0) {
    const insertedRecipes = await tx
      .insert(cycleRecipePlans)
      .values(
        preview.recipePlans.map((recipe) => ({
          ownerId,
          planningSnapshotId: planningSnapshot.id,
          sourceProductId: recipe.productId,
          sourceRecipeId: recipe.recipeId,
          sourceRecipeVersionId: recipe.recipeVersionId,
          recipeName: recipe.recipeName,
          versionCode: recipe.versionCode,
          instructions: recipe.instructions,
          baseYieldQuantity: recipe.baseYieldQuantity,
          yieldUnit: recipe.yieldUnit,
          yieldInSellingUnit: recipe.yieldInSellingUnit,
          sellingUnit: recipe.sellingUnit,
          laborMinutesPerBatch: recipe.laborMinutesPerBatch,
          utilityCostSatangPerBatch: recipe.utilityCostSatangPerBatch,
          wasteAllowancePercent: recipe.wasteAllowancePercent,
          wasteAllowanceSource: recipe.wasteAllowanceSource,
        })),
      )
      .returning({
        id: cycleRecipePlans.id,
        sourceProductId: cycleRecipePlans.sourceProductId,
      });
    for (const recipe of insertedRecipes) {
      recipePlanIds.set(recipe.sourceProductId, recipe.id);
    }
  }

  const productPlanIds = new Map<string, string>();
  if (preview.productPlans.length > 0) {
    const insertedProducts = await tx
      .insert(cycleProductPlans)
      .values(
        preview.productPlans.map((product) => ({
          ownerId,
          planningSnapshotId: planningSnapshot.id,
          sourceProductId: product.productId,
          recipePlanId: requireMappedId(
            recipePlanIds,
            product.productId,
            "recipe plan",
          ),
          productName: product.productName,
          sellingUnit: product.sellingUnit,
          orderedQuantity: Number(product.orderedQuantity),
          suggestedBatchCount: product.suggestedBatchCount,
          selectedBatchCount: product.selectedBatchCount,
          overrideReason: product.overrideReason,
          plannedOutput: product.plannedOutput,
          outputDifference: product.outputDifference,
        })),
      )
      .returning({
        id: cycleProductPlans.id,
        sourceProductId: cycleProductPlans.sourceProductId,
      });
    for (const product of insertedProducts) {
      productPlanIds.set(product.sourceProductId, product.id);
    }
  }

  const priceSnapshotIds = new Map<string, string>();
  if (preview.inventoryPrices.length > 0) {
    const insertedPrices = await tx
      .insert(cycleInventoryPriceSnapshots)
      .values(
        preview.inventoryPrices.map((price) => ({
          ownerId,
          planningSnapshotId: planningSnapshot.id,
          inventoryItemId: price.inventoryItemId,
          inventoryItemName: price.inventoryItemName,
          inventoryCategory: price.inventoryCategory,
          baseUnit: price.baseUnit,
          sourcePriceId: price.sourcePriceId,
          packPriceSatang: price.packPriceSatang,
          packBaseQuantity: price.packBaseQuantity,
          effectiveAt: price.effectiveAt,
          unitCostSatang: price.unitCostSatang,
        })),
      )
      .returning({
        id: cycleInventoryPriceSnapshots.id,
        inventoryItemId: cycleInventoryPriceSnapshots.inventoryItemId,
      });
    for (const price of insertedPrices) {
      priceSnapshotIds.set(price.inventoryItemId, price.id);
    }
  }

  if (preview.materialRequirements.length > 0) {
    const recipePlanByProductId = new Map(
      preview.recipePlans.map((recipe) => [recipe.productId, recipe]),
    );
    await tx.insert(cycleMaterialRequirements).values(
      preview.materialRequirements.map((requirement) => {
        const recipe = recipePlanByProductId.get(requirement.productId);
        if (!recipe) {
          throw new Error(
            `Missing recipe plan source mapping: ${requirement.productId}`,
          );
        }
        return {
          ownerId,
          planningSnapshotId: planningSnapshot.id,
          productPlanId: requireMappedId(
            productPlanIds,
            requirement.productId,
            "product plan",
          ),
          recipePlanId: requireMappedId(
            recipePlanIds,
            requirement.productId,
            "recipe plan",
          ),
          sourceRecipeVersionId: recipe.recipeVersionId,
          sourceRecipeIngredientId: requirement.recipeIngredientId,
          inventoryItemId: requirement.inventoryItemId,
          priceSnapshotId: requireMappedId(
            priceSnapshotIds,
            requirement.inventoryItemId,
            "inventory price",
          ),
          inventoryItemName: requirement.inventoryItemName,
          baseUnit: requirement.baseUnit,
          quantityPerBatch: requirement.quantityPerBatch,
          selectedBatchCount: requirement.selectedBatchCount,
          baseRequirement: requirement.baseRequirement,
          wasteAllowancePercent: requirement.wasteAllowancePercent,
          wasteQuantity: requirement.wasteQuantity,
          plannedRequirement: requirement.plannedRequirement,
          baseCostSatang: requirement.baseCostSatang,
          wasteCostSatang: requirement.wasteCostSatang,
        };
      }),
    );
  }

  if (preview.packagingRequirements.length > 0) {
    await tx.insert(cyclePackagingRequirements).values(
      preview.packagingRequirements.map((requirement) => ({
        ownerId,
        planningSnapshotId: planningSnapshot.id,
        productPlanId:
          requirement.productId === null
            ? null
            : requireMappedId(
                productPlanIds,
                requirement.productId,
                "product plan",
              ),
        sourcePackagingRuleId: requirement.packagingRuleId,
        scope: requirement.scope,
        consumptionBasis: requirement.consumptionBasis,
        sourceProductId: requirement.productId,
        sourceDeliveryMethodId: requirement.deliveryMethodId,
        targetName: requirement.targetName,
        inventoryItemId: requirement.inventoryItemId,
        inventoryItemName: requirement.inventoryItemName,
        baseUnit: requirement.baseUnit,
        priceSnapshotId: requireMappedId(
          priceSnapshotIds,
          requirement.inventoryItemId,
          "inventory price",
        ),
        ruleQuantity: requirement.ruleQuantity,
        multiplier: requirement.multiplier,
        plannedRequirement: requirement.plannedRequirement,
        costSatang: requirement.costSatang,
      })),
    );
  }

  if (preview.productCosts.length > 0) {
    await tx.insert(cycleProductCostSnapshots).values(
      preview.productCosts.map((cost) => ({
        ownerId,
        planningSnapshotId: planningSnapshot.id,
        productPlanId: requireMappedId(
          productPlanIds,
          cost.productId,
          "product plan",
        ),
        knownBaseIngredientCostSatang: cost.knownBaseIngredientCostSatang,
        knownWasteCostSatang: cost.knownWasteCostSatang,
        knownProductPackagingCostSatang:
          cost.knownProductPackagingCostSatang,
        laborCostSatang: cost.laborCostSatang,
        utilityCostSatang: cost.utilityCostSatang,
        knownProductionCostSatang: cost.knownProductionCostSatang,
        completeProductionCostSatang: cost.completeProductionCostSatang,
        costComplete: cost.costComplete,
      })),
    );
  }

  await tx.insert(cycleCostSnapshots).values({
    ownerId,
    planningSnapshotId: planningSnapshot.id,
    knownBaseIngredientCostSatang:
      preview.cycleCost.knownBaseIngredientCostSatang,
    knownWasteCostSatang: preview.cycleCost.knownWasteCostSatang,
    knownProductPackagingCostSatang:
      preview.cycleCost.knownProductPackagingCostSatang,
    knownDeliveryPackagingCostSatang:
      preview.cycleCost.knownDeliveryPackagingCostSatang,
    laborCostSatang: preview.cycleCost.laborCostSatang,
    utilityCostSatang: preview.cycleCost.utilityCostSatang,
    knownProductionCostSatang: preview.cycleCost.knownProductionCostSatang,
    completeProductionCostSatang:
      preview.cycleCost.completeProductionCostSatang,
    missingPriceCount: preview.cycleCost.missingPriceCount,
    costComplete: preview.cycleCost.costComplete,
  });

  return {
    id: planningSnapshot.id,
    cycleId: planningSnapshot.bakeCycleId,
    generation: planningSnapshot.generation,
    status: planningSnapshot.status,
    costComplete: planningSnapshot.costComplete,
    lockedAt: planningSnapshot.lockedAt,
    unlockedAt: planningSnapshot.unlockedAt,
    unlockReason: planningSnapshot.unlockReason,
    unlockedFromStatus:
      planningSnapshot.unlockedFromStatus === "LOCKED" ||
      planningSnapshot.unlockedFromStatus === "IN_PRODUCTION"
        ? planningSnapshot.unlockedFromStatus
        : null,
  };
}
