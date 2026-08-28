import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  deliveryMethods,
  productPackagingRules,
} from "@/modules/delivery/db/schema";
import {
  inventoryItems,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import { orderItems, orders } from "@/modules/orders/db/schema";
import type { PlanningSourceData } from "@/modules/planning/domain/types";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import { shopSettings } from "@/modules/settings/db/schema";
import type { UnitCode } from "@/modules/units/domain/units";

export type PlanningSourceReader = Pick<DatabaseClient, "select">;

const uuidSchema = z.string().uuid();

function canonicalDecimal(value: string): string {
  return new Decimal(value).toString();
}

function uniqueIds(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requiredValue<T>(
  values: ReadonlyMap<string, T>,
  id: string,
  label: string,
): T {
  const value = values.get(id);
  if (!value) throw new Error(`Missing ${label} contract: ${id}`);
  return value;
}

export async function loadPlanningSource(
  reader: PlanningSourceReader,
  ownerId: string,
  cycleId: string,
  asOf: Date,
): Promise<PlanningSourceData> {
  const parsedOwnerId = uuidSchema.safeParse(ownerId);
  const parsedCycleId = uuidSchema.safeParse(cycleId);
  if (!parsedOwnerId.success || !parsedCycleId.success) {
    throw new Error("Cycle not found");
  }
  const verifiedOwnerId = parsedOwnerId.data;
  const verifiedCycleId = parsedCycleId.data;

  const [cycleRow] = await reader
    .select()
    .from(bakeCycles)
    .where(
      and(
        eq(bakeCycles.ownerId, verifiedOwnerId),
        eq(bakeCycles.id, verifiedCycleId),
      ),
    )
    .limit(1);
  if (!cycleRow) throw new Error("Cycle not found");

  const [settingsRow] = await reader
    .select()
    .from(shopSettings)
    .where(eq(shopSettings.ownerId, verifiedOwnerId))
    .limit(1);
  if (!settingsRow) throw new Error("Shop settings not found");

  const orderRows = await reader
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.ownerId, verifiedOwnerId),
        eq(orders.bakeCycleId, verifiedCycleId),
      ),
    )
    .orderBy(asc(orders.id));
  const orderIds = orderRows.map((order) => order.id);
  const orderItemRows =
    orderIds.length === 0
      ? []
      : await reader
          .select()
          .from(orderItems)
          .where(
            and(
              eq(orderItems.ownerId, verifiedOwnerId),
              inArray(orderItems.orderId, orderIds),
            ),
          )
          .orderBy(asc(orderItems.id));

  const customerIds = uniqueIds(orderRows.map((order) => order.customerId));
  const customerRows =
    customerIds.length === 0
      ? []
      : await reader
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.ownerId, verifiedOwnerId),
              inArray(customers.id, customerIds),
            ),
          )
          .orderBy(asc(customers.id));
  const deliveryMethodIds = uniqueIds(
    orderRows.flatMap((order) =>
      order.deliveryMethodId === null ? [] : [order.deliveryMethodId],
    ),
  );
  const deliveryMethodRows =
    deliveryMethodIds.length === 0
      ? []
      : await reader
          .select()
          .from(deliveryMethods)
          .where(
            and(
              eq(deliveryMethods.ownerId, verifiedOwnerId),
              inArray(deliveryMethods.id, deliveryMethodIds),
            ),
          )
          .orderBy(asc(deliveryMethods.id));

  const orderedProductIds = uniqueIds(
    orderItemRows.map((item) => item.productId),
  );
  const productRows =
    orderedProductIds.length === 0
      ? []
      : await reader
          .select()
          .from(products)
          .where(
            and(
              eq(products.ownerId, verifiedOwnerId),
              inArray(products.id, orderedProductIds),
            ),
          )
          .orderBy(asc(products.id));
  const activeRecipeVersionIds = uniqueIds(
    productRows.flatMap((product) =>
      product.activeRecipeVersionId === null
        ? []
        : [product.activeRecipeVersionId],
    ),
  );
  const recipeVersionRows =
    activeRecipeVersionIds.length === 0
      ? []
      : await reader
          .select()
          .from(recipeVersions)
          .where(
            and(
              eq(recipeVersions.ownerId, verifiedOwnerId),
              inArray(recipeVersions.id, activeRecipeVersionIds),
            ),
          )
          .orderBy(asc(recipeVersions.id));
  const recipeIds = uniqueIds(
    recipeVersionRows.map((version) => version.recipeId),
  );
  const recipeRows =
    recipeIds.length === 0
      ? []
      : await reader
          .select()
          .from(recipes)
          .where(
            and(
              eq(recipes.ownerId, verifiedOwnerId),
              inArray(recipes.id, recipeIds),
            ),
          )
          .orderBy(asc(recipes.id));
  const recipeIngredientRows =
    activeRecipeVersionIds.length === 0
      ? []
      : await reader
          .select()
          .from(recipeIngredients)
          .where(
            and(
              eq(recipeIngredients.ownerId, verifiedOwnerId),
              inArray(
                recipeIngredients.recipeVersionId,
                activeRecipeVersionIds,
              ),
            ),
          )
          .orderBy(asc(recipeIngredients.id));

  const applicableRuleCondition = or(
    orderedProductIds.length === 0
      ? undefined
      : and(
          eq(productPackagingRules.scope, "PRODUCT"),
          inArray(productPackagingRules.productId, orderedProductIds),
        ),
    deliveryMethodIds.length === 0
      ? undefined
      : and(
          eq(productPackagingRules.scope, "DELIVERY_METHOD"),
          inArray(
            productPackagingRules.deliveryMethodId,
            deliveryMethodIds,
          ),
        ),
  );
  const packagingRuleRows =
    applicableRuleCondition === undefined
      ? []
      : await reader
          .select()
          .from(productPackagingRules)
          .where(
            and(
              eq(productPackagingRules.ownerId, verifiedOwnerId),
              applicableRuleCondition,
            ),
          )
          .orderBy(asc(productPackagingRules.id));

  const inventoryItemIds = uniqueIds([
    ...recipeIngredientRows.map((ingredient) => ingredient.inventoryItemId),
    ...packagingRuleRows.map((rule) => rule.inventoryItemId),
  ]);
  const inventoryItemRows =
    inventoryItemIds.length === 0
      ? []
      : await reader
          .select()
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.ownerId, verifiedOwnerId),
              inArray(inventoryItems.id, inventoryItemIds),
            ),
          )
          .orderBy(asc(inventoryItems.id));
  const priceRows =
    inventoryItemIds.length === 0
      ? []
      : await reader
          .select()
          .from(inventoryPrices)
          .where(
            and(
              eq(inventoryPrices.ownerId, verifiedOwnerId),
              inArray(inventoryPrices.inventoryItemId, inventoryItemIds),
              lte(inventoryPrices.effectiveAt, asOf),
            ),
          )
          .orderBy(
            asc(inventoryPrices.inventoryItemId),
            desc(inventoryPrices.effectiveAt),
            desc(inventoryPrices.createdAt),
            desc(inventoryPrices.id),
          );
  const selectedPriceByItemId = new Map<
    string,
    (typeof priceRows)[number]
  >();
  for (const price of priceRows) {
    if (!selectedPriceByItemId.has(price.inventoryItemId)) {
      selectedPriceByItemId.set(price.inventoryItemId, price);
    }
  }

  const customerById = new Map(customerRows.map((row) => [row.id, row]));
  const deliveryMethodById = new Map(
    deliveryMethodRows.map((row) => [row.id, row]),
  );
  const productById = new Map(productRows.map((row) => [row.id, row]));
  const recipeVersionById = new Map(
    recipeVersionRows.map((row) => [row.id, row]),
  );
  const recipeById = new Map(recipeRows.map((row) => [row.id, row]));
  const ingredientsByVersionId = new Map<
    string,
    typeof recipeIngredientRows
  >();
  for (const ingredient of recipeIngredientRows) {
    const ingredients = ingredientsByVersionId.get(
      ingredient.recipeVersionId,
    );
    if (ingredients) ingredients.push(ingredient);
    else ingredientsByVersionId.set(ingredient.recipeVersionId, [ingredient]);
  }
  const itemsByOrderId = new Map<string, typeof orderItemRows>();
  for (const item of orderItemRows) {
    const items = itemsByOrderId.get(item.orderId);
    if (items) items.push(item);
    else itemsByOrderId.set(item.orderId, [item]);
  }

  return {
    calculatedAt: new Date(asOf),
    cycle: {
      id: cycleRow.id,
      cycleNumber: cycleRow.cycleNumber,
      name: cycleRow.name,
      status: cycleRow.status,
      orderCutoffAt: cycleRow.orderCutoffAt,
      targetProductionDate: cycleRow.targetProductionDate,
      primaryDeliveryDate: cycleRow.primaryDeliveryDate,
    },
    settings: {
      laborRateSatangPerHour: settingsRow.laborRateSatangPerHour,
      defaultWasteAllowancePercent: canonicalDecimal(
        settingsRow.defaultWasteAllowancePercent,
      ),
      timezone: settingsRow.timezone,
      currency: settingsRow.currency,
    },
    orders: orderRows.map((order) => {
      const customer = requiredValue(
        customerById,
        order.customerId,
        "customer",
      );
      const deliveryMethod =
        order.deliveryMethodId === null
          ? null
          : requiredValue(
              deliveryMethodById,
              order.deliveryMethodId,
              "delivery method",
            );
      return {
        id: order.id,
        customerId: order.customerId,
        customerName: customer.name,
        deliveryMethodId: order.deliveryMethodId,
        deliveryMethodName: deliveryMethod?.name ?? null,
        deliveryRequiresLocation:
          deliveryMethod?.requiresDeliveryLocation ?? false,
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
        items: (itemsByOrderId.get(order.id) ?? []).map((item) => {
          const product = requiredValue(
            productById,
            item.productId,
            "product",
          );
          return {
            id: item.id,
            productId: item.productId,
            productName: product.name,
            sellingUnit: product.sellingUnit as UnitCode,
            quantity: item.quantity,
            unitPriceSatang: item.unitPriceSatang,
            lineNote: item.lineNote,
          };
        }),
      };
    }),
    products: productRows.map((product) => {
      if (product.activeRecipeVersionId === null) {
        return {
          id: product.id,
          name: product.name,
          sellingUnit: product.sellingUnit as UnitCode,
          activeRecipe: null,
        };
      }
      const version = requiredValue(
        recipeVersionById,
        product.activeRecipeVersionId,
        "active recipe version",
      );
      const recipe = requiredValue(recipeById, version.recipeId, "recipe");
      if (recipe.productId !== product.id) {
        throw new Error(
          `Active recipe version does not belong to product: ${product.id}`,
        );
      }
      return {
        id: product.id,
        name: product.name,
        sellingUnit: product.sellingUnit as UnitCode,
        activeRecipe: {
          recipeId: recipe.id,
          recipeName: recipe.name,
          recipeVersionId: version.id,
          versionCode: version.versionCode,
          baseYieldQuantity: canonicalDecimal(version.baseYieldQuantity),
          yieldUnit: version.yieldUnit as UnitCode,
          laborMinutesPerBatch: version.laborMinutesPerBatch,
          utilityCostSatangPerBatch: version.utilityCostSatangPerBatch,
          wasteAllowancePercent:
            version.wasteAllowancePercent === null
              ? null
              : canonicalDecimal(version.wasteAllowancePercent),
          instructions: version.instructions,
          ingredients: (ingredientsByVersionId.get(version.id) ?? []).map(
            (ingredient) => ({
              recipeIngredientId: ingredient.id,
              inventoryItemId: ingredient.inventoryItemId,
              quantityInBaseUnit: canonicalDecimal(
                ingredient.quantityInBaseUnit,
              ),
            }),
          ),
        },
      };
    }),
    packagingRules: packagingRuleRows.map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      productId: rule.productId,
      deliveryMethodId: rule.deliveryMethodId,
      targetName:
        rule.scope === "PRODUCT"
          ? requiredValue(productById, rule.productId!, "product").name
          : requiredValue(
              deliveryMethodById,
              rule.deliveryMethodId!,
              "delivery method",
            ).name,
      inventoryItemId: rule.inventoryItemId,
      consumptionBasis: rule.consumptionBasis,
      quantityInBaseUnit: canonicalDecimal(rule.quantityInBaseUnit),
    })),
    inventoryItems: inventoryItemRows.map((item) => {
      const price = selectedPriceByItemId.get(item.id);
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        baseUnit: item.baseUnit as UnitCode,
        price: price
          ? {
              id: price.id,
              packPriceSatang: price.packPriceSatang,
              packBaseQuantity: canonicalDecimal(price.packBaseQuantity),
              effectiveAt: price.effectiveAt,
            }
          : null,
      };
    }),
  };
}
