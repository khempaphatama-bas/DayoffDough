import {
  boolean,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { deliveryMethods } from "@/modules/delivery/db/schema";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    contactHandle: varchar("contact_handle", { length: 200 }),
    phone: varchar("phone", { length: 200 }),
    defaultDeliveryMethodId: uuid("default_delivery_method_id"),
    defaultDeliveryLocation: varchar("default_delivery_location", {
      length: 2000,
    }),
    defaultDeliveryNote: varchar("default_delivery_note", { length: 2000 }),
    notes: varchar("notes", { length: 2000 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("customers_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "customers_owned_default_delivery_method_fk",
      columns: [table.ownerId, table.defaultDeliveryMethodId],
      foreignColumns: [deliveryMethods.ownerId, deliveryMethods.id],
    }).onDelete("restrict"),
    index("customers_owner_name_idx").on(table.ownerId, table.name),
  ],
);
