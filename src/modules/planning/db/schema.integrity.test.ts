import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
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
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import {
  cycleCostSnapshots,
  cycleInventoryPriceSnapshots,
  cycleMaterialRequirements,
  cycleOrderItemSnapshots,
  cycleOrderSnapshots,
  cyclePackagingRequirements,
  cyclePlanningSnapshots,
  cycleProductCostSnapshots,
  cycleProductPlans,
  cycleRecipePlans,
} from "./schema";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>["db"];

async function insertSnapshot(
  db: TestDatabase,
  cycle: typeof bakeCycles.$inferSelect,
  lockRequestId: string,
) {
  const [snapshot] = await db
    .insert(cyclePlanningSnapshots)
    .values({
      ownerId: OWNER_ID,
      bakeCycleId: cycle.id,
      generation: 1,
      status: "ACTIVE",
      lockRequestId,
      inputFingerprint: lockRequestId[0]!.repeat(64),
      cycleNumber: cycle.cycleNumber,
      cycleName: cycle.name,
      targetProductionDate: cycle.targetProductionDate,
      primaryDeliveryDate: cycle.primaryDeliveryDate,
      laborRateSatangPerHour: 12000,
      defaultWasteAllowancePercent: "3",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt: new Date("2026-08-23T03:00:00Z"),
    })
    .returning();
  return snapshot!;
}

async function seedIntegrityScenario(db: TestDatabase) {
  const [deliveryMethod] = await db
    .insert(deliveryMethods)
    .values({
      ownerId: OWNER_ID,
      name: "Pickup",
      defaultCustomerFeeSatang: 0,
      defaultInternalCostSatang: 0,
    })
    .returning();
  const [customerA] = await db
    .insert(customers)
    .values({ ownerId: OWNER_ID, name: "Customer A" })
    .returning();
  const [customerB] = await db
    .insert(customers)
    .values({ ownerId: OWNER_ID, name: "Customer B" })
    .returning();

  const [flour] = await db
    .insert(inventoryItems)
    .values({
      ownerId: OWNER_ID,
      name: "Flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "bag",
      baseQuantityPerPurchasePack: "1000",
    })
    .returning();
  const [sugar] = await db
    .insert(inventoryItems)
    .values({
      ownerId: OWNER_ID,
      name: "Sugar",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "bag",
      baseQuantityPerPurchasePack: "1000",
    })
    .returning();
  const [box] = await db
    .insert(inventoryItems)
    .values({
      ownerId: OWNER_ID,
      name: "Box",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "pack",
      baseQuantityPerPurchasePack: "100",
    })
    .returning();
  const [bag] = await db
    .insert(inventoryItems)
    .values({
      ownerId: OWNER_ID,
      name: "Bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "pack",
      baseQuantityPerPurchasePack: "100",
    })
    .returning();

  async function insertSourcePrice(
    item: typeof inventoryItems.$inferSelect,
    packPriceSatang: number,
  ) {
    const [price] = await db
      .insert(inventoryPrices)
      .values({
        ownerId: OWNER_ID,
        inventoryItemId: item.id,
        packPriceSatang,
        packBaseQuantity: "1000",
        effectiveAt: new Date("2026-08-22T03:00:00Z"),
      })
      .returning();
    return price!;
  }

  const flourPrice = await insertSourcePrice(flour!, 5000);
  const sugarPrice = await insertSourcePrice(sugar!, 6000);
  const boxPrice = await insertSourcePrice(box!, 10000);
  const bagPrice = await insertSourcePrice(bag!, 8000);

  const [productA] = await db
    .insert(products)
    .values({
      ownerId: OWNER_ID,
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    })
    .returning();
  const [productB] = await db
    .insert(products)
    .values({
      ownerId: OWNER_ID,
      name: "Scone",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 8000,
    })
    .returning();
  const [recipeA] = await db
    .insert(recipes)
    .values({ ownerId: OWNER_ID, productId: productA!.id, name: "Focaccia" })
    .returning();
  const [recipeB] = await db
    .insert(recipes)
    .values({ ownerId: OWNER_ID, productId: productB!.id, name: "Scone" })
    .returning();
  const [versionA] = await db
    .insert(recipeVersions)
    .values({
      ownerId: OWNER_ID,
      recipeId: recipeA!.id,
      versionCode: "v1",
      baseYieldQuantity: "10",
      yieldUnit: "piece",
      laborMinutesPerBatch: 30,
      utilityCostSatangPerBatch: 100,
      instructions: "Mix and bake",
    })
    .returning();
  const [versionB] = await db
    .insert(recipeVersions)
    .values({
      ownerId: OWNER_ID,
      recipeId: recipeB!.id,
      versionCode: "v1",
      baseYieldQuantity: "8",
      yieldUnit: "piece",
      laborMinutesPerBatch: 20,
      utilityCostSatangPerBatch: 80,
      instructions: "Mix and bake",
    })
    .returning();
  const [ingredientA] = await db
    .insert(recipeIngredients)
    .values({
      ownerId: OWNER_ID,
      recipeVersionId: versionA!.id,
      inventoryItemId: flour!.id,
      quantityInBaseUnit: "1000",
    })
    .returning();
  const [ingredientB] = await db
    .insert(recipeIngredients)
    .values({
      ownerId: OWNER_ID,
      recipeVersionId: versionB!.id,
      inventoryItemId: sugar!.id,
      quantityInBaseUnit: "500",
    })
    .returning();
  const [ruleA] = await db
    .insert(productPackagingRules)
    .values({
      ownerId: OWNER_ID,
      scope: "PRODUCT",
      productId: productA!.id,
      inventoryItemId: box!.id,
      consumptionBasis: "PER_PRODUCT_UNIT",
      quantityInBaseUnit: "1",
    })
    .returning();
  const [ruleB] = await db
    .insert(productPackagingRules)
    .values({
      ownerId: OWNER_ID,
      scope: "PRODUCT",
      productId: productB!.id,
      inventoryItemId: bag!.id,
      consumptionBasis: "PER_PRODUCT_UNIT",
      quantityInBaseUnit: "1",
    })
    .returning();

  const [cycleA] = await db
    .insert(bakeCycles)
    .values({
      ownerId: OWNER_ID,
      name: "Cycle A",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    })
    .returning();
  const [cycleB] = await db
    .insert(bakeCycles)
    .values({
      ownerId: OWNER_ID,
      name: "Cycle B",
      targetProductionDate: "2026-09-05",
      primaryDeliveryDate: "2026-09-06",
    })
    .returning();
  const [orderA] = await db
    .insert(orders)
    .values({
      ownerId: OWNER_ID,
      customerId: customerA!.id,
      bakeCycleId: cycleA!.id,
      deliveryMethodId: deliveryMethod!.id,
    })
    .returning();
  const [orderB] = await db
    .insert(orders)
    .values({
      ownerId: OWNER_ID,
      customerId: customerB!.id,
      bakeCycleId: cycleB!.id,
      deliveryMethodId: deliveryMethod!.id,
    })
    .returning();
  const [orderItemA] = await db
    .insert(orderItems)
    .values({
      ownerId: OWNER_ID,
      orderId: orderA!.id,
      productId: productA!.id,
      quantity: 1,
      unitPriceSatang: 22000,
    })
    .returning();
  const [orderItemB] = await db
    .insert(orderItems)
    .values({
      ownerId: OWNER_ID,
      orderId: orderB!.id,
      productId: productB!.id,
      quantity: 1,
      unitPriceSatang: 8000,
    })
    .returning();
  const snapshotA = await insertSnapshot(
    db,
    cycleA!,
    "11111111-1111-4111-8111-111111111111",
  );
  const snapshotB = await insertSnapshot(
    db,
    cycleB!,
    "22222222-2222-4222-8222-222222222222",
  );

  return {
    deliveryMethod: deliveryMethod!,
    customerA: customerA!,
    customerB: customerB!,
    flour: flour!,
    sugar: sugar!,
    box: box!,
    bag: bag!,
    flourPrice,
    sugarPrice,
    boxPrice,
    bagPrice,
    productA: productA!,
    productB: productB!,
    recipeA: recipeA!,
    recipeB: recipeB!,
    versionA: versionA!,
    versionB: versionB!,
    ingredientA: ingredientA!,
    ingredientB: ingredientB!,
    ruleA: ruleA!,
    ruleB: ruleB!,
    cycleA: cycleA!,
    cycleB: cycleB!,
    orderA: orderA!,
    orderB: orderB!,
    orderItemA: orderItemA!,
    orderItemB: orderItemB!,
    snapshotA,
    snapshotB,
  };
}

async function insertOrderSnapshot(
  db: TestDatabase,
  input: Readonly<{
    snapshotId: string;
    order: typeof orders.$inferSelect;
    customer: typeof customers.$inferSelect;
    deliveryMethod: typeof deliveryMethods.$inferSelect;
    overrides?: Partial<typeof cycleOrderSnapshots.$inferInsert>;
  }>,
) {
  const [row] = await db
    .insert(cycleOrderSnapshots)
    .values({
      ownerId: OWNER_ID,
      planningSnapshotId: input.snapshotId,
      sourceOrderId: input.order.id,
      sourceCustomerId: input.customer.id,
      customerName: input.customer.name,
      sourceDeliveryMethodId: input.deliveryMethod.id,
      deliveryMethodName: input.deliveryMethod.name,
      paymentStatus: input.order.paymentStatus,
      fulfillmentStatus: input.order.fulfillmentStatus,
      deliveryFeePayer: input.order.deliveryFeePayer,
      deliveryFeeChargedSatang: 0,
      deliveryCostSatang: 0,
      discountSatang: 0,
      amountPaidSatang: 0,
      subtotalSatang: 10000,
      grandTotalSatang: 10000,
      balanceSatang: 10000,
      ...input.overrides,
    })
    .returning();
  return row!;
}

async function insertRecipePlan(
  db: TestDatabase,
  input: Readonly<{
    snapshotId: string;
    product: typeof products.$inferSelect;
    recipe: typeof recipes.$inferSelect;
    version: typeof recipeVersions.$inferSelect;
    overrides?: Partial<typeof cycleRecipePlans.$inferInsert>;
  }>,
) {
  const [row] = await db
    .insert(cycleRecipePlans)
    .values({
      ownerId: OWNER_ID,
      planningSnapshotId: input.snapshotId,
      sourceProductId: input.product.id,
      sourceRecipeId: input.recipe.id,
      sourceRecipeVersionId: input.version.id,
      recipeName: input.recipe.name,
      versionCode: input.version.versionCode,
      instructions: input.version.instructions,
      baseYieldQuantity: input.version.baseYieldQuantity,
      yieldUnit: input.version.yieldUnit,
      yieldInSellingUnit: input.version.baseYieldQuantity,
      sellingUnit: input.product.sellingUnit,
      laborMinutesPerBatch: input.version.laborMinutesPerBatch,
      utilityCostSatangPerBatch: input.version.utilityCostSatangPerBatch,
      wasteAllowancePercent: "0",
      wasteAllowanceSource: "SHOP_DEFAULT",
      ...input.overrides,
    })
    .returning();
  return row!;
}

async function insertProductPlan(
  db: TestDatabase,
  input: Readonly<{
    snapshotId: string;
    product: typeof products.$inferSelect;
    recipePlanId: string;
    overrides?: Partial<typeof cycleProductPlans.$inferInsert>;
  }>,
) {
  const [row] = await db
    .insert(cycleProductPlans)
    .values({
      ownerId: OWNER_ID,
      planningSnapshotId: input.snapshotId,
      sourceProductId: input.product.id,
      recipePlanId: input.recipePlanId,
      productName: input.product.name,
      sellingUnit: input.product.sellingUnit,
      orderedQuantity: 1,
      suggestedBatchCount: 1,
      selectedBatchCount: "1",
      plannedOutput: "1",
      outputDifference: "0",
      ...input.overrides,
    })
    .returning();
  return row!;
}

async function insertPriceSnapshot(
  db: TestDatabase,
  input: Readonly<{
    snapshotId: string;
    item: typeof inventoryItems.$inferSelect;
    price: typeof inventoryPrices.$inferSelect;
    overrides?: Partial<typeof cycleInventoryPriceSnapshots.$inferInsert>;
  }>,
) {
  const [row] = await db
    .insert(cycleInventoryPriceSnapshots)
    .values({
      ownerId: OWNER_ID,
      planningSnapshotId: input.snapshotId,
      inventoryItemId: input.item.id,
      inventoryItemName: input.item.name,
      inventoryCategory: input.item.category,
      baseUnit: input.item.baseUnit,
      sourcePriceId: input.price.id,
      packPriceSatang: input.price.packPriceSatang,
      packBaseQuantity: input.price.packBaseQuantity,
      effectiveAt: input.price.effectiveAt,
      unitCostSatang: "5",
      ...input.overrides,
    })
    .returning();
  return row!;
}

function productCostValues(
  snapshotId: string,
  productPlanId: string,
  overrides: Partial<typeof cycleProductCostSnapshots.$inferInsert> = {},
): typeof cycleProductCostSnapshots.$inferInsert {
  return {
    ownerId: OWNER_ID,
    planningSnapshotId: snapshotId,
    productPlanId,
    knownBaseIngredientCostSatang: 0,
    knownWasteCostSatang: 0,
    knownProductPackagingCostSatang: 0,
    laborCostSatang: 0,
    utilityCostSatang: 0,
    knownProductionCostSatang: 0,
    completeProductionCostSatang: 0,
    costComplete: true,
    ...overrides,
  };
}

function cycleCostValues(
  snapshotId: string,
  overrides: Partial<typeof cycleCostSnapshots.$inferInsert> = {},
): typeof cycleCostSnapshots.$inferInsert {
  return {
    ownerId: OWNER_ID,
    planningSnapshotId: snapshotId,
    knownBaseIngredientCostSatang: 0,
    knownWasteCostSatang: 0,
    knownProductPackagingCostSatang: 0,
    knownDeliveryPackagingCostSatang: 0,
    laborCostSatang: 0,
    utilityCostSatang: 0,
    knownProductionCostSatang: 0,
    completeProductionCostSatang: 0,
    missingPriceCount: 0,
    costComplete: true,
    ...overrides,
  };
}

async function seedProductPackagingRequirement(db: TestDatabase) {
  const scenario = await seedIntegrityScenario(db);
  const recipePlan = await insertRecipePlan(db, {
    snapshotId: scenario.snapshotA.id,
    product: scenario.productA,
    recipe: scenario.recipeA,
    version: scenario.versionA,
  });
  const productPlan = await insertProductPlan(db, {
    snapshotId: scenario.snapshotA.id,
    product: scenario.productA,
    recipePlanId: recipePlan.id,
  });
  const priceSnapshot = await insertPriceSnapshot(db, {
    snapshotId: scenario.snapshotA.id,
    item: scenario.box,
    price: scenario.boxPrice,
  });
  const values: typeof cyclePackagingRequirements.$inferInsert = {
    ownerId: OWNER_ID,
    planningSnapshotId: scenario.snapshotA.id,
    productPlanId: productPlan.id,
    sourcePackagingRuleId: scenario.ruleA.id,
    scope: "PRODUCT",
    consumptionBasis: "PER_PRODUCT_UNIT",
    sourceProductId: scenario.productA.id,
    targetName: scenario.productA.name,
    inventoryItemId: scenario.box.id,
    inventoryItemName: scenario.box.name,
    baseUnit: scenario.box.baseUnit,
    priceSnapshotId: priceSnapshot.id,
    ruleQuantity: "1",
    multiplier: "1",
    plannedRequirement: "1",
  };

  return { values };
}

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraint: string,
) {
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toBeInstanceOf(Error);
  expect(
    (rejection as Error & { cause?: { constraint?: string } }).cause,
  ).toMatchObject({ constraint });
}

describe("Phase 3A planning relationship integrity", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("rejects an order item snapshot whose order parent belongs to another generation", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const orderSnapshotB = await insertOrderSnapshot(context.db, {
      snapshotId: scenario.snapshotB.id,
      order: scenario.orderB,
      customer: scenario.customerB,
      deliveryMethod: scenario.deliveryMethod,
    });

    await expect(
      context.db.insert(cycleOrderItemSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        orderSnapshotId: orderSnapshotB.id,
        sourceOrderId: scenario.orderB.id,
        sourceOrderItemId: scenario.orderItemB.id,
        sourceProductId: scenario.productB.id,
        productName: scenario.productB.name,
        sellingUnit: scenario.productB.sellingUnit,
        quantity: 1,
        unitPriceSatang: 8000,
      }),
    ).rejects.toThrow();
  });

  it("rejects a product plan whose recipe parent belongs to another generation", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanB = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipe: scenario.recipeB,
      version: scenario.versionB,
    });

    await expect(
      insertProductPlan(context.db, {
        snapshotId: scenario.snapshotA.id,
        product: scenario.productB,
        recipePlanId: recipePlanB.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects a material requirement whose planning parents belong to another generation", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanB = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipe: scenario.recipeB,
      version: scenario.versionB,
    });
    const productPlanB = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipePlanId: recipePlanB.id,
    });
    const priceSnapshotB = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotB.id,
      item: scenario.sugar,
      price: scenario.sugarPrice,
    });

    await expect(
      context.db.insert(cycleMaterialRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanB.id,
        recipePlanId: recipePlanB.id,
        sourceRecipeVersionId: scenario.versionB.id,
        sourceRecipeIngredientId: scenario.ingredientB.id,
        inventoryItemId: scenario.sugar.id,
        priceSnapshotId: priceSnapshotB.id,
        inventoryItemName: scenario.sugar.name,
        baseUnit: scenario.sugar.baseUnit,
        quantityPerBatch: "500",
        selectedBatchCount: "1",
        baseRequirement: "500",
        wasteAllowancePercent: "0",
        wasteQuantity: "0",
        plannedRequirement: "500",
      }),
    ).rejects.toThrow();
  });

  it("rejects a packaging requirement whose product parent belongs to another generation", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanB = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipe: scenario.recipeB,
      version: scenario.versionB,
    });
    const productPlanB = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipePlanId: recipePlanB.id,
    });
    const priceSnapshotB = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotB.id,
      item: scenario.bag,
      price: scenario.bagPrice,
    });

    await expect(
      context.db.insert(cyclePackagingRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanB.id,
        sourcePackagingRuleId: scenario.ruleB.id,
        scope: "PRODUCT",
        consumptionBasis: "PER_PRODUCT_UNIT",
        sourceProductId: scenario.productB.id,
        targetName: scenario.productB.name,
        inventoryItemId: scenario.bag.id,
        inventoryItemName: scenario.bag.name,
        baseUnit: scenario.bag.baseUnit,
        priceSnapshotId: priceSnapshotB.id,
        ruleQuantity: "1",
        multiplier: "1",
        plannedRequirement: "1",
      }),
    ).rejects.toThrow();
  });

  it("rejects a product cost whose product parent belongs to another generation", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanB = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipe: scenario.recipeB,
      version: scenario.versionB,
    });
    const productPlanB = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotB.id,
      product: scenario.productB,
      recipePlanId: recipePlanB.id,
    });

    await expect(
      context.db.insert(cycleProductCostSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanB.id,
        knownBaseIngredientCostSatang: 0,
        knownWasteCostSatang: 0,
        knownProductPackagingCostSatang: 0,
        laborCostSatang: 0,
        utilityCostSatang: 0,
        knownProductionCostSatang: 0,
        completeProductionCostSatang: 0,
        costComplete: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects a cycle pointer to another cycle's snapshot", async () => {
    const scenario = await seedIntegrityScenario(context.db);

    await expect(
      context.db
        .update(bakeCycles)
        .set({ activePlanningSnapshotId: scenario.snapshotB.id })
        .where(eq(bakeCycles.id, scenario.cycleA.id)),
    ).rejects.toThrow();
  });

  it("rejects a price snapshot whose source price belongs to another item", async () => {
    const scenario = await seedIntegrityScenario(context.db);

    await expect(
      insertPriceSnapshot(context.db, {
        snapshotId: scenario.snapshotA.id,
        item: scenario.flour,
        price: scenario.sugarPrice,
      }),
    ).rejects.toThrow();
  });

  it("rejects a material requirement linked to another item's price snapshot", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const boxPriceSnapshot = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.box,
      price: scenario.boxPrice,
    });

    await expect(
      context.db.insert(cycleMaterialRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanA.id,
        recipePlanId: recipePlanA.id,
        sourceRecipeVersionId: scenario.versionA.id,
        sourceRecipeIngredientId: scenario.ingredientA.id,
        inventoryItemId: scenario.flour.id,
        priceSnapshotId: boxPriceSnapshot.id,
        inventoryItemName: scenario.flour.name,
        baseUnit: scenario.flour.baseUnit,
        quantityPerBatch: "1000",
        selectedBatchCount: "1",
        baseRequirement: "1000",
        wasteAllowancePercent: "0",
        wasteQuantity: "0",
        plannedRequirement: "1000",
      }),
    ).rejects.toThrow();
  });

  it("rejects a packaging requirement linked to another item's price snapshot", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const flourPriceSnapshot = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.flour,
      price: scenario.flourPrice,
    });

    await expect(
      context.db.insert(cyclePackagingRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanA.id,
        sourcePackagingRuleId: scenario.ruleA.id,
        scope: "PRODUCT",
        consumptionBasis: "PER_PRODUCT_UNIT",
        sourceProductId: scenario.productA.id,
        targetName: scenario.productA.name,
        inventoryItemId: scenario.box.id,
        inventoryItemName: scenario.box.name,
        baseUnit: scenario.box.baseUnit,
        priceSnapshotId: flourPriceSnapshot.id,
        ruleQuantity: "1",
        multiplier: "1",
        plannedRequirement: "1",
      }),
    ).rejects.toThrow();
  });

  it("rejects an order snapshot whose copied customer is not the source order customer", async () => {
    const scenario = await seedIntegrityScenario(context.db);

    await expect(
      insertOrderSnapshot(context.db, {
        snapshotId: scenario.snapshotA.id,
        order: scenario.orderA,
        customer: scenario.customerB,
        deliveryMethod: scenario.deliveryMethod,
      }),
    ).rejects.toThrow();
  });

  it("rejects an order item snapshot whose copied product is not the source item product", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const orderSnapshotA = await insertOrderSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      order: scenario.orderA,
      customer: scenario.customerA,
      deliveryMethod: scenario.deliveryMethod,
    });

    await expect(
      context.db.insert(cycleOrderItemSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        orderSnapshotId: orderSnapshotA.id,
        sourceOrderId: scenario.orderA.id,
        sourceOrderItemId: scenario.orderItemA.id,
        sourceProductId: scenario.productB.id,
        productName: scenario.productB.name,
        sellingUnit: scenario.productB.sellingUnit,
        quantity: 1,
        unitPriceSatang: 8000,
      }),
    ).rejects.toThrow();
  });

  it("rejects a same-product source item from another order", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const [otherOrderItem] = await context.db
      .insert(orderItems)
      .values({
        ownerId: OWNER_ID,
        orderId: scenario.orderB.id,
        productId: scenario.productA.id,
        quantity: 1,
        unitPriceSatang: 22000,
      })
      .returning();
    const orderSnapshotA = await insertOrderSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      order: scenario.orderA,
      customer: scenario.customerA,
      deliveryMethod: scenario.deliveryMethod,
    });

    await expect(
      context.db.insert(cycleOrderItemSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        orderSnapshotId: orderSnapshotA.id,
        sourceOrderId: scenario.orderA.id,
        sourceOrderItemId: otherOrderItem!.id,
        sourceProductId: scenario.productA.id,
        productName: scenario.productA.name,
        sellingUnit: scenario.productA.sellingUnit,
        quantity: 1,
        unitPriceSatang: 22000,
      }),
    ).rejects.toThrow();
  });

  it("rejects a recipe plan whose source recipe belongs to another product", async () => {
    const scenario = await seedIntegrityScenario(context.db);

    await expect(
      insertRecipePlan(context.db, {
        snapshotId: scenario.snapshotA.id,
        product: scenario.productA,
        recipe: scenario.recipeB,
        version: scenario.versionB,
      }),
    ).rejects.toThrow();
  });

  it("rejects a same-inventory source ingredient from another recipe version", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const [otherVersionIngredient] = await context.db
      .insert(recipeIngredients)
      .values({
        ownerId: OWNER_ID,
        recipeVersionId: scenario.versionB.id,
        inventoryItemId: scenario.flour.id,
        quantityInBaseUnit: "250",
      })
      .returning();
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const flourPriceSnapshot = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.flour,
      price: scenario.flourPrice,
    });

    await expect(
      context.db.insert(cycleMaterialRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanA.id,
        recipePlanId: recipePlanA.id,
        sourceRecipeVersionId: scenario.versionA.id,
        sourceRecipeIngredientId: otherVersionIngredient!.id,
        inventoryItemId: scenario.flour.id,
        priceSnapshotId: flourPriceSnapshot.id,
        inventoryItemName: scenario.flour.name,
        baseUnit: scenario.flour.baseUnit,
        quantityPerBatch: "250",
        selectedBatchCount: "1",
        baseRequirement: "250",
        wasteAllowancePercent: "0",
        wasteQuantity: "0",
        plannedRequirement: "250",
      }),
    ).rejects.toThrow();
  });

  it("rejects a packaging requirement whose source rule belongs to another item", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const bagPriceSnapshot = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.bag,
      price: scenario.bagPrice,
    });

    await expect(
      context.db.insert(cyclePackagingRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        productPlanId: productPlanA.id,
        sourcePackagingRuleId: scenario.ruleA.id,
        scope: "PRODUCT",
        consumptionBasis: "PER_PRODUCT_UNIT",
        sourceProductId: scenario.productA.id,
        targetName: scenario.productA.name,
        inventoryItemId: scenario.bag.id,
        inventoryItemName: scenario.bag.name,
        baseUnit: scenario.bag.baseUnit,
        priceSnapshotId: bagPriceSnapshot.id,
        ruleQuantity: "1",
        multiplier: "1",
        plannedRequirement: "1",
      }),
    ).rejects.toThrow();
  });

  it("rejects copied packaging scope and basis that differ from the source rule", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const boxPriceSnapshot = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.box,
      price: scenario.boxPrice,
    });

    await expect(
      context.db.insert(cyclePackagingRequirements).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        sourcePackagingRuleId: scenario.ruleA.id,
        scope: "DELIVERY_METHOD",
        consumptionBasis: "PER_DELIVERY",
        sourceDeliveryMethodId: scenario.deliveryMethod.id,
        targetName: scenario.deliveryMethod.name,
        inventoryItemId: scenario.box.id,
        inventoryItemName: scenario.box.name,
        baseUnit: scenario.box.baseUnit,
        priceSnapshotId: boxPriceSnapshot.id,
        ruleQuantity: "1",
        multiplier: "1",
        plannedRequirement: "1",
      }),
    ).rejects.toThrow();
  });

  it("enforces generation and lock-request uniqueness", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const supersededValues = {
      ownerId: OWNER_ID,
      bakeCycleId: scenario.cycleA.id,
      status: "SUPERSEDED" as const,
      cycleNumber: scenario.cycleA.cycleNumber,
      cycleName: scenario.cycleA.name,
      targetProductionDate: scenario.cycleA.targetProductionDate,
      primaryDeliveryDate: scenario.cycleA.primaryDeliveryDate,
      laborRateSatangPerHour: 12000,
      defaultWasteAllowancePercent: "3",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt: new Date("2026-08-23T03:00:00Z"),
      unlockedAt: new Date("2026-08-23T04:00:00Z"),
      unlockReason: "Replanned",
      unlockedFromStatus: "LOCKED" as const,
    };

    await expect(
      context.db.insert(cyclePlanningSnapshots).values({
        ...supersededValues,
        generation: 1,
        lockRequestId: "33333333-3333-4333-8333-333333333333",
        inputFingerprint: "3".repeat(64),
      }),
    ).rejects.toThrow();

    await expect(
      context.db.insert(cyclePlanningSnapshots).values({
        ...supersededValues,
        generation: 2,
        lockRequestId: scenario.snapshotB.lockRequestId,
        inputFingerprint: "4".repeat(64),
      }),
    ).rejects.toThrow();
  });

  it("enforces generation-scoped source and planning-row uniqueness", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const orderSnapshotA = await insertOrderSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      order: scenario.orderA,
      customer: scenario.customerA,
      deliveryMethod: scenario.deliveryMethod,
    });

    await expect(
      insertOrderSnapshot(context.db, {
        snapshotId: scenario.snapshotA.id,
        order: scenario.orderA,
        customer: scenario.customerA,
        deliveryMethod: scenario.deliveryMethod,
      }),
    ).rejects.toThrow();

    const orderItemValues = {
      ownerId: OWNER_ID,
      planningSnapshotId: scenario.snapshotA.id,
      orderSnapshotId: orderSnapshotA.id,
      sourceOrderId: scenario.orderA.id,
      sourceOrderItemId: scenario.orderItemA.id,
      sourceProductId: scenario.productA.id,
      productName: scenario.productA.name,
      sellingUnit: scenario.productA.sellingUnit,
      quantity: 1,
      unitPriceSatang: 22000,
    };
    await context.db.insert(cycleOrderItemSnapshots).values(orderItemValues);
    await expect(
      context.db.insert(cycleOrderItemSnapshots).values(orderItemValues),
    ).rejects.toThrow();

    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    await expect(
      insertRecipePlan(context.db, {
        snapshotId: scenario.snapshotA.id,
        product: scenario.productA,
        recipe: scenario.recipeA,
        version: scenario.versionA,
      }),
    ).rejects.toThrow();

    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    await expect(
      insertProductPlan(context.db, {
        snapshotId: scenario.snapshotA.id,
        product: scenario.productA,
        recipePlanId: recipePlanA.id,
      }),
    ).rejects.toThrow();

    const priceSnapshotA = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.flour,
      price: scenario.flourPrice,
    });
    await expect(
      insertPriceSnapshot(context.db, {
        snapshotId: scenario.snapshotA.id,
        item: scenario.flour,
        price: scenario.flourPrice,
      }),
    ).rejects.toThrow();

    expect(productPlanA.planningSnapshotId).toBe(scenario.snapshotA.id);
    expect(priceSnapshotA.planningSnapshotId).toBe(scenario.snapshotA.id);
  });

  it("enforces product-cost and cycle-cost row uniqueness", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const productCost = productCostValues(
      scenario.snapshotA.id,
      productPlanA.id,
    );

    await context.db.insert(cycleProductCostSnapshots).values(productCost);
    await expect(
      context.db.insert(cycleProductCostSnapshots).values(productCost),
    ).rejects.toThrow();

    const cycleCost = cycleCostValues(scenario.snapshotA.id);
    await context.db.insert(cycleCostSnapshots).values(cycleCost);
    await expect(
      context.db.insert(cycleCostSnapshots).values(cycleCost),
    ).rejects.toThrow();
  });

  it("rejects non-positive generation and quantities and negative money", async () => {
    const scenario = await seedIntegrityScenario(context.db);

    await expect(
      context.db
        .update(cyclePlanningSnapshots)
        .set({ generation: 0 })
        .where(eq(cyclePlanningSnapshots.id, scenario.snapshotA.id)),
    ).rejects.toThrow();

    await expect(
      insertOrderSnapshot(context.db, {
        snapshotId: scenario.snapshotA.id,
        order: scenario.orderA,
        customer: scenario.customerA,
        deliveryMethod: scenario.deliveryMethod,
        overrides: { deliveryCostSatang: -1 },
      }),
    ).rejects.toThrow();

    const orderSnapshotA = await insertOrderSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      order: scenario.orderA,
      customer: scenario.customerA,
      deliveryMethod: scenario.deliveryMethod,
    });
    const itemValues = {
      ownerId: OWNER_ID,
      planningSnapshotId: scenario.snapshotA.id,
      orderSnapshotId: orderSnapshotA.id,
      sourceOrderId: scenario.orderA.id,
      sourceOrderItemId: scenario.orderItemA.id,
      sourceProductId: scenario.productA.id,
      productName: scenario.productA.name,
      sellingUnit: scenario.productA.sellingUnit,
    };

    await expect(
      context.db.insert(cycleOrderItemSnapshots).values({
        ...itemValues,
        quantity: 0,
        unitPriceSatang: 22000,
      }),
    ).rejects.toThrow();
    await expect(
      context.db.insert(cycleOrderItemSnapshots).values({
        ...itemValues,
        quantity: 1,
        unitPriceSatang: -1,
      }),
    ).rejects.toThrow();
  });

  it("rejects partially populated inventory-price snapshots", async () => {
    const scenario = await seedIntegrityScenario(context.db);

    await expect(
      context.db.insert(cycleInventoryPriceSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: scenario.snapshotA.id,
        inventoryItemId: scenario.flour.id,
        inventoryItemName: scenario.flour.name,
        inventoryCategory: scenario.flour.category,
        baseUnit: scenario.flour.baseUnit,
        sourcePriceId: scenario.flourPrice.id,
      }),
    ).rejects.toThrow();
  });

  it("requires product-cost completeness to agree with its complete total", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });

    await expect(
      context.db.insert(cycleProductCostSnapshots).values(
        productCostValues(scenario.snapshotA.id, productPlanA.id, {
          completeProductionCostSatang: null,
          costComplete: true,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      context.db.insert(cycleProductCostSnapshots).values(
        productCostValues(scenario.snapshotA.id, productPlanA.id, {
          completeProductionCostSatang: 0,
          costComplete: false,
        }),
      ),
    ).rejects.toThrow();
  });

  it("requires an override reason exactly when selected batches differ", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });

    await expect(
      insertProductPlan(context.db, {
        snapshotId: scenario.snapshotA.id,
        product: scenario.productA,
        recipePlanId: recipePlanA.id,
        overrides: {
          selectedBatchCount: "2",
          plannedOutput: "2",
        },
      }),
    ).rejects.toThrow();
    await expect(
      insertProductPlan(context.db, {
        snapshotId: scenario.snapshotA.id,
        product: scenario.productA,
        recipePlanId: recipePlanA.id,
        overrides: { overrideReason: "Not actually overridden" },
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid packaging scope targets and consumption bases", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const priceSnapshotA = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.box,
      price: scenario.boxPrice,
    });
    const packagingValues = {
      ownerId: OWNER_ID,
      planningSnapshotId: scenario.snapshotA.id,
      productPlanId: productPlanA.id,
      sourcePackagingRuleId: scenario.ruleA.id,
      sourceProductId: scenario.productA.id,
      targetName: scenario.productA.name,
      inventoryItemId: scenario.box.id,
      inventoryItemName: scenario.box.name,
      baseUnit: scenario.box.baseUnit,
      priceSnapshotId: priceSnapshotA.id,
      ruleQuantity: "1",
      multiplier: "1",
      plannedRequirement: "1",
    };

    await expect(
      context.db.insert(cyclePackagingRequirements).values({
        ...packagingValues,
        scope: "PRODUCT",
        consumptionBasis: "PER_PRODUCT_UNIT",
        sourceDeliveryMethodId: scenario.deliveryMethod.id,
      }),
    ).rejects.toThrow();
    await expect(
      context.db.insert(cyclePackagingRequirements).values({
        ...packagingValues,
        scope: "DELIVERY_METHOD",
        consumptionBasis: "PER_PRODUCT_UNIT",
        productPlanId: null,
        sourceProductId: null,
        sourceDeliveryMethodId: scenario.deliveryMethod.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects a missing product-plan target via the local scope-target check", async () => {
    const { values } = await seedProductPackagingRequirement(context.db);

    await expectConstraintViolation(
      () =>
        context.db.insert(cyclePackagingRequirements).values({
          ...values,
          productPlanId: null,
        }),
      "cycle_packaging_requirements_scope_target",
    );
  });

  it("reports the local packaging basis check before overlapping source lineage rejection", async () => {
    const { values } = await seedProductPackagingRequirement(context.db);

    await expectConstraintViolation(
      () =>
        context.db.insert(cyclePackagingRequirements).values({
          ...values,
          consumptionBasis: "PER_DELIVERY",
        }),
      "cycle_packaging_requirements_basis_valid",
    );
  });

  it("rejects whitespace-only batch override reasons and accepts Thai text", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlan = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const whitespaceReasons = ["   ", "\t", "\n", "\r", " \t\r\n "] as const;

    for (const overrideReason of whitespaceReasons) {
      await expectConstraintViolation(
        () =>
          insertProductPlan(context.db, {
            snapshotId: scenario.snapshotA.id,
            product: scenario.productA,
            recipePlanId: recipePlan.id,
            overrides: {
              selectedBatchCount: "2",
              overrideReason,
              plannedOutput: "2",
            },
          }),
        "cycle_product_plans_override_reason",
      );
    }

    const valid = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlan.id,
      overrides: {
        selectedBatchCount: "2",
        overrideReason: "ปรับจำนวนรอบอบตามแผน",
        plannedOutput: "2",
      },
    });

    expect(valid.overrideReason).toBe("ปรับจำนวนรอบอบตามแผน");
  });

  it("restricts deletion of referenced source and planning parent rows", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.flour,
      price: scenario.flourPrice,
    });

    await expect(
      context.db
        .delete(inventoryPrices)
        .where(eq(inventoryPrices.id, scenario.flourPrice.id)),
    ).rejects.toThrow();
    await expect(
      context.db
        .delete(cyclePlanningSnapshots)
        .where(eq(cyclePlanningSnapshots.id, scenario.snapshotA.id)),
    ).rejects.toThrow();
  });

  it("rejects every invalid planning-snapshot scalar family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const invalidValues: ReadonlyArray<
      readonly [
        string,
        Partial<typeof cyclePlanningSnapshots.$inferInsert>,
      ]
    > = [
      ["generation", { generation: 0 }],
      ["fingerprint length", { inputFingerprint: "short" }],
      ["cycle number", { cycleNumber: 0 }],
      ["labor rate", { laborRateSatangPerHour: -1 }],
      ["waste below range", { defaultWasteAllowancePercent: "-0.0001" }],
      ["waste above range", { defaultWasteAllowancePercent: "100.0001" }],
    ];

    for (const [label, values] of invalidValues) {
      await expect(
        context.db
          .update(cyclePlanningSnapshots)
          .set(values)
          .where(eq(cyclePlanningSnapshots.id, scenario.snapshotA.id)),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects a negative value in every order-snapshot money field", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const invalidValues: ReadonlyArray<
      readonly [string, Partial<typeof cycleOrderSnapshots.$inferInsert>]
    > = [
      ["delivery fee charged", { deliveryFeeChargedSatang: -1 }],
      ["delivery cost", { deliveryCostSatang: -1 }],
      ["discount", { discountSatang: -1 }],
      ["amount paid", { amountPaidSatang: -1 }],
      ["subtotal", { subtotalSatang: -1 }],
      ["grand total", { grandTotalSatang: -1 }],
      ["balance", { balanceSatang: -1 }],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        insertOrderSnapshot(context.db, {
          snapshotId: scenario.snapshotA.id,
          order: scenario.orderA,
          customer: scenario.customerA,
          deliveryMethod: scenario.deliveryMethod,
          overrides,
        }),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid recipe-plan quantity and cost family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const invalidValues: ReadonlyArray<
      readonly [string, Partial<typeof cycleRecipePlans.$inferInsert>]
    > = [
      ["base yield", { baseYieldQuantity: "0" }],
      ["selling yield", { yieldInSellingUnit: "0" }],
      ["labor minutes", { laborMinutesPerBatch: -1 }],
      ["utility cost", { utilityCostSatangPerBatch: -1 }],
      ["waste below range", { wasteAllowancePercent: "-0.0001" }],
      ["waste above range", { wasteAllowancePercent: "100.0001" }],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        insertRecipePlan(context.db, {
          snapshotId: scenario.snapshotA.id,
          product: scenario.productA,
          recipe: scenario.recipeA,
          version: scenario.versionA,
          overrides,
        }),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid product-plan quantity and override family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const invalidValues: ReadonlyArray<
      readonly [string, Partial<typeof cycleProductPlans.$inferInsert>]
    > = [
      ["ordered quantity", { orderedQuantity: 0 }],
      ["suggested batch count", { suggestedBatchCount: 0 }],
      ["selected batch count", { selectedBatchCount: "0" }],
      ["planned output", { plannedOutput: "0" }],
      [
        "missing override reason",
        { selectedBatchCount: "2", plannedOutput: "2" },
      ],
      ["unexpected override reason", { overrideReason: "Not overridden" }],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        insertProductPlan(context.db, {
          snapshotId: scenario.snapshotA.id,
          product: scenario.productA,
          recipePlanId: recipePlanA.id,
          overrides,
        }),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid present inventory-price value family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const invalidValues: ReadonlyArray<
      readonly [
        string,
        Partial<typeof cycleInventoryPriceSnapshots.$inferInsert>,
      ]
    > = [
      ["pack price", { packPriceSatang: -1 }],
      ["pack quantity", { packBaseQuantity: "0" }],
      ["unit cost", { unitCostSatang: "-0.000000000001" }],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        insertPriceSnapshot(context.db, {
          snapshotId: scenario.snapshotA.id,
          item: scenario.flour,
          price: scenario.flourPrice,
          overrides,
        }),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid material quantity, percent, and cost family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const priceSnapshotA = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.flour,
      price: scenario.flourPrice,
    });
    const validValues: typeof cycleMaterialRequirements.$inferInsert = {
      ownerId: OWNER_ID,
      planningSnapshotId: scenario.snapshotA.id,
      productPlanId: productPlanA.id,
      recipePlanId: recipePlanA.id,
      sourceRecipeVersionId: scenario.versionA.id,
      sourceRecipeIngredientId: scenario.ingredientA.id,
      inventoryItemId: scenario.flour.id,
      priceSnapshotId: priceSnapshotA.id,
      inventoryItemName: scenario.flour.name,
      baseUnit: scenario.flour.baseUnit,
      quantityPerBatch: "1000",
      selectedBatchCount: "1",
      baseRequirement: "1000",
      wasteAllowancePercent: "0",
      wasteQuantity: "0",
      plannedRequirement: "1000",
    };
    const invalidValues: ReadonlyArray<
      readonly [string, Partial<typeof cycleMaterialRequirements.$inferInsert>]
    > = [
      ["quantity per batch", { quantityPerBatch: "0" }],
      ["selected batches", { selectedBatchCount: "0" }],
      ["base requirement", { baseRequirement: "0" }],
      ["waste quantity", { wasteQuantity: "-0.000001" }],
      ["planned requirement", { plannedRequirement: "0" }],
      ["waste below range", { wasteAllowancePercent: "-0.0001" }],
      ["waste above range", { wasteAllowancePercent: "100.0001" }],
      ["base cost only", { baseCostSatang: 0 }],
      ["waste cost only", { wasteCostSatang: 0 }],
      ["negative base cost", { baseCostSatang: -1, wasteCostSatang: 0 }],
      ["negative waste cost", { baseCostSatang: 0, wasteCostSatang: -1 }],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        context.db
          .insert(cycleMaterialRequirements)
          .values({ ...validValues, ...overrides }),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid packaging quantity, cost, and target family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const priceSnapshotA = await insertPriceSnapshot(context.db, {
      snapshotId: scenario.snapshotA.id,
      item: scenario.box,
      price: scenario.boxPrice,
    });
    const validValues: typeof cyclePackagingRequirements.$inferInsert = {
      ownerId: OWNER_ID,
      planningSnapshotId: scenario.snapshotA.id,
      productPlanId: productPlanA.id,
      sourcePackagingRuleId: scenario.ruleA.id,
      scope: "PRODUCT",
      consumptionBasis: "PER_PRODUCT_UNIT",
      sourceProductId: scenario.productA.id,
      targetName: scenario.productA.name,
      inventoryItemId: scenario.box.id,
      inventoryItemName: scenario.box.name,
      baseUnit: scenario.box.baseUnit,
      priceSnapshotId: priceSnapshotA.id,
      ruleQuantity: "1",
      multiplier: "1",
      plannedRequirement: "1",
    };
    const invalidValues: ReadonlyArray<
      readonly [
        string,
        Partial<typeof cyclePackagingRequirements.$inferInsert>,
      ]
    > = [
      ["scope target", { sourceDeliveryMethodId: scenario.deliveryMethod.id }],
      [
        "scope basis",
        {
          scope: "DELIVERY_METHOD",
          consumptionBasis: "PER_PRODUCT_UNIT",
          productPlanId: null,
          sourceProductId: null,
          sourceDeliveryMethodId: scenario.deliveryMethod.id,
        },
      ],
      ["rule quantity", { ruleQuantity: "0" }],
      ["multiplier", { multiplier: "0" }],
      ["planned requirement", { plannedRequirement: "0" }],
      ["cost", { costSatang: -1 }],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        context.db
          .insert(cyclePackagingRequirements)
          .values({ ...validValues, ...overrides }),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid product-cost money and completeness family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const recipePlanA = await insertRecipePlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipe: scenario.recipeA,
      version: scenario.versionA,
    });
    const productPlanA = await insertProductPlan(context.db, {
      snapshotId: scenario.snapshotA.id,
      product: scenario.productA,
      recipePlanId: recipePlanA.id,
    });
    const invalidValues: ReadonlyArray<
      readonly [string, Partial<typeof cycleProductCostSnapshots.$inferInsert>]
    > = [
      ["base ingredient", { knownBaseIngredientCostSatang: -1 }],
      ["waste", { knownWasteCostSatang: -1 }],
      ["packaging", { knownProductPackagingCostSatang: -1 }],
      ["labor", { laborCostSatang: -1 }],
      ["utility", { utilityCostSatang: -1 }],
      ["known total", { knownProductionCostSatang: -1 }],
      ["complete total", { completeProductionCostSatang: -1 }],
      [
        "complete without total",
        { costComplete: true, completeProductionCostSatang: null },
      ],
      [
        "incomplete with total",
        { costComplete: false, completeProductionCostSatang: 0 },
      ],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        context.db.insert(cycleProductCostSnapshots).values(
          productCostValues(
            scenario.snapshotA.id,
            productPlanA.id,
            overrides,
          ),
        ),
        label,
      ).rejects.toThrow();
    }
  });

  it("rejects every invalid cycle-cost money and completeness family", async () => {
    const scenario = await seedIntegrityScenario(context.db);
    const invalidValues: ReadonlyArray<
      readonly [string, Partial<typeof cycleCostSnapshots.$inferInsert>]
    > = [
      ["base ingredient", { knownBaseIngredientCostSatang: -1 }],
      ["waste", { knownWasteCostSatang: -1 }],
      ["product packaging", { knownProductPackagingCostSatang: -1 }],
      ["delivery packaging", { knownDeliveryPackagingCostSatang: -1 }],
      ["labor", { laborCostSatang: -1 }],
      ["utility", { utilityCostSatang: -1 }],
      ["known total", { knownProductionCostSatang: -1 }],
      ["complete total", { completeProductionCostSatang: -1 }],
      ["missing price count", { missingPriceCount: -1 }],
      [
        "complete without total",
        { costComplete: true, completeProductionCostSatang: null },
      ],
      ["complete with missing prices", { costComplete: true, missingPriceCount: 1 }],
      [
        "incomplete without missing prices",
        {
          costComplete: false,
          completeProductionCostSatang: null,
          missingPriceCount: 0,
        },
      ],
      [
        "incomplete with a complete total",
        {
          costComplete: false,
          completeProductionCostSatang: 0,
          missingPriceCount: 1,
        },
      ],
    ];

    for (const [label, overrides] of invalidValues) {
      await expect(
        context.db
          .insert(cycleCostSnapshots)
          .values(cycleCostValues(scenario.snapshotA.id, overrides)),
        label,
      ).rejects.toThrow();
    }
  });
});
