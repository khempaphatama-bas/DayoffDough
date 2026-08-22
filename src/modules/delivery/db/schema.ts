import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { inventoryItems } from "@/modules/inventory/db/schema";
import { products } from "@/modules/products/db/schema";

export const packagingRuleScope = ["PRODUCT", "DELIVERY_METHOD"] as const;
export const packagingConsumptionBasis = [
  "PER_PRODUCT_UNIT",
  "PER_ORDER",
  "PER_DELIVERY",
] as const;

export const packagingRuleScopeEnum = pgEnum(
  "packaging_rule_scope",
  packagingRuleScope,
);
export const packagingConsumptionBasisEnum = pgEnum(
  "packaging_consumption_basis",
  packagingConsumptionBasis,
);

export const deliveryMethods = pgTable(
  "delivery_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    defaultCustomerFeeSatang: integer("default_customer_fee_satang").notNull(),
    defaultInternalCostSatang: integer("default_internal_cost_satang").notNull(),
    requiresDeliveryLocation: boolean("requires_delivery_location")
      .notNull()
      .default(true),
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
    unique("delivery_methods_owner_name_unique").on(table.ownerId, table.name),
    unique("delivery_methods_owner_id_id_unique").on(table.ownerId, table.id),
    index("delivery_methods_owner_id_idx").on(table.ownerId),
    check(
      "delivery_methods_customer_fee_non_negative",
      sql`${table.defaultCustomerFeeSatang} >= 0`,
    ),
    check(
      "delivery_methods_internal_cost_non_negative",
      sql`${table.defaultInternalCostSatang} >= 0`,
    ),
  ],
);

export const productPackagingRules = pgTable(
  "product_packaging_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    scope: packagingRuleScopeEnum("scope").notNull(),
    productId: uuid("product_id"),
    deliveryMethodId: uuid("delivery_method_id"),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    consumptionBasis: packagingConsumptionBasisEnum("consumption_basis").notNull(),
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
    foreignKey({
      name: "packaging_rules_owned_product_fk",
      columns: [table.ownerId, table.productId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "packaging_rules_owned_delivery_method_fk",
      columns: [table.ownerId, table.deliveryMethodId],
      foreignColumns: [deliveryMethods.ownerId, deliveryMethods.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "packaging_rules_owned_inventory_item_fk",
      columns: [table.ownerId, table.inventoryItemId],
      foreignColumns: [inventoryItems.ownerId, inventoryItems.id],
    }).onDelete("restrict"),
    index("packaging_rules_owner_id_idx").on(table.ownerId),
    check(
      "packaging_rules_quantity_positive",
      sql`${table.quantityInBaseUnit} > 0`,
    ),
    check(
      "packaging_rules_exact_scope_target",
      sql`(${table.scope} = 'PRODUCT' AND ${table.productId} IS NOT NULL AND ${table.deliveryMethodId} IS NULL) OR (${table.scope} = 'DELIVERY_METHOD' AND ${table.productId} IS NULL AND ${table.deliveryMethodId} IS NOT NULL)`,
    ),
    check(
      "packaging_rules_valid_combination",
      sql`(${table.scope} = 'PRODUCT' AND ${table.consumptionBasis} IN ('PER_PRODUCT_UNIT', 'PER_ORDER')) OR (${table.scope} = 'DELIVERY_METHOD' AND ${table.consumptionBasis} = 'PER_DELIVERY')`,
    ),
  ],
);
