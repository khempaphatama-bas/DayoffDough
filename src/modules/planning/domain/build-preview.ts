import Decimal from "decimal.js";
import { calculateUnitCostSatang } from "@/modules/inventory/domain/cost";
import { isPrepOnly } from "@/modules/inventory/domain/ingredient-kind";
import { calculateOrderTotals } from "@/modules/orders/domain/totals";
import { calculateBatchPlan } from "./batch-plan";
import {
  calculateCycleCost,
  calculateLaborCost,
  calculateProductCost,
  calculateRequirementCost,
  calculateUtilityCost,
} from "./costing";
import { createPlanningFingerprint } from "./fingerprint";
import {
  calculateMaterialRequirement,
  resolveWasteAllowance,
} from "./material-requirement";
import { calculatePackagingRequirement } from "./packaging-requirement";
import {
  PLANNING_ISSUE_MESSAGES,
  type PlanningInventoryPrice,
  type PlanningIssue,
  type PlanningMaterialRequirement,
  type PlanningPackagingRequirement,
  type PlanningProductCost,
  type PlanningProductPlan,
  type PlanningRecipePlan,
  type PlanningSourceInventoryItem,
  type PlanningSourceOrder,
  type PlanningSourceProduct,
} from "./types";
import type {
  BatchOverride,
  PlanningPreview,
  PlanningSourceData,
} from "./types";

type IssueCode = PlanningIssue["code"];
type IssueScope = PlanningIssue["scope"];

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function issueContextKey(context: PlanningIssue["context"]): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(context).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function issueContextIdKey(context: PlanningIssue["context"]): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(context)
        .filter(([key]) => key === "id" || key.endsWith("Id"))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function sortIssues(issues: ReadonlyArray<PlanningIssue>): PlanningIssue[] {
  return [...issues].sort((left, right) => {
    const sourceComparison = (left.sourceEntityId ?? "").localeCompare(
      right.sourceEntityId ?? "",
    );
    if (sourceComparison !== 0) return sourceComparison;
    const codeComparison = left.code.localeCompare(right.code);
    if (codeComparison !== 0) return codeComparison;
    const scopeComparison = left.scope.localeCompare(right.scope);
    if (scopeComparison !== 0) return scopeComparison;
    const contextIdComparison = issueContextIdKey(left.context).localeCompare(
      issueContextIdKey(right.context),
    );
    if (contextIdComparison !== 0) return contextIdComparison;
    return issueContextKey(left.context).localeCompare(
      issueContextKey(right.context),
    );
  });
}

function planningIssue(
  code: IssueCode,
  scope: IssueScope,
  sourceEntityId: string | null,
  context: PlanningIssue["context"] = {},
): PlanningIssue {
  return {
    code,
    scope,
    sourceEntityId,
    message: PLANNING_ISSUE_MESSAGES[code],
    context,
  };
}

function uniqueMap<T>(
  values: ReadonlyArray<T>,
  getId: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (result.has(id)) throw new Error(`Duplicate ${label} id: ${id}`);
    result.set(id, value);
  }
  return result;
}

function requireInventoryItem(
  inventoryItems: ReadonlyMap<string, PlanningSourceInventoryItem>,
  inventoryItemId: string,
): PlanningSourceInventoryItem {
  const item = inventoryItems.get(inventoryItemId);
  if (!item) {
    throw new Error(`Missing inventory item contract: ${inventoryItemId}`);
  }
  return item;
}

function decimalIsPositiveWithSixPlaces(value: string): boolean {
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.gt(0) && decimal.decimalPlaces() <= 6;
  } catch {
    return false;
  }
}

function buildPriceSnapshot(
  item: PlanningSourceInventoryItem,
): PlanningInventoryPrice {
  if (item.price === null) {
    return {
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      inventoryCategory: item.category,
      baseUnit: item.baseUnit,
      sourcePriceId: null,
      packPriceSatang: null,
      packBaseQuantity: null,
      effectiveAt: null,
      unitCostSatang: null,
    };
  }

  return {
    inventoryItemId: item.id,
    inventoryItemName: item.name,
    inventoryCategory: item.category,
    baseUnit: item.baseUnit,
    sourcePriceId: item.price.id,
    packPriceSatang: item.price.packPriceSatang,
    packBaseQuantity: item.price.packBaseQuantity,
    effectiveAt: item.price.effectiveAt,
    unitCostSatang: calculateUnitCostSatang(
      item.price.packPriceSatang,
      item.price.packBaseQuantity,
      "PLANNING_EXACT",
    ).toString(),
  };
}

function priceInput(item: PlanningSourceInventoryItem) {
  return item.price === null
    ? null
    : {
        packPriceSatang: item.price.packPriceSatang,
        packBaseQuantity: item.price.packBaseQuantity,
      };
}

function orderContainsProduct(
  order: PlanningSourceOrder,
  productId: string,
): boolean {
  return order.items.some((item) => item.productId === productId);
}

export function buildPlanningPreview(
  source: PlanningSourceData,
  overrides: ReadonlyArray<BatchOverride> = [],
): PlanningPreview {
  const blockers: PlanningIssue[] = [];
  const warnings: PlanningIssue[] = [];
  const activeOrders = source.orders.filter(
    (order) => order.fulfillmentStatus !== "CANCELLED",
  );
  const productsById = uniqueMap(source.products, (product) => product.id, "product");
  const inventoryById = uniqueMap(
    source.inventoryItems,
    (item) => item.id,
    "inventory item",
  );
  uniqueMap(source.orders, (order) => order.id, "order");
  uniqueMap(source.packagingRules, (rule) => rule.id, "packaging rule");
  const overridesByProductId = uniqueMap(
    overrides,
    (override) => override.productId,
    "batch override product",
  );

  if (source.cycle.status !== "OPEN") {
    blockers.push(
      planningIssue("CYCLE_NOT_OPEN", "CYCLE", source.cycle.id, {
        status: source.cycle.status,
      }),
    );
  }
  if (source.cycle.primaryDeliveryDate === null) {
    blockers.push(
      planningIssue(
        "MISSING_PRIMARY_DELIVERY_DATE",
        "CYCLE",
        source.cycle.id,
      ),
    );
  }
  if (activeOrders.length === 0) {
    blockers.push(planningIssue("NO_ACTIVE_ORDERS", "CYCLE", source.cycle.id));
  }

  const seenOrderItemIds = new Set<string>();
  const orderSnapshots = activeOrders
    .map((order) => {
      if (order.items.length === 0) {
        blockers.push(
          planningIssue("ORDER_WITHOUT_ITEMS", "ORDER", order.id, {
            customerName: order.customerName,
          }),
        );
      }
      for (const item of order.items) {
        if (seenOrderItemIds.has(item.id)) {
          throw new Error(`Duplicate order item id: ${item.id}`);
        }
        seenOrderItemIds.add(item.id);
      }

      if (order.paymentStatus === "UNPAID") {
        warnings.push(
          planningIssue("ORDER_UNPAID", "ORDER", order.id, {
            customerName: order.customerName,
          }),
        );
      } else if (order.paymentStatus === "PARTIAL") {
        warnings.push(
          planningIssue("ORDER_PARTIAL", "ORDER", order.id, {
            customerName: order.customerName,
          }),
        );
      }
      if (
        order.deliveryRequiresLocation &&
        (order.deliveryLocation === null || order.deliveryLocation.trim() === "")
      ) {
        warnings.push(
          planningIssue("MISSING_DELIVERY_LOCATION", "ORDER", order.id, {
            deliveryMethodName: order.deliveryMethodName,
          }),
        );
      }
      const primaryDeliveryDate = source.cycle.primaryDeliveryDate;
      if (
        primaryDeliveryDate !== null &&
        ((order.requestedDeliveryDate !== null &&
          order.requestedDeliveryDate !== primaryDeliveryDate) ||
          (order.confirmedDeliveryDate !== null &&
            order.confirmedDeliveryDate !== primaryDeliveryDate))
      ) {
        warnings.push(
          planningIssue("DELIVERY_DATE_MISMATCH", "ORDER", order.id, {
            primaryDeliveryDate,
            requestedDeliveryDate: order.requestedDeliveryDate,
            confirmedDeliveryDate: order.confirmedDeliveryDate,
          }),
        );
      }

      const totals = calculateOrderTotals(order);
      return {
        ...order,
        items: [...order.items].sort((left, right) => compareIds(left.id, right.id)),
        subtotalSatang: totals.subtotalSatang,
        grandTotalSatang: totals.grandTotalSatang,
        balanceSatang: totals.balanceSatang,
      };
    })
    .sort((left, right) => compareIds(left.id, right.id));

  const demandByProductId = new Map<string, Decimal>();
  for (const order of activeOrders) {
    for (const item of order.items) {
      if (!productsById.has(item.productId)) {
        throw new Error(`Missing product contract: ${item.productId}`);
      }
      demandByProductId.set(
        item.productId,
        (demandByProductId.get(item.productId) ?? new Decimal(0)).plus(
          item.quantity,
        ),
      );
    }
  }
  for (const productId of overridesByProductId.keys()) {
    if (!demandByProductId.has(productId)) {
      throw new Error(`Batch override references unordered product: ${productId}`);
    }
  }

  const productPlans: PlanningProductPlan[] = [];
  const recipePlans: PlanningRecipePlan[] = [];
  const productSourceById = new Map<string, PlanningSourceProduct>();

  for (const productId of [...demandByProductId.keys()].sort(compareIds)) {
    const product = productsById.get(productId)!;
    productSourceById.set(productId, product);
    const recipe = product.activeRecipe;
    if (recipe === null) {
      blockers.push(
        planningIssue("MISSING_ACTIVE_RECIPE", "PRODUCT", product.id, {
          productName: product.name,
        }),
      );
      continue;
    }
    if (!decimalIsPositiveWithSixPlaces(recipe.baseYieldQuantity)) {
      blockers.push(
        planningIssue("INVALID_RECIPE_YIELD", "PRODUCT", product.id, {
          baseYieldQuantity: recipe.baseYieldQuantity,
          productName: product.name,
        }),
      );
      continue;
    }

    const orderedQuantity = demandByProductId.get(productId)!.toString();
    let defaultPlan;
    try {
      defaultPlan = calculateBatchPlan({
        orderedQuantity,
        baseYieldQuantity: recipe.baseYieldQuantity,
        yieldUnit: recipe.yieldUnit,
        sellingUnit: product.sellingUnit,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Incompatible yield unit") {
        blockers.push(
          planningIssue("INCOMPATIBLE_YIELD_UNIT", "PRODUCT", product.id, {
            yieldUnit: recipe.yieldUnit,
            sellingUnit: product.sellingUnit,
          }),
        );
        continue;
      }
      throw error;
    }

    const override = overridesByProductId.get(productId);
    let batchPlan = defaultPlan;
    let overrideReason: string | null = null;
    if (override) {
      try {
        batchPlan = calculateBatchPlan({
          orderedQuantity,
          baseYieldQuantity: recipe.baseYieldQuantity,
          yieldUnit: recipe.yieldUnit,
          sellingUnit: product.sellingUnit,
          selectedBatchCount: override.selectedBatchCount,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Selected batch count")
        ) {
          blockers.push(
            planningIssue("INVALID_BATCH_OVERRIDE", "PRODUCT", product.id, {
              selectedBatchCount: override.selectedBatchCount,
            }),
          );
          batchPlan = defaultPlan;
        } else {
          throw error;
        }
      }

      const differs = !new Decimal(batchPlan.selectedBatchCount).eq(
        defaultPlan.suggestedBatchCount,
      );
      if (differs) {
        const trimmedReason = override.reason.trim();
        if (trimmedReason === "") {
          blockers.push(
            planningIssue("MISSING_OVERRIDE_REASON", "PRODUCT", product.id, {
              selectedBatchCount: batchPlan.selectedBatchCount,
              suggestedBatchCount: defaultPlan.suggestedBatchCount,
            }),
          );
        } else {
          overrideReason = trimmedReason;
        }
      }
    }

    if (new Decimal(batchPlan.outputDifference).lt(0)) {
      warnings.push(
        planningIssue("PLANNED_SHORTFALL", "PRODUCT", product.id, {
          orderedQuantity: batchPlan.orderedQuantity,
          plannedOutput: batchPlan.plannedOutput,
          outputDifference: batchPlan.outputDifference,
        }),
      );
    }

    const readyProductTemplates = source.productionTemplates.filter(
      (template) =>
        template.active &&
        template.scope === "PRODUCT" &&
        template.productId === product.id &&
        template.activities.length > 0,
    );
    if (readyProductTemplates.length !== 1) {
      blockers.push(
        planningIssue("MISSING_PRODUCT_TEMPLATE", "PRODUCT", product.id, {
          productName: product.name,
          templateHref: "/production/templates",
        }),
      );
    }

    const waste = resolveWasteAllowance(
      recipe.wasteAllowancePercent,
      source.settings.defaultWasteAllowancePercent,
    );
    productPlans.push({
      ...batchPlan,
      productId: product.id,
      productName: product.name,
      sellingUnit: product.sellingUnit,
      overrideReason,
    });
    recipePlans.push({
      productId: product.id,
      recipeId: recipe.recipeId,
      recipeVersionId: recipe.recipeVersionId,
      recipeName: recipe.recipeName,
      versionCode: recipe.versionCode,
      instructions: recipe.instructions,
      baseYieldQuantity: recipe.baseYieldQuantity,
      yieldUnit: recipe.yieldUnit,
      yieldInSellingUnit: batchPlan.yieldInSellingUnit,
      sellingUnit: product.sellingUnit,
      laborMinutesPerBatch: recipe.laborMinutesPerBatch,
      utilityCostSatangPerBatch: recipe.utilityCostSatangPerBatch,
      wasteAllowancePercent: waste.percent,
      wasteAllowanceSource: waste.source,
    });
  }

  const materialRequirements: PlanningMaterialRequirement[] = [];
  const requiredInventoryItemIds = new Set<string>();
  for (const productPlan of productPlans) {
    const recipe = productSourceById.get(productPlan.productId)!.activeRecipe!;
    const recipePlan = recipePlans.find(
      (candidate) => candidate.productId === productPlan.productId,
    )!;
    uniqueMap(
      recipe.ingredients,
      (ingredient) => ingredient.recipeIngredientId,
      "recipe ingredient",
    );
    for (const ingredient of recipe.ingredients) {
      const inventoryItem = requireInventoryItem(
        inventoryById,
        ingredient.inventoryItemId,
      );
      if (isPrepOnly(inventoryItem.ingredientKind ?? "STANDARD")) continue;
      requiredInventoryItemIds.add(inventoryItem.id);
      let calculation;
      try {
        calculation = calculateMaterialRequirement({
          quantityPerBatch: ingredient.quantityInBaseUnit,
          selectedBatchCount: productPlan.selectedBatchCount,
          wasteAllowancePercent: recipePlan.wasteAllowancePercent,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Ingredient quantity")
        ) {
          blockers.push(
            planningIssue(
              "INVALID_INGREDIENT_QUANTITY",
              "PRODUCT",
              productPlan.productId,
              {
                inventoryItemId: ingredient.inventoryItemId,
                quantityInBaseUnit: ingredient.quantityInBaseUnit,
                recipeIngredientId: ingredient.recipeIngredientId,
              },
            ),
          );
          continue;
        }
        throw error;
      }
      materialRequirements.push({
        ...calculation,
        productId: productPlan.productId,
        recipeIngredientId: ingredient.recipeIngredientId,
        inventoryItemId: inventoryItem.id,
        inventoryItemName: inventoryItem.name,
        baseUnit: inventoryItem.baseUnit,
        quantityPerBatch: ingredient.quantityInBaseUnit,
        selectedBatchCount: productPlan.selectedBatchCount,
        wasteAllowancePercent: recipePlan.wasteAllowancePercent,
        baseCostSatang: calculateRequirementCost(
          calculation.baseRequirement,
          priceInput(inventoryItem),
        ),
        wasteCostSatang: calculateRequirementCost(
          calculation.wasteQuantity,
          priceInput(inventoryItem),
        ),
      });
    }
  }
  materialRequirements.sort((left, right) => {
    const productComparison = compareIds(left.productId, right.productId);
    return productComparison === 0
      ? compareIds(left.recipeIngredientId, right.recipeIngredientId)
      : productComparison;
  });

  const productPlansById = new Map(
    productPlans.map((productPlan) => [productPlan.productId, productPlan]),
  );
  const packagingRequirements: PlanningPackagingRequirement[] = [];
  for (const rule of source.packagingRules) {
    let distinctOrderCount: number;
    let plannedOutput = "0";
    if (rule.scope === "PRODUCT") {
      if (
        rule.productId === null ||
        rule.deliveryMethodId !== null ||
        (rule.consumptionBasis !== "PER_PRODUCT_UNIT" &&
          rule.consumptionBasis !== "PER_ORDER")
      ) {
        throw new Error(`Invalid product packaging rule contract: ${rule.id}`);
      }
      const productPlan = productPlansById.get(rule.productId);
      if (!productPlan) continue;
      plannedOutput = productPlan.plannedOutput;
      distinctOrderCount = activeOrders.filter((order) =>
        orderContainsProduct(order, rule.productId!),
      ).length;
    } else {
      if (
        rule.deliveryMethodId === null ||
        rule.productId !== null ||
        rule.consumptionBasis !== "PER_DELIVERY"
      ) {
        throw new Error(`Invalid delivery packaging rule contract: ${rule.id}`);
      }
      distinctOrderCount = activeOrders.filter(
        (order) => order.deliveryMethodId === rule.deliveryMethodId,
      ).length;
      if (distinctOrderCount === 0) continue;
    }

    const inventoryItem = requireInventoryItem(
      inventoryById,
      rule.inventoryItemId,
    );
    requiredInventoryItemIds.add(inventoryItem.id);
    const calculation = calculatePackagingRequirement({
      basis: rule.consumptionBasis,
      ruleQuantity: rule.quantityInBaseUnit,
      plannedOutput,
      distinctOrderCount,
    });
    packagingRequirements.push({
      ...calculation,
      packagingRuleId: rule.id,
      scope: rule.scope,
      consumptionBasis: rule.consumptionBasis,
      productId: rule.productId,
      deliveryMethodId: rule.deliveryMethodId,
      targetName: rule.targetName,
      inventoryItemId: inventoryItem.id,
      inventoryItemName: inventoryItem.name,
      baseUnit: inventoryItem.baseUnit,
      ruleQuantity: rule.quantityInBaseUnit,
      costSatang: calculateRequirementCost(
        calculation.plannedRequirement,
        priceInput(inventoryItem),
      ),
    });
  }
  packagingRequirements.sort((left, right) =>
    compareIds(left.packagingRuleId, right.packagingRuleId),
  );

  const inventoryPrices = [...requiredInventoryItemIds]
    .sort(compareIds)
    .map((inventoryItemId) => {
      const item = requireInventoryItem(inventoryById, inventoryItemId);
      if (item.price === null) {
        warnings.push(
          planningIssue("MISSING_INVENTORY_PRICE", "INVENTORY_ITEM", item.id, {
            inventoryItemName: item.name,
          }),
        );
      }
      return buildPriceSnapshot(item);
    });

  const productCosts: PlanningProductCost[] = productPlans.map((productPlan) => {
    const recipe = productSourceById.get(productPlan.productId)!.activeRecipe!;
    const materials = materialRequirements.filter(
      (requirement) => requirement.productId === productPlan.productId,
    );
    const packaging = packagingRequirements.filter(
      (requirement) =>
        requirement.scope === "PRODUCT" &&
        requirement.productId === productPlan.productId,
    );
    const missingInventoryItemIds = [
      ...materials
        .filter(
          (requirement) =>
            requirement.baseCostSatang === null ||
            requirement.wasteCostSatang === null,
        )
        .map((requirement) => requirement.inventoryItemId),
      ...packaging
        .filter((requirement) => requirement.costSatang === null)
        .map((requirement) => requirement.inventoryItemId),
    ];
    return {
      productId: productPlan.productId,
      ...calculateProductCost({
        baseIngredientCosts: materials.map(
          (requirement) => requirement.baseCostSatang,
        ),
        wasteCosts: materials.map((requirement) => requirement.wasteCostSatang),
        productPackagingCosts: packaging.map(
          (requirement) => requirement.costSatang,
        ),
        laborCosts: [
          calculateLaborCost(
            recipe.laborMinutesPerBatch,
            productPlan.selectedBatchCount,
            source.settings.laborRateSatangPerHour,
          ),
        ],
        utilityCosts: [
          calculateUtilityCost(
            recipe.utilityCostSatangPerBatch,
            productPlan.selectedBatchCount,
          ),
        ],
        missingInventoryItemIds,
      }),
    };
  });

  const deliveryPackaging = packagingRequirements.filter(
    (requirement) => requirement.scope === "DELIVERY_METHOD",
  );
  const cycleMissingInventoryItemIds = [
    ...materialRequirements
      .filter(
        (requirement) =>
          requirement.baseCostSatang === null ||
          requirement.wasteCostSatang === null,
      )
      .map((requirement) => requirement.inventoryItemId),
    ...packagingRequirements
      .filter((requirement) => requirement.costSatang === null)
      .map((requirement) => requirement.inventoryItemId),
  ];
  const cycleCost = calculateCycleCost({
    baseIngredientCosts: materialRequirements.map(
      (requirement) => requirement.baseCostSatang,
    ),
    wasteCosts: materialRequirements.map(
      (requirement) => requirement.wasteCostSatang,
    ),
    productPackagingCosts: packagingRequirements
      .filter((requirement) => requirement.scope === "PRODUCT")
      .map((requirement) => requirement.costSatang),
    deliveryPackagingCosts: deliveryPackaging.map(
      (requirement) => requirement.costSatang,
    ),
    laborCosts: productCosts.map((cost) => cost.laborCostSatang),
    utilityCosts: productCosts.map((cost) => cost.utilityCostSatang),
    missingInventoryItemIds: cycleMissingInventoryItemIds,
  });

  return {
    calculatedAt: source.calculatedAt,
    cycle: source.cycle,
    inputFingerprint: createPlanningFingerprint(source),
    blockers: sortIssues(blockers),
    warnings: sortIssues(warnings),
    orderSnapshots,
    productPlans,
    recipePlans,
    inventoryPrices,
    materialRequirements,
    packagingRequirements,
    productCosts,
    cycleCost,
  };
}
