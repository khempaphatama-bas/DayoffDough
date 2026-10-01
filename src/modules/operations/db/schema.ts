import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orderItems } from "@/modules/orders/db/schema";

export const orderItemPackingProgress = pgTable(
  "order_item_packing_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    packedQuantity: integer("packed_quantity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("order_item_packing_progress_owner_item_unique").on(
      table.ownerId,
      table.orderItemId,
    ),
    foreignKey({
      name: "order_item_packing_progress_owned_item_fk",
      columns: [table.ownerId, table.orderItemId],
      foreignColumns: [orderItems.ownerId, orderItems.id],
    }).onDelete("restrict"),
    index("order_item_packing_progress_owner_item_idx").on(
      table.ownerId,
      table.orderItemId,
    ),
    check(
      "order_item_packing_progress_non_negative",
      sql`${table.packedQuantity} >= 0`,
    ),
  ],
).enableRLS();
