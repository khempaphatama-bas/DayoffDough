import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { customers } from "@/modules/customers/db/schema";
import {
  bakeCycles,
  bakeCycleStatusEnum,
} from "@/modules/cycles/db/schema";
import {
  deliveryMethods,
  packagingConsumptionBasisEnum,
  packagingRuleScopeEnum,
  productPackagingRules,
} from "@/modules/delivery/db/schema";
import {
  inventoryCategoryEnum,
  inventoryItems,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import {
  deliveryFeePayerEnum,
  orderFulfillmentStatusEnum,
  orderItems,
  orderPaymentStatusEnum,
  orders,
  orderSourceChannelEnum,
} from "@/modules/orders/db/schema";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";

export const planningSnapshotStatus = ["ACTIVE", "SUPERSEDED"] as const;
export const planningWarningScope = [
  "CYCLE",
  "ORDER",
  "PRODUCT",
  "INVENTORY_ITEM",
] as const;
export const wasteAllowanceSource = ["RECIPE", "SHOP_DEFAULT"] as const;

export const planningSnapshotStatusEnum = pgEnum(
  "planning_snapshot_status",
  planningSnapshotStatus,
);
export const planningWarningScopeEnum = pgEnum(
  "planning_warning_scope",
  planningWarningScope,
);
export const wasteAllowanceSourceEnum = pgEnum(
  "waste_allowance_source",
  wasteAllowanceSource,
);

export const cyclePlanningSnapshots = pgTable(
  "cycle_planning_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    bakeCycleId: uuid("bake_cycle_id").notNull(),
    generation: integer("generation").notNull(),
    status: planningSnapshotStatusEnum("status").notNull(),
    lockRequestId: uuid("lock_request_id").notNull(),
    inputFingerprint: varchar("input_fingerprint", { length: 64 }).notNull(),
    cycleNumber: integer("cycle_number").notNull(),
    cycleName: varchar("cycle_name", { length: 160 }).notNull(),
    orderCutoffAt: timestamp("order_cutoff_at", {
      withTimezone: true,
      mode: "date",
    }),
    targetProductionDate: date("target_production_date", {
      mode: "string",
    }).notNull(),
    primaryDeliveryDate: date("primary_delivery_date", {
      mode: "string",
    }).notNull(),
    laborRateSatangPerHour: integer("labor_rate_satang_per_hour").notNull(),
    defaultWasteAllowancePercent: numeric(
      "default_waste_allowance_percent",
      { precision: 7, scale: 4 },
    ).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    costComplete: boolean("cost_complete").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" })
      .notNull(),
    unlockedAt: timestamp("unlocked_at", {
      withTimezone: true,
      mode: "date",
    }),
    unlockReason: varchar("unlock_reason", { length: 2000 }),
    unlockedFromStatus: bakeCycleStatusEnum("unlocked_from_status"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_planning_snapshots_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_planning_snapshots_owner_cycle_generation_unique").on(
      table.ownerId,
      table.bakeCycleId,
      table.generation,
    ),
    unique("cycle_planning_snapshots_owner_cycle_id_unique").on(
      table.ownerId,
      table.bakeCycleId,
      table.id,
    ),
    unique("cycle_planning_snapshots_owner_lock_request_unique").on(
      table.ownerId,
      table.lockRequestId,
    ),
    uniqueIndex("cycle_planning_snapshots_one_active_per_cycle_idx")
      .on(table.ownerId, table.bakeCycleId)
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      name: "cycle_planning_snapshots_owned_cycle_fk",
      columns: [table.ownerId, table.bakeCycleId],
      foreignColumns: [bakeCycles.ownerId, bakeCycles.id],
    }).onDelete("restrict"),
    index("cycle_planning_snapshots_owner_cycle_locked_idx").on(
      table.ownerId,
      table.bakeCycleId,
      table.lockedAt,
    ),
    check(
      "cycle_planning_snapshots_generation_positive",
      sql`${table.generation} > 0`,
    ),
    check(
      "cycle_planning_snapshots_fingerprint_length",
      sql`char_length(${table.inputFingerprint}) = 64`,
    ),
    check(
      "cycle_planning_snapshots_cycle_number_positive",
      sql`${table.cycleNumber} > 0`,
    ),
    check(
      "cycle_planning_snapshots_labor_rate_non_negative",
      sql`${table.laborRateSatangPerHour} >= 0`,
    ),
    check(
      "cycle_planning_snapshots_waste_percent_range",
      sql`${table.defaultWasteAllowancePercent} >= 0 AND ${table.defaultWasteAllowancePercent} <= 100`,
    ),
    check(
      "cycle_planning_snapshots_unlock_metadata",
      sql`(${table.status} = 'ACTIVE' AND ${table.unlockedAt} IS NULL AND ${table.unlockReason} IS NULL AND ${table.unlockedFromStatus} IS NULL) OR (${table.status} = 'SUPERSEDED' AND ${table.unlockedAt} IS NOT NULL AND ${table.unlockReason} IS NOT NULL AND char_length(trim(${table.unlockReason})) > 0 AND ${table.unlockedFromStatus} IN ('LOCKED', 'IN_PRODUCTION'))`,
    ),
  ],
);

export const cyclePlanningWarnings = pgTable(
  "cycle_planning_warnings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    scope: planningWarningScopeEnum("scope").notNull(),
    sourceEntityId: uuid("source_entity_id"),
    message: text("message").notNull(),
    context: jsonb("context")
      .$type<Readonly<Record<string, string | number | boolean | null>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_planning_warnings_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    foreignKey({
      name: "cycle_planning_warnings_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    index("cycle_planning_warnings_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
  ],
);

export const cycleOrderSnapshots = pgTable(
  "cycle_order_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    sourceOrderId: uuid("source_order_id").notNull(),
    sourceCustomerId: uuid("source_customer_id").notNull(),
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    sourceDeliveryMethodId: uuid("source_delivery_method_id"),
    deliveryMethodName: varchar("delivery_method_name", { length: 160 }),
    deliveryRequiresLocation: boolean("delivery_requires_location").notNull(),
    sourceChannel: orderSourceChannelEnum("source_channel"),
    requestedDeliveryDate: date("requested_delivery_date", { mode: "string" }),
    confirmedDeliveryDate: date("confirmed_delivery_date", { mode: "string" }),
    confirmedDeliveryTime: time("confirmed_delivery_time"),
    deliveryLocation: varchar("delivery_location", { length: 2000 }),
    deliveryNote: varchar("delivery_note", { length: 2000 }),
    specialInstructions: varchar("special_instructions", { length: 2000 }),
    paymentStatus: orderPaymentStatusEnum("payment_status").notNull(),
    fulfillmentStatus: orderFulfillmentStatusEnum("fulfillment_status").notNull(),
    deliveryFeePayer: deliveryFeePayerEnum("delivery_fee_payer").notNull(),
    deliveryFeeChargedSatang: integer("delivery_fee_charged_satang").notNull(),
    deliveryCostSatang: integer("delivery_cost_satang").notNull(),
    discountSatang: integer("discount_satang").notNull(),
    amountPaidSatang: integer("amount_paid_satang").notNull(),
    subtotalSatang: integer("subtotal_satang").notNull(),
    grandTotalSatang: integer("grand_total_satang").notNull(),
    balanceSatang: integer("balance_satang").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_order_snapshots_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_order_snapshots_owner_snapshot_source_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceOrderId,
    ),
    unique("cycle_order_snapshots_owner_snapshot_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.id,
    ),
    unique("cycle_order_snapshots_owner_snapshot_source_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceOrderId,
      table.id,
    ),
    foreignKey({
      name: "cycle_order_snapshots_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_snapshots_owned_source_order_customer_fk",
      columns: [table.ownerId, table.sourceCustomerId, table.sourceOrderId],
      foreignColumns: [orders.ownerId, orders.customerId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_snapshots_owned_source_order_delivery_fk",
      columns: [
        table.ownerId,
        table.sourceDeliveryMethodId,
        table.sourceOrderId,
      ],
      foreignColumns: [orders.ownerId, orders.deliveryMethodId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_snapshots_owned_source_customer_fk",
      columns: [table.ownerId, table.sourceCustomerId],
      foreignColumns: [customers.ownerId, customers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_snapshots_owned_delivery_method_fk",
      columns: [table.ownerId, table.sourceDeliveryMethodId],
      foreignColumns: [deliveryMethods.ownerId, deliveryMethods.id],
    }).onDelete("restrict"),
    index("cycle_order_snapshots_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_order_snapshots_money_non_negative",
      sql`${table.deliveryFeeChargedSatang} >= 0 AND ${table.deliveryCostSatang} >= 0 AND ${table.discountSatang} >= 0 AND ${table.amountPaidSatang} >= 0 AND ${table.subtotalSatang} >= 0 AND ${table.grandTotalSatang} >= 0 AND ${table.balanceSatang} >= 0`,
    ),
  ],
);

export const cycleOrderItemSnapshots = pgTable(
  "cycle_order_item_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    orderSnapshotId: uuid("order_snapshot_id").notNull(),
    sourceOrderId: uuid("source_order_id").notNull(),
    sourceOrderItemId: uuid("source_order_item_id").notNull(),
    sourceProductId: uuid("source_product_id").notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    sellingUnit: varchar("selling_unit", { length: 16 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceSatang: integer("unit_price_satang").notNull(),
    lineNote: varchar("line_note", { length: 2000 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_order_item_snapshots_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_order_item_snapshots_owner_snapshot_source_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceOrderItemId,
    ),
    foreignKey({
      name: "cycle_order_item_snapshots_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_item_snapshots_owned_order_snapshot_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.sourceOrderId,
        table.orderSnapshotId,
      ],
      foreignColumns: [
        cycleOrderSnapshots.ownerId,
        cycleOrderSnapshots.planningSnapshotId,
        cycleOrderSnapshots.sourceOrderId,
        cycleOrderSnapshots.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_item_snapshots_owned_source_item_fk",
      columns: [
        table.ownerId,
        table.sourceOrderId,
        table.sourceProductId,
        table.sourceOrderItemId,
      ],
      foreignColumns: [
        orderItems.ownerId,
        orderItems.orderId,
        orderItems.productId,
        orderItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_order_item_snapshots_owned_source_product_fk",
      columns: [table.ownerId, table.sourceProductId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    index("cycle_order_item_snapshots_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check("cycle_order_item_snapshots_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "cycle_order_item_snapshots_price_non_negative",
      sql`${table.unitPriceSatang} >= 0`,
    ),
  ],
);

export const cycleRecipePlans = pgTable(
  "cycle_recipe_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    sourceProductId: uuid("source_product_id").notNull(),
    sourceRecipeId: uuid("source_recipe_id").notNull(),
    sourceRecipeVersionId: uuid("source_recipe_version_id").notNull(),
    recipeName: varchar("recipe_name", { length: 160 }).notNull(),
    versionCode: varchar("version_code", { length: 80 }).notNull(),
    instructions: text("instructions").notNull(),
    baseYieldQuantity: numeric("base_yield_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    yieldUnit: varchar("yield_unit", { length: 16 }).notNull(),
    yieldInSellingUnit: numeric("yield_in_selling_unit", {
      precision: 18,
      scale: 6,
    }).notNull(),
    sellingUnit: varchar("selling_unit", { length: 16 }).notNull(),
    laborMinutesPerBatch: integer("labor_minutes_per_batch").notNull(),
    utilityCostSatangPerBatch: integer("utility_cost_satang_per_batch").notNull(),
    wasteAllowancePercent: numeric("waste_allowance_percent", {
      precision: 7,
      scale: 4,
    }).notNull(),
    wasteAllowanceSource: wasteAllowanceSourceEnum("waste_allowance_source")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_recipe_plans_owner_id_id_unique").on(table.ownerId, table.id),
    unique("cycle_recipe_plans_owner_snapshot_product_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceProductId,
    ),
    unique("cycle_recipe_plans_owner_snapshot_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.id,
    ),
    unique("cycle_recipe_plans_owner_snapshot_product_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceProductId,
      table.id,
    ),
    unique("cycle_recipe_plans_owner_snapshot_version_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceRecipeVersionId,
      table.id,
    ),
    foreignKey({
      name: "cycle_recipe_plans_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_recipe_plans_owned_source_product_fk",
      columns: [table.ownerId, table.sourceProductId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_recipe_plans_owned_source_recipe_fk",
      columns: [table.ownerId, table.sourceProductId, table.sourceRecipeId],
      foreignColumns: [recipes.ownerId, recipes.productId, recipes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_recipe_plans_owned_source_version_fk",
      columns: [table.ownerId, table.sourceRecipeId, table.sourceRecipeVersionId],
      foreignColumns: [
        recipeVersions.ownerId,
        recipeVersions.recipeId,
        recipeVersions.id,
      ],
    }).onDelete("restrict"),
    index("cycle_recipe_plans_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_recipe_plans_yields_positive",
      sql`${table.baseYieldQuantity} > 0 AND ${table.yieldInSellingUnit} > 0`,
    ),
    check(
      "cycle_recipe_plans_labor_utility_non_negative",
      sql`${table.laborMinutesPerBatch} >= 0 AND ${table.utilityCostSatangPerBatch} >= 0`,
    ),
    check(
      "cycle_recipe_plans_waste_percent_range",
      sql`${table.wasteAllowancePercent} >= 0 AND ${table.wasteAllowancePercent} <= 100`,
    ),
  ],
);

export const cycleProductPlans = pgTable(
  "cycle_product_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    sourceProductId: uuid("source_product_id").notNull(),
    recipePlanId: uuid("recipe_plan_id").notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    sellingUnit: varchar("selling_unit", { length: 16 }).notNull(),
    orderedQuantity: integer("ordered_quantity").notNull(),
    suggestedBatchCount: integer("suggested_batch_count").notNull(),
    selectedBatchCount: numeric("selected_batch_count", {
      precision: 18,
      scale: 6,
    }).notNull(),
    overrideReason: varchar("override_reason", { length: 2000 }),
    plannedOutput: numeric("planned_output", {
      precision: 18,
      scale: 6,
    }).notNull(),
    outputDifference: numeric("output_difference", {
      precision: 18,
      scale: 6,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_product_plans_owner_id_id_unique").on(table.ownerId, table.id),
    unique("cycle_product_plans_owner_snapshot_product_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceProductId,
    ),
    unique("cycle_product_plans_owner_snapshot_recipe_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.recipePlanId,
    ),
    unique("cycle_product_plans_owner_snapshot_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.id,
    ),
    unique("cycle_product_plans_owner_snapshot_product_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.sourceProductId,
      table.id,
    ),
    unique("cycle_product_plans_owner_snapshot_recipe_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.recipePlanId,
      table.id,
    ),
    foreignKey({
      name: "cycle_product_plans_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_product_plans_owned_source_product_fk",
      columns: [table.ownerId, table.sourceProductId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_product_plans_owned_recipe_plan_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.sourceProductId,
        table.recipePlanId,
      ],
      foreignColumns: [
        cycleRecipePlans.ownerId,
        cycleRecipePlans.planningSnapshotId,
        cycleRecipePlans.sourceProductId,
        cycleRecipePlans.id,
      ],
    }).onDelete("restrict"),
    index("cycle_product_plans_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_product_plans_quantities_positive",
      sql`${table.orderedQuantity} > 0 AND ${table.suggestedBatchCount} > 0 AND ${table.selectedBatchCount} > 0 AND ${table.plannedOutput} > 0`,
    ),
    check(
      "cycle_product_plans_override_reason",
      sql`(${table.selectedBatchCount} = ${table.suggestedBatchCount} AND ${table.overrideReason} IS NULL) OR (${table.selectedBatchCount} <> ${table.suggestedBatchCount} AND ${table.overrideReason} IS NOT NULL AND ${table.overrideReason} ~ '[^[:space:]]')`,
    ),
  ],
);

export const cycleInventoryPriceSnapshots = pgTable(
  "cycle_inventory_price_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryItemName: varchar("inventory_item_name", { length: 160 }).notNull(),
    inventoryCategory: inventoryCategoryEnum("inventory_category").notNull(),
    baseUnit: varchar("base_unit", { length: 16 }).notNull(),
    sourcePriceId: uuid("source_price_id"),
    packPriceSatang: integer("pack_price_satang"),
    packBaseQuantity: numeric("pack_base_quantity", {
      precision: 18,
      scale: 6,
    }),
    effectiveAt: timestamp("effective_at", {
      withTimezone: true,
      mode: "date",
    }),
    unitCostSatang: numeric("unit_cost_satang", {
      precision: 24,
      scale: 12,
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_inventory_price_snapshots_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_inventory_price_snapshots_owner_snapshot_item_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.inventoryItemId,
    ),
    unique("cycle_inventory_price_snapshots_owner_snapshot_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.id,
    ),
    unique("cycle_inventory_price_snapshots_snapshot_item_id_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.inventoryItemId,
      table.id,
    ),
    foreignKey({
      name: "cycle_inventory_price_snapshots_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_inventory_price_snapshots_owned_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_inventory_price_snapshots_owned_source_price_fk",
      columns: [table.ownerId, table.inventoryItemId, table.sourcePriceId],
      foreignColumns: [
        inventoryPrices.ownerId,
        inventoryPrices.inventoryItemId,
        inventoryPrices.id,
      ],
    }).onDelete("restrict"),
    index("cycle_inventory_price_snapshots_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_inventory_price_snapshots_all_null_or_present",
      sql`(${table.sourcePriceId} IS NULL AND ${table.packPriceSatang} IS NULL AND ${table.packBaseQuantity} IS NULL AND ${table.effectiveAt} IS NULL AND ${table.unitCostSatang} IS NULL) OR (${table.sourcePriceId} IS NOT NULL AND ${table.packPriceSatang} IS NOT NULL AND ${table.packBaseQuantity} IS NOT NULL AND ${table.effectiveAt} IS NOT NULL AND ${table.unitCostSatang} IS NOT NULL)`,
    ),
    check(
      "cycle_inventory_price_snapshots_values_valid",
      sql`${table.packPriceSatang} IS NULL OR (${table.packPriceSatang} >= 0 AND ${table.packBaseQuantity} > 0 AND ${table.unitCostSatang} >= 0)`,
    ),
  ],
);

export const cycleMaterialRequirements = pgTable(
  "cycle_material_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    productPlanId: uuid("product_plan_id").notNull(),
    recipePlanId: uuid("recipe_plan_id").notNull(),
    sourceRecipeVersionId: uuid("source_recipe_version_id").notNull(),
    sourceRecipeIngredientId: uuid("source_recipe_ingredient_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    priceSnapshotId: uuid("price_snapshot_id").notNull(),
    inventoryItemName: varchar("inventory_item_name", { length: 160 }).notNull(),
    baseUnit: varchar("base_unit", { length: 16 }).notNull(),
    quantityPerBatch: numeric("quantity_per_batch", {
      precision: 18,
      scale: 6,
    }).notNull(),
    selectedBatchCount: numeric("selected_batch_count", {
      precision: 18,
      scale: 6,
    }).notNull(),
    baseRequirement: numeric("base_requirement", {
      precision: 18,
      scale: 6,
    }).notNull(),
    wasteAllowancePercent: numeric("waste_allowance_percent", {
      precision: 7,
      scale: 4,
    }).notNull(),
    wasteQuantity: numeric("waste_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    plannedRequirement: numeric("planned_requirement", {
      precision: 18,
      scale: 6,
    }).notNull(),
    baseCostSatang: integer("base_cost_satang"),
    wasteCostSatang: integer("waste_cost_satang"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_material_requirements_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    foreignKey({
      name: "cycle_material_requirements_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_material_requirements_owned_product_plan_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.recipePlanId,
        table.productPlanId,
      ],
      foreignColumns: [
        cycleProductPlans.ownerId,
        cycleProductPlans.planningSnapshotId,
        cycleProductPlans.recipePlanId,
        cycleProductPlans.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_material_requirements_owned_recipe_plan_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.sourceRecipeVersionId,
        table.recipePlanId,
      ],
      foreignColumns: [
        cycleRecipePlans.ownerId,
        cycleRecipePlans.planningSnapshotId,
        cycleRecipePlans.sourceRecipeVersionId,
        cycleRecipePlans.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_material_requirements_owned_source_ingredient_fk",
      columns: [
        table.ownerId,
        table.sourceRecipeVersionId,
        table.inventoryItemId,
        table.sourceRecipeIngredientId,
      ],
      foreignColumns: [
        recipeIngredients.ownerId,
        recipeIngredients.recipeVersionId,
        recipeIngredients.inventoryItemId,
        recipeIngredients.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_material_requirements_owned_inventory_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_material_requirements_owned_price_snapshot_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.inventoryItemId,
        table.priceSnapshotId,
      ],
      foreignColumns: [
        cycleInventoryPriceSnapshots.ownerId,
        cycleInventoryPriceSnapshots.planningSnapshotId,
        cycleInventoryPriceSnapshots.inventoryItemId,
        cycleInventoryPriceSnapshots.id,
      ],
    }).onDelete("restrict"),
    index("cycle_material_requirements_owner_snapshot_item_idx").on(
      table.ownerId,
      table.planningSnapshotId,
      table.inventoryItemId,
    ),
    check(
      "cycle_material_requirements_quantities_valid",
      sql`${table.quantityPerBatch} > 0 AND ${table.selectedBatchCount} > 0 AND ${table.baseRequirement} > 0 AND ${table.wasteQuantity} >= 0 AND ${table.plannedRequirement} > 0`,
    ),
    check(
      "cycle_material_requirements_waste_percent_range",
      sql`${table.wasteAllowancePercent} >= 0 AND ${table.wasteAllowancePercent} <= 100`,
    ),
    check(
      "cycle_material_requirements_costs_all_null_or_present",
      sql`(${table.baseCostSatang} IS NULL AND ${table.wasteCostSatang} IS NULL) OR (${table.baseCostSatang} IS NOT NULL AND ${table.wasteCostSatang} IS NOT NULL)`,
    ),
    check(
      "cycle_material_requirements_costs_non_negative",
      sql`${table.baseCostSatang} IS NULL OR (${table.baseCostSatang} >= 0 AND ${table.wasteCostSatang} >= 0)`,
    ),
  ],
);

export const cyclePackagingRequirements = pgTable(
  "cycle_packaging_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    productPlanId: uuid("product_plan_id"),
    sourcePackagingRuleId: uuid("source_packaging_rule_id").notNull(),
    scope: packagingRuleScopeEnum("scope").notNull(),
    consumptionBasis: packagingConsumptionBasisEnum("consumption_basis")
      .notNull(),
    sourceProductId: uuid("source_product_id"),
    sourceDeliveryMethodId: uuid("source_delivery_method_id"),
    targetName: varchar("target_name", { length: 160 }).notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryItemName: varchar("inventory_item_name", { length: 160 }).notNull(),
    baseUnit: varchar("base_unit", { length: 16 }).notNull(),
    priceSnapshotId: uuid("price_snapshot_id").notNull(),
    ruleQuantity: numeric("rule_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    multiplier: numeric("multiplier", { precision: 18, scale: 6 }).notNull(),
    plannedRequirement: numeric("planned_requirement", {
      precision: 18,
      scale: 6,
    }).notNull(),
    costSatang: integer("cost_satang"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_packaging_requirements_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    foreignKey({
      name: "cycle_packaging_requirements_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_product_plan_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.sourceProductId,
        table.productPlanId,
      ],
      foreignColumns: [
        cycleProductPlans.ownerId,
        cycleProductPlans.planningSnapshotId,
        cycleProductPlans.sourceProductId,
        cycleProductPlans.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_source_rule_fk",
      columns: [
        table.ownerId,
        table.inventoryItemId,
        table.sourcePackagingRuleId,
      ],
      foreignColumns: [
        productPackagingRules.ownerId,
        productPackagingRules.inventoryItemId,
        productPackagingRules.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_rule_product_fk",
      columns: [
        table.ownerId,
        table.sourceProductId,
        table.sourcePackagingRuleId,
      ],
      foreignColumns: [
        productPackagingRules.ownerId,
        productPackagingRules.productId,
        productPackagingRules.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_rule_delivery_fk",
      columns: [
        table.ownerId,
        table.sourceDeliveryMethodId,
        table.sourcePackagingRuleId,
      ],
      foreignColumns: [
        productPackagingRules.ownerId,
        productPackagingRules.deliveryMethodId,
        productPackagingRules.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_rule_scope_basis_fk",
      columns: [
        table.ownerId,
        table.scope,
        table.consumptionBasis,
        table.sourcePackagingRuleId,
      ],
      foreignColumns: [
        productPackagingRules.ownerId,
        productPackagingRules.scope,
        productPackagingRules.consumptionBasis,
        productPackagingRules.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_source_product_fk",
      columns: [table.ownerId, table.sourceProductId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_delivery_method_fk",
      columns: [table.ownerId, table.sourceDeliveryMethodId],
      foreignColumns: [deliveryMethods.ownerId, deliveryMethods.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_inventory_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_packaging_requirements_owned_price_snapshot_fk",
      columns: [
        table.ownerId,
        table.planningSnapshotId,
        table.inventoryItemId,
        table.priceSnapshotId,
      ],
      foreignColumns: [
        cycleInventoryPriceSnapshots.ownerId,
        cycleInventoryPriceSnapshots.planningSnapshotId,
        cycleInventoryPriceSnapshots.inventoryItemId,
        cycleInventoryPriceSnapshots.id,
      ],
    }).onDelete("restrict"),
    index("cycle_packaging_requirements_owner_snapshot_item_idx").on(
      table.ownerId,
      table.planningSnapshotId,
      table.inventoryItemId,
    ),
    check(
      "cycle_packaging_requirements_scope_target",
      sql`(${table.scope} = 'PRODUCT' AND ${table.productPlanId} IS NOT NULL AND ${table.sourceProductId} IS NOT NULL AND ${table.sourceDeliveryMethodId} IS NULL) OR (${table.scope} = 'DELIVERY_METHOD' AND ${table.productPlanId} IS NULL AND ${table.sourceProductId} IS NULL AND ${table.sourceDeliveryMethodId} IS NOT NULL)`,
    ),
    check(
      "cycle_packaging_requirements_basis_valid",
      sql`(${table.scope} = 'PRODUCT' AND ${table.consumptionBasis} IN ('PER_PRODUCT_UNIT', 'PER_ORDER')) OR (${table.scope} = 'DELIVERY_METHOD' AND ${table.consumptionBasis} = 'PER_DELIVERY')`,
    ),
    check(
      "cycle_packaging_requirements_quantities_positive",
      sql`${table.ruleQuantity} > 0 AND ${table.multiplier} > 0 AND ${table.plannedRequirement} > 0`,
    ),
    check(
      "cycle_packaging_requirements_cost_non_negative",
      sql`${table.costSatang} IS NULL OR ${table.costSatang} >= 0`,
    ),
  ],
);

export const cycleProductCostSnapshots = pgTable(
  "cycle_product_cost_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    productPlanId: uuid("product_plan_id").notNull(),
    knownBaseIngredientCostSatang: integer(
      "known_base_ingredient_cost_satang",
    ).notNull(),
    knownWasteCostSatang: integer("known_waste_cost_satang").notNull(),
    knownProductPackagingCostSatang: integer(
      "known_product_packaging_cost_satang",
    ).notNull(),
    laborCostSatang: integer("labor_cost_satang").notNull(),
    utilityCostSatang: integer("utility_cost_satang").notNull(),
    knownProductionCostSatang: integer("known_production_cost_satang").notNull(),
    completeProductionCostSatang: integer("complete_production_cost_satang"),
    costComplete: boolean("cost_complete").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_product_cost_snapshots_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_product_cost_snapshots_owner_snapshot_product_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.productPlanId,
    ),
    foreignKey({
      name: "cycle_product_cost_snapshots_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_product_cost_snapshots_owned_product_plan_fk",
      columns: [table.ownerId, table.planningSnapshotId, table.productPlanId],
      foreignColumns: [
        cycleProductPlans.ownerId,
        cycleProductPlans.planningSnapshotId,
        cycleProductPlans.id,
      ],
    }).onDelete("restrict"),
    index("cycle_product_cost_snapshots_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_product_cost_snapshots_money_non_negative",
      sql`${table.knownBaseIngredientCostSatang} >= 0 AND ${table.knownWasteCostSatang} >= 0 AND ${table.knownProductPackagingCostSatang} >= 0 AND ${table.laborCostSatang} >= 0 AND ${table.utilityCostSatang} >= 0 AND ${table.knownProductionCostSatang} >= 0 AND (${table.completeProductionCostSatang} IS NULL OR ${table.completeProductionCostSatang} >= 0)`,
    ),
    check(
      "cycle_product_cost_snapshots_completeness",
      sql`(${table.costComplete} AND ${table.completeProductionCostSatang} IS NOT NULL) OR (NOT ${table.costComplete} AND ${table.completeProductionCostSatang} IS NULL)`,
    ),
  ],
);

export const cycleCostSnapshots = pgTable(
  "cycle_cost_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    knownBaseIngredientCostSatang: integer(
      "known_base_ingredient_cost_satang",
    ).notNull(),
    knownWasteCostSatang: integer("known_waste_cost_satang").notNull(),
    knownProductPackagingCostSatang: integer(
      "known_product_packaging_cost_satang",
    ).notNull(),
    knownDeliveryPackagingCostSatang: integer(
      "known_delivery_packaging_cost_satang",
    ).notNull(),
    laborCostSatang: integer("labor_cost_satang").notNull(),
    utilityCostSatang: integer("utility_cost_satang").notNull(),
    knownProductionCostSatang: integer("known_production_cost_satang").notNull(),
    completeProductionCostSatang: integer("complete_production_cost_satang"),
    missingPriceCount: integer("missing_price_count").notNull(),
    costComplete: boolean("cost_complete").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_cost_snapshots_owner_id_id_unique").on(table.ownerId, table.id),
    unique("cycle_cost_snapshots_owner_snapshot_unique").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    foreignKey({
      name: "cycle_cost_snapshots_owned_snapshot_fk",
      columns: [table.ownerId, table.planningSnapshotId],
      foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.id],
    }).onDelete("restrict"),
    index("cycle_cost_snapshots_owner_snapshot_idx").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_cost_snapshots_money_non_negative",
      sql`${table.knownBaseIngredientCostSatang} >= 0 AND ${table.knownWasteCostSatang} >= 0 AND ${table.knownProductPackagingCostSatang} >= 0 AND ${table.knownDeliveryPackagingCostSatang} >= 0 AND ${table.laborCostSatang} >= 0 AND ${table.utilityCostSatang} >= 0 AND ${table.knownProductionCostSatang} >= 0 AND (${table.completeProductionCostSatang} IS NULL OR ${table.completeProductionCostSatang} >= 0)`,
    ),
    check(
      "cycle_cost_snapshots_missing_price_non_negative",
      sql`${table.missingPriceCount} >= 0`,
    ),
    check(
      "cycle_cost_snapshots_completeness",
      sql`(${table.costComplete} AND ${table.completeProductionCostSatang} IS NOT NULL AND ${table.missingPriceCount} = 0) OR (NOT ${table.costComplete} AND ${table.completeProductionCostSatang} IS NULL AND ${table.missingPriceCount} > 0)`,
    ),
  ],
);
