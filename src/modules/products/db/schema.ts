import { sql } from "drizzle-orm";
import {
  boolean,
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
import { inventoryItems } from "@/modules/inventory/db/schema";

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    sellingUnit: varchar("selling_unit", { length: 16 }).notNull(),
    defaultUnitPriceSatang: integer("default_unit_price_satang").notNull(),
    activeRecipeVersionId: uuid("active_recipe_version_id"),
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
    unique("products_owner_name_unique").on(table.ownerId, table.name),
    unique("products_owner_id_id_unique").on(table.ownerId, table.id),
    index("products_owner_id_idx").on(table.ownerId),
    check(
      "products_default_price_non_negative",
      sql`${table.defaultUnitPriceSatang} >= 0`,
    ),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("recipes_owner_product_unique").on(table.ownerId, table.productId),
    unique("recipes_owner_id_id_unique").on(table.ownerId, table.id),
    unique("recipes_owner_product_id_unique").on(
      table.ownerId,
      table.productId,
      table.id,
    ),
    foreignKey({
      name: "recipes_owned_product_fk",
      columns: [table.ownerId, table.productId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    index("recipes_owner_id_idx").on(table.ownerId),
  ],
);

export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    recipeId: uuid("recipe_id").notNull(),
    versionCode: varchar("version_code", { length: 80 }).notNull(),
    baseYieldQuantity: numeric("base_yield_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    yieldUnit: varchar("yield_unit", { length: 16 }).notNull(),
    laborMinutesPerBatch: integer("labor_minutes_per_batch").notNull(),
    utilityCostSatangPerBatch: integer("utility_cost_satang_per_batch").notNull(),
    wasteAllowancePercent: numeric("waste_allowance_percent", {
      precision: 7,
      scale: 4,
    }),
    instructions: text("instructions").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("recipe_versions_recipe_code_unique").on(
      table.recipeId,
      table.versionCode,
    ),
    unique("recipe_versions_owner_id_id_unique").on(table.ownerId, table.id),
    unique("recipe_versions_owner_recipe_id_unique").on(
      table.ownerId,
      table.recipeId,
      table.id,
    ),
    foreignKey({
      name: "recipe_versions_owned_recipe_fk",
      columns: [table.ownerId, table.recipeId],
      foreignColumns: [recipes.ownerId, recipes.id],
    }).onDelete("restrict"),
    index("recipe_versions_owner_recipe_idx").on(table.ownerId, table.recipeId),
    check(
      "recipe_versions_base_yield_positive",
      sql`${table.baseYieldQuantity} > 0`,
    ),
    check(
      "recipe_versions_labor_non_negative",
      sql`${table.laborMinutesPerBatch} >= 0`,
    ),
    check(
      "recipe_versions_utility_non_negative",
      sql`${table.utilityCostSatangPerBatch} >= 0`,
    ),
    check(
      "recipe_versions_waste_range",
      sql`${table.wasteAllowancePercent} IS NULL OR (${table.wasteAllowancePercent} >= 0 AND ${table.wasteAllowancePercent} <= 100)`,
    ),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    recipeVersionId: uuid("recipe_version_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    quantityInBaseUnit: numeric("quantity_in_base_unit", {
      precision: 18,
      scale: 6,
    }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("recipe_ingredients_owner_id_id_unique").on(table.ownerId, table.id),
    unique("recipe_ingredients_owner_item_id_unique").on(
      table.ownerId,
      table.inventoryItemId,
      table.id,
    ),
    unique("recipe_ingredients_owner_version_item_id_unique").on(
      table.ownerId,
      table.recipeVersionId,
      table.inventoryItemId,
      table.id,
    ),
    foreignKey({
      name: "recipe_ingredients_owned_version_fk",
      columns: [table.ownerId, table.recipeVersionId],
      foreignColumns: [recipeVersions.ownerId, recipeVersions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_ingredients_owned_inventory_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    index("recipe_ingredients_owner_version_idx").on(
      table.ownerId,
      table.recipeVersionId,
    ),
    check(
      "recipe_ingredients_quantity_positive",
      sql`${table.quantityInBaseUnit} > 0`,
    ),
  ],
);
