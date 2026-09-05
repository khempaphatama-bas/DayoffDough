import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  inventoryCategoryEnum,
  inventoryItems,
  inventoryMovements,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import {
  cycleInventoryPriceSnapshots,
  cyclePlanningSnapshots,
} from "@/modules/planning/db/schema";

export const cycleInventoryCounts = pgTable(
  "cycle_inventory_counts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    bakeCycleId: uuid("bake_cycle_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    priceSnapshotId: uuid("price_snapshot_id").notNull(),
    inventoryItemName: varchar("inventory_item_name", { length: 160 }).notNull(),
    inventoryCategory: inventoryCategoryEnum("inventory_category").notNull(),
    baseUnit: varchar("base_unit", { length: 16 }).notNull(),
    requiredQuantity: numeric("required_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    systemBalanceBeforeCount: numeric("system_balance_before_count", {
      precision: 18,
      scale: 6,
    }).notNull(),
    countedQuantity: numeric("counted_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    countDeltaQuantity: numeric("count_delta_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    purchaseUnitLabel: varchar("purchase_unit_label", {
      length: 160,
    }).notNull(),
    baseQuantityPerPurchasePack: numeric("base_quantity_per_purchase_pack", {
      precision: 18,
      scale: 6,
    }).notNull(),
    countMovementId: uuid("count_movement_id").notNull(),
    countedAt: timestamp("counted_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    confirmationRequestId: uuid("confirmation_request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_inventory_counts_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_inventory_counts_owner_snapshot_item_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.inventoryItemId,
    ),
    unique("cycle_inventory_counts_owner_cycle_snapshot_item_id_unique").on(
      table.ownerId,
      table.bakeCycleId,
      table.planningSnapshotId,
      table.inventoryItemId,
      table.id,
    ),
    foreignKey({
      name: "cycle_inventory_counts_owned_cycle_fk",
      columns: [table.ownerId, table.bakeCycleId],
      foreignColumns: [bakeCycles.ownerId, bakeCycles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_inventory_counts_owned_snapshot_fk",
      columns: [table.ownerId, table.bakeCycleId, table.planningSnapshotId],
      foreignColumns: [
        cyclePlanningSnapshots.ownerId,
        cyclePlanningSnapshots.bakeCycleId,
        cyclePlanningSnapshots.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_inventory_counts_owned_price_snapshot_fk",
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
    foreignKey({
      name: "cycle_inventory_counts_owned_inventory_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_inventory_counts_owned_movement_fk",
      columns: [table.ownerId, table.inventoryItemId, table.countMovementId],
      foreignColumns: [
        inventoryMovements.ownerId,
        inventoryMovements.inventoryItemId,
        inventoryMovements.id,
      ],
    }).onDelete("restrict"),
    index("cycle_inventory_counts_owner_cycle_snapshot_idx").on(
      table.ownerId,
      table.bakeCycleId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_inventory_counts_required_category",
      sql`${table.inventoryCategory} IN ('INGREDIENT', 'PACKAGING')`,
    ),
    check(
      "cycle_inventory_counts_quantities_valid",
      sql`${table.requiredQuantity} > 0 AND ${table.systemBalanceBeforeCount} >= 0 AND ${table.countedQuantity} >= 0 AND ${table.baseQuantityPerPurchasePack} > 0`,
    ),
    check(
      "cycle_inventory_counts_delta_matches",
      sql`${table.countDeltaQuantity} = ${table.countedQuantity} - ${table.systemBalanceBeforeCount}`,
    ),
  ],
).enableRLS();

export const cycleShoppingItems = pgTable(
  "cycle_shopping_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    bakeCycleId: uuid("bake_cycle_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    inventoryCountId: uuid("inventory_count_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    shortfallQuantity: numeric("shortfall_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    suggestedPackCount: integer("suggested_pack_count").notNull(),
    suggestedPurchaseQuantity: numeric("suggested_purchase_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    estimatedCostSatang: integer("estimated_cost_satang"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_shopping_items_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_shopping_items_owner_snapshot_item_unique").on(
      table.ownerId,
      table.planningSnapshotId,
      table.inventoryItemId,
    ),
    unique("cycle_shopping_items_owner_cycle_snapshot_item_id_unique").on(
      table.ownerId,
      table.bakeCycleId,
      table.planningSnapshotId,
      table.inventoryItemId,
      table.id,
    ),
    foreignKey({
      name: "cycle_shopping_items_owned_count_fk",
      columns: [
        table.ownerId,
        table.bakeCycleId,
        table.planningSnapshotId,
        table.inventoryItemId,
        table.inventoryCountId,
      ],
      foreignColumns: [
        cycleInventoryCounts.ownerId,
        cycleInventoryCounts.bakeCycleId,
        cycleInventoryCounts.planningSnapshotId,
        cycleInventoryCounts.inventoryItemId,
        cycleInventoryCounts.id,
      ],
    }).onDelete("restrict"),
    index("cycle_shopping_items_owner_cycle_snapshot_idx").on(
      table.ownerId,
      table.bakeCycleId,
      table.planningSnapshotId,
    ),
    check(
      "cycle_shopping_items_quantities_valid",
      sql`${table.shortfallQuantity} > 0 AND ${table.suggestedPackCount} > 0 AND ${table.suggestedPurchaseQuantity} > 0 AND ${table.suggestedPurchaseQuantity} >= ${table.shortfallQuantity}`,
    ),
    check(
      "cycle_shopping_items_estimated_cost_non_negative",
      sql`${table.estimatedCostSatang} IS NULL OR ${table.estimatedCostSatang} >= 0`,
    ),
  ],
).enableRLS();

export const cyclePurchaseEntries = pgTable(
  "cycle_purchase_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    bakeCycleId: uuid("bake_cycle_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    shoppingItemId: uuid("shopping_item_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    purchaseRequestId: uuid("purchase_request_id").notNull(),
    packCount: integer("pack_count").notNull(),
    packBaseQuantity: numeric("pack_base_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    purchasedQuantity: numeric("purchased_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    totalPriceSatang: integer("total_price_satang").notNull(),
    purchasedFrom: varchar("purchased_from", { length: 200 }),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    notes: text("notes"),
    inventoryMovementId: uuid("inventory_movement_id").notNull(),
    inventoryPriceId: uuid("inventory_price_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_purchase_entries_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_purchase_entries_owner_request_unique").on(
      table.ownerId,
      table.purchaseRequestId,
    ),
    unique("cycle_purchase_entries_owner_movement_unique").on(
      table.ownerId,
      table.inventoryMovementId,
    ),
    unique("cycle_purchase_entries_owner_price_unique").on(
      table.ownerId,
      table.inventoryPriceId,
    ),
    foreignKey({
      name: "cycle_purchase_entries_owned_shopping_item_fk",
      columns: [
        table.ownerId,
        table.bakeCycleId,
        table.planningSnapshotId,
        table.inventoryItemId,
        table.shoppingItemId,
      ],
      foreignColumns: [
        cycleShoppingItems.ownerId,
        cycleShoppingItems.bakeCycleId,
        cycleShoppingItems.planningSnapshotId,
        cycleShoppingItems.inventoryItemId,
        cycleShoppingItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_purchase_entries_owned_movement_fk",
      columns: [
        table.ownerId,
        table.inventoryItemId,
        table.inventoryMovementId,
      ],
      foreignColumns: [
        inventoryMovements.ownerId,
        inventoryMovements.inventoryItemId,
        inventoryMovements.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_purchase_entries_owned_price_fk",
      columns: [table.ownerId, table.inventoryItemId, table.inventoryPriceId],
      foreignColumns: [
        inventoryPrices.ownerId,
        inventoryPrices.inventoryItemId,
        inventoryPrices.id,
      ],
    }).onDelete("restrict"),
    index("cycle_purchase_entries_owner_cycle_snapshot_idx").on(
      table.ownerId,
      table.bakeCycleId,
      table.planningSnapshotId,
    ),
    index("cycle_purchase_entries_owner_shopping_occurred_idx").on(
      table.ownerId,
      table.shoppingItemId,
      table.occurredAt,
    ),
    check(
      "cycle_purchase_entries_quantities_valid",
      sql`${table.packCount} > 0 AND ${table.packBaseQuantity} > 0 AND ${table.purchasedQuantity} = ${table.packCount} * ${table.packBaseQuantity}`,
    ),
    check(
      "cycle_purchase_entries_total_price_non_negative",
      sql`${table.totalPriceSatang} >= 0`,
    ),
  ],
).enableRLS();
