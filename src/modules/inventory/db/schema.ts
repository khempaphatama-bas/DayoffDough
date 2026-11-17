import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ingredientKinds } from "@/modules/inventory/domain/ingredient-kind";

export const inventoryCategory = [
  "INGREDIENT",
  "PACKAGING",
  "CONSUMABLE",
] as const;
export const inventoryMovementType = [
  "COUNT",
  "PURCHASE",
  "CONSUMPTION",
  "CORRECTION",
] as const;

export const inventoryCategoryEnum = pgEnum(
  "inventory_category",
  inventoryCategory,
);
export const inventoryMovementTypeEnum = pgEnum(
  "inventory_movement_type",
  inventoryMovementType,
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    category: inventoryCategoryEnum("category").notNull(),
    ingredientKind: varchar("ingredient_kind", { length: 16, enum: ingredientKinds })
      .notNull()
      .default("STANDARD"),
    baseUnit: varchar("base_unit", { length: 16 }).notNull(),
    purchaseUnitLabel: varchar("purchase_unit_label", { length: 160 }).notNull(),
    baseQuantityPerPurchasePack: numeric("base_quantity_per_purchase_pack", {
      precision: 18,
      scale: 6,
    }).notNull(),
    minimumStockQuantity: numeric("minimum_stock_quantity", {
      precision: 18,
      scale: 6,
    })
      .notNull()
      .default("0"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("inventory_items_owner_name_unique").on(table.ownerId, table.name),
    unique("inventory_items_owner_id_id_unique").on(table.ownerId, table.id),
    index("inventory_items_owner_id_idx").on(table.ownerId),
    check(
      "inventory_items_pack_quantity_positive",
      sql`${table.baseQuantityPerPurchasePack} > 0`,
    ),
    check(
      "inventory_items_minimum_stock_non_negative",
      sql`${table.minimumStockQuantity} >= 0`,
    ),
    check(
      "inventory_items_prep_only_values",
      sql`${table.ingredientKind} = 'STANDARD' OR (
        ${table.category} = 'INGREDIENT'
        AND ((${table.ingredientKind} = 'WATER' AND ${table.baseUnit} IN ('ml', 'l'))
          OR (${table.ingredientKind} = 'ICE' AND ${table.baseUnit} IN ('g', 'kg')))
        AND ${table.purchaseUnitLabel} = 'ไม่ต้องซื้อ'
        AND ${table.baseQuantityPerPurchasePack} = 1
        AND ${table.minimumStockQuantity} = 0
      )`,
    ),
  ],
);

export const inventoryPrices = pgTable(
  "inventory_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    packPriceSatang: integer("pack_price_satang").notNull(),
    packBaseQuantity: numeric("pack_base_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    purchasedFrom: varchar("purchased_from", { length: 200 }),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" })
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("inventory_prices_owner_id_id_unique").on(table.ownerId, table.id),
    unique("inventory_prices_owner_item_id_unique").on(
      table.ownerId,
      table.inventoryItemId,
      table.id,
    ),
    foreignKey({
      name: "inventory_prices_owned_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    index("inventory_prices_owner_item_effective_idx").on(
      table.ownerId,
      table.inventoryItemId,
      table.effectiveAt,
    ),
    check(
      "inventory_prices_pack_price_non_negative",
      sql`${table.packPriceSatang} >= 0`,
    ),
    check(
      "inventory_prices_pack_quantity_positive",
      sql`${table.packBaseQuantity} > 0`,
    ),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    type: inventoryMovementTypeEnum("type").notNull(),
    quantityDeltaInBaseUnit: numeric("quantity_delta_in_base_unit", {
      precision: 18,
      scale: 6,
    }).notNull(),
    countedQuantityInBaseUnit: numeric("counted_quantity_in_base_unit", {
      precision: 18,
      scale: 6,
    }),
    referenceType: varchar("reference_type", { length: 80 }),
    referenceId: uuid("reference_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("inventory_movements_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("inventory_movements_owner_item_id_unique").on(
      table.ownerId,
      table.inventoryItemId,
      table.id,
    ),
    foreignKey({
      name: "inventory_movements_owned_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    index("inventory_movements_owner_item_occurred_idx").on(
      table.ownerId,
      table.inventoryItemId,
      table.occurredAt,
    ),
    check(
      "inventory_movements_count_requires_quantity",
      sql`${table.type} <> 'COUNT' OR ${table.countedQuantityInBaseUnit} IS NOT NULL`,
    ),
    check(
      "inventory_movements_count_non_negative",
      sql`${table.countedQuantityInBaseUnit} IS NULL OR ${table.countedQuantityInBaseUnit} >= 0`,
    ),
  ],
);

// Applied cutover tokens only; the authoritative balance remains SUM(movements).
export const inventoryLedgerStates = pgTable("inventory_ledger_states", {
  ownerId: uuid("owner_id").notNull(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  ledgerRevision: bigint("ledger_revision", { mode: "bigint" }).notNull().default(sql`0`),
  latestCountMovementId: uuid("latest_count_movement_id"),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.inventoryItemId] }),
  foreignKey({ name: "ledger_states_owned_item_fk", columns: [table.ownerId, table.inventoryItemId], foreignColumns: [inventoryItems.ownerId, inventoryItems.id] }).onDelete("restrict"),
  foreignKey({ name: "ledger_states_owned_count_fk", columns: [table.ownerId, table.inventoryItemId, table.latestCountMovementId], foreignColumns: [inventoryMovements.ownerId, inventoryMovements.inventoryItemId, inventoryMovements.id] }).onDelete("restrict"),
  check("ledger_states_revision_nonnegative", sql`${table.ledgerRevision} >= 0`),
]).enableRLS();
