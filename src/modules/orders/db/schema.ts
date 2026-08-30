import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { customers } from "@/modules/customers/db/schema";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { deliveryMethods } from "@/modules/delivery/db/schema";
import { products } from "@/modules/products/db/schema";

export const orderSourceChannel = [
  "INSTAGRAM",
  "FACEBOOK",
  "PHONE",
  "OTHER",
] as const;
export const deliveryFeePayer = ["CUSTOMER", "BAKERY", "SHARED"] as const;
export const orderPaymentStatus = [
  "UNPAID",
  "PARTIAL",
  "PAID",
  "REFUNDED",
] as const;
export const orderFulfillmentStatus = [
  "NEW",
  "CONFIRMED",
  "IN_PRODUCTION",
  "PACKED",
  "DELIVERED",
  "CANCELLED",
] as const;

export const orderSourceChannelEnum = pgEnum(
  "order_source_channel",
  orderSourceChannel,
);
export const deliveryFeePayerEnum = pgEnum(
  "delivery_fee_payer",
  deliveryFeePayer,
);
export const orderPaymentStatusEnum = pgEnum(
  "order_payment_status",
  orderPaymentStatus,
);
export const orderFulfillmentStatusEnum = pgEnum(
  "order_fulfillment_status",
  orderFulfillmentStatus,
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    bakeCycleId: uuid("bake_cycle_id").notNull(),
    sourceChannel: orderSourceChannelEnum("source_channel"),
    requestedDeliveryDate: date("requested_delivery_date", { mode: "string" }),
    confirmedDeliveryDate: date("confirmed_delivery_date", {
      mode: "string",
    }),
    deliveryMethodId: uuid("delivery_method_id"),
    deliveryFeeChargedSatang: integer("delivery_fee_charged_satang")
      .notNull()
      .default(0),
    deliveryCostSatang: integer("delivery_cost_satang").notNull().default(0),
    deliveryFeePayer: deliveryFeePayerEnum("delivery_fee_payer")
      .notNull()
      .default("CUSTOMER"),
    discountSatang: integer("discount_satang").notNull().default(0),
    amountPaidSatang: integer("amount_paid_satang").notNull().default(0),
    deliveryLocation: varchar("delivery_location", { length: 2000 }),
    deliveryNote: varchar("delivery_note", { length: 2000 }),
    specialInstructions: varchar("special_instructions", { length: 2000 }),
    paymentStatus: orderPaymentStatusEnum("payment_status")
      .notNull()
      .default("UNPAID"),
    fulfillmentStatus: orderFulfillmentStatusEnum("fulfillment_status")
      .notNull()
      .default("NEW"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("orders_owner_id_id_unique").on(table.ownerId, table.id),
    unique("orders_owner_customer_id_unique").on(
      table.ownerId,
      table.customerId,
      table.id,
    ),
    unique("orders_owner_delivery_method_id_unique").on(
      table.ownerId,
      table.deliveryMethodId,
      table.id,
    ),
    foreignKey({
      name: "orders_owned_customer_fk",
      columns: [table.ownerId, table.customerId],
      foreignColumns: [customers.ownerId, customers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_owned_bake_cycle_fk",
      columns: [table.ownerId, table.bakeCycleId],
      foreignColumns: [bakeCycles.ownerId, bakeCycles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_owned_delivery_method_fk",
      columns: [table.ownerId, table.deliveryMethodId],
      foreignColumns: [deliveryMethods.ownerId, deliveryMethods.id],
    }).onDelete("restrict"),
    index("orders_owner_cycle_created_idx").on(
      table.ownerId,
      table.bakeCycleId,
      table.createdAt,
    ),
    index("orders_owner_customer_created_idx").on(
      table.ownerId,
      table.customerId,
      table.createdAt,
    ),
    index("orders_owner_payment_fulfillment_idx").on(
      table.ownerId,
      table.paymentStatus,
      table.fulfillmentStatus,
    ),
    check(
      "orders_delivery_fee_non_negative",
      sql`${table.deliveryFeeChargedSatang} >= 0`,
    ),
    check(
      "orders_delivery_cost_non_negative",
      sql`${table.deliveryCostSatang} >= 0`,
    ),
    check("orders_discount_non_negative", sql`${table.discountSatang} >= 0`),
    check(
      "orders_amount_paid_non_negative",
      sql`${table.amountPaidSatang} >= 0`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceSatang: integer("unit_price_satang").notNull(),
    lineNote: varchar("line_note", { length: 2000 }),
    position: integer("position").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("order_items_owner_id_id_unique").on(table.ownerId, table.id),
    unique("order_items_owner_product_id_unique").on(
      table.ownerId,
      table.productId,
      table.id,
    ),
    unique("order_items_owner_order_product_id_unique").on(
      table.ownerId,
      table.orderId,
      table.productId,
      table.id,
    ),
    foreignKey({
      name: "order_items_owned_order_fk",
      columns: [table.ownerId, table.orderId],
      foreignColumns: [orders.ownerId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_items_owned_product_fk",
      columns: [table.ownerId, table.productId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    index("order_items_owner_order_idx").on(table.ownerId, table.orderId),
    uniqueIndex("order_items_owner_order_active_position_unique")
      .on(table.ownerId, table.orderId, table.position)
      .where(sql`${table.active} = true`),
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_items_position_non_negative", sql`${table.position} >= 0`),
    check(
      "order_items_unit_price_non_negative",
      sql`${table.unitPriceSatang} >= 0`,
    ),
  ],
);
