import {
  date,
  index,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { bakeCycleStatus } from "@/modules/cycles/domain/cycle-lifecycle";

export { bakeCycleStatus } from "@/modules/cycles/domain/cycle-lifecycle";

export const bakeCycleStatusEnum = pgEnum(
  "bake_cycle_status",
  bakeCycleStatus,
);
export const consumptionPolicyEnum = pgEnum("consumption_policy", ["LEGACY", "CONSUMPTION_V1"]);

export const bakeCycles = pgTable(
  "bake_cycles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    cycleNumber: serial("cycle_number").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: bakeCycleStatusEnum("status").notNull().default("OPEN"),
    consumptionPolicy: consumptionPolicyEnum("consumption_policy").notNull().default("CONSUMPTION_V1"),
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
    notes: varchar("notes", { length: 2000 }),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    activePlanningSnapshotId: uuid("active_planning_snapshot_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("bake_cycles_owner_id_id_unique").on(table.ownerId, table.id),
    unique("bake_cycles_cycle_number_unique").on(table.cycleNumber),
    index("bake_cycles_owner_status_delivery_idx").on(
      table.ownerId,
      table.status,
      table.primaryDeliveryDate,
    ),
    index("bake_cycles_owner_status_production_idx").on(
      table.ownerId,
      table.status,
      table.targetProductionDate,
    ),
  ],
);
