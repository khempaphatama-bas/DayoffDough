import { sql } from "drizzle-orm";
import {
  check,
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const shopSettings = pgTable(
  "shop_settings",
  {
    ownerId: uuid("owner_id").primaryKey(),
    laborRateSatangPerHour: integer("labor_rate_satang_per_hour").notNull(),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("Asia/Bangkok"),
    currency: varchar("currency", { length: 3 }).notNull().default("THB"),
    defaultWasteAllowancePercent: numeric("default_waste_allowance_percent", {
      precision: 7,
      scale: 4,
    })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "shop_settings_labor_rate_non_negative",
      sql`${table.laborRateSatangPerHour} >= 0`,
    ),
    check(
      "shop_settings_waste_percent_range",
      sql`${table.defaultWasteAllowancePercent} >= 0 AND ${table.defaultWasteAllowancePercent} <= 100`,
    ),
  ],
);
