import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
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
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  cycleTaskOrigins,
  cycleTaskStatuses,
  productionTemplateScopes,
} from "@/modules/production/domain/types";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";

export const productionTemplateScopeEnum = pgEnum(
  "production_template_scope",
  productionTemplateScopes,
);
export const cycleTaskOriginEnum = pgEnum("cycle_task_origin", cycleTaskOrigins);
export const cycleTaskStatusEnum = pgEnum("cycle_task_status", cycleTaskStatuses);

export const productionTemplates = pgTable(
  "production_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    scope: productionTemplateScopeEnum("scope").notNull(),
    productId: uuid("product_id"),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("production_templates_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    foreignKey({
      name: "production_templates_owned_product_fk",
      columns: [table.ownerId, table.productId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    index("production_templates_owner_scope_active_idx").on(
      table.ownerId,
      table.scope,
      table.active,
    ),
    index("production_templates_owner_product_active_idx").on(
      table.ownerId,
      table.productId,
      table.active,
    ),
    uniqueIndex("production_templates_one_active_cycle_idx")
      .on(table.ownerId)
      .where(sql`${table.active} AND ${table.scope} = 'CYCLE'`),
    uniqueIndex("production_templates_one_active_product_idx")
      .on(table.ownerId, table.productId)
      .where(sql`${table.active} AND ${table.scope} = 'PRODUCT'`),
    check(
      "production_templates_scope_product_check",
      sql`(${table.scope} = 'CYCLE' AND ${table.productId} IS NULL) OR (${table.scope} = 'PRODUCT' AND ${table.productId} IS NOT NULL)`,
    ),
  ],
).enableRLS();

export const productionTemplateActivities = pgTable(
  "production_template_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    productionTemplateId: uuid("production_template_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    offsetDaysFromDelivery: integer("offset_days_from_delivery").notNull(),
    defaultTime: time("default_time").notNull(),
    estimatedDurationMinutes: integer("estimated_duration_minutes").notNull(),
    sequence: integer("sequence").notNull(),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("production_template_activities_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("production_template_activities_owner_template_id_unique").on(
      table.ownerId,
      table.productionTemplateId,
      table.id,
    ),
    foreignKey({
      name: "production_template_activities_owned_template_fk",
      columns: [table.ownerId, table.productionTemplateId],
      foreignColumns: [productionTemplates.ownerId, productionTemplates.id],
    }).onDelete("restrict"),
    index("production_template_activities_owner_template_sequence_idx").on(
      table.ownerId,
      table.productionTemplateId,
      table.sequence,
    ),
    uniqueIndex("production_template_activities_active_sequence_unique")
      .on(table.ownerId, table.productionTemplateId, table.sequence)
      .where(sql`${table.active}`),
    check(
      "production_template_activities_name_not_blank",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "production_template_activities_duration_positive",
      sql`${table.estimatedDurationMinutes} > 0`,
    ),
    check(
      "production_template_activities_sequence_positive",
      sql`${table.sequence} > 0`,
    ),
  ],
).enableRLS();

export const cycleTaskGenerations = pgTable(
  "cycle_task_generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    bakeCycleId: uuid("bake_cycle_id").notNull(),
    planningSnapshotId: uuid("planning_snapshot_id").notNull(),
    generation: integer("generation").notNull(),
    primaryDeliveryDate: date("primary_delivery_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_task_generations_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("cycle_task_generations_owner_snapshot_unique").on(
      table.ownerId,
      table.planningSnapshotId,
    ),
    unique("cycle_task_generations_owner_cycle_generation_unique").on(
      table.ownerId,
      table.bakeCycleId,
      table.generation,
    ),
    foreignKey({
      name: "cycle_task_generations_owned_cycle_fk",
      columns: [table.ownerId, table.bakeCycleId],
      foreignColumns: [bakeCycles.ownerId, bakeCycles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_task_generations_owned_snapshot_fk",
      columns: [table.ownerId, table.bakeCycleId, table.planningSnapshotId],
      foreignColumns: [
        cyclePlanningSnapshots.ownerId,
        cyclePlanningSnapshots.bakeCycleId,
        cyclePlanningSnapshots.id,
      ],
    }).onDelete("restrict"),
    check(
      "cycle_task_generations_generation_positive",
      sql`${table.generation} > 0`,
    ),
  ],
).enableRLS();

export const cycleTasks = pgTable(
  "cycle_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    cycleTaskGenerationId: uuid("cycle_task_generation_id").notNull(),
    origin: cycleTaskOriginEnum("origin").notNull(),
    sourceTemplateId: uuid("source_template_id"),
    sourceActivityId: uuid("source_activity_id"),
    sourceTemplateScope: productionTemplateScopeEnum("source_template_scope"),
    sourceProductId: uuid("source_product_id"),
    sourceTemplateName: varchar("source_template_name", { length: 160 }),
    sourceActivityName: varchar("source_activity_name", { length: 160 }),
    sourceProductName: varchar("source_product_name", { length: 160 }),
    creationRequestId: uuid("creation_request_id"),
    title: varchar("title", { length: 160 }).notNull(),
    productId: uuid("product_id"),
    productName: varchar("product_name", { length: 160 }),
    batchCount: numeric("batch_count", { precision: 18, scale: 6 }),
    scheduledAt: timestamp("scheduled_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    estimatedDurationMinutes: integer("estimated_duration_minutes").notNull(),
    notes: text("notes"),
    sequence: integer("sequence").notNull(),
    status: cycleTaskStatusEnum("status").notNull().default("PENDING"),
    skipReason: text("skip_reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("cycle_tasks_owner_id_id_unique").on(table.ownerId, table.id),
    unique("cycle_tasks_owner_creation_request_unique").on(
      table.ownerId,
      table.creationRequestId,
    ),
    foreignKey({
      name: "cycle_tasks_owned_generation_fk",
      columns: [table.ownerId, table.cycleTaskGenerationId],
      foreignColumns: [cycleTaskGenerations.ownerId, cycleTaskGenerations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_tasks_owned_source_activity_fk",
      columns: [
        table.ownerId,
        table.sourceTemplateId,
        table.sourceActivityId,
      ],
      foreignColumns: [
        productionTemplateActivities.ownerId,
        productionTemplateActivities.productionTemplateId,
        productionTemplateActivities.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_tasks_owned_source_product_fk",
      columns: [table.ownerId, table.sourceProductId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cycle_tasks_owned_product_fk",
      columns: [table.ownerId, table.productId],
      foreignColumns: [products.ownerId, products.id],
    }).onDelete("restrict"),
    index("cycle_tasks_owner_generation_scheduled_idx").on(
      table.ownerId,
      table.cycleTaskGenerationId,
      table.scheduledAt,
    ),
    check(
      "cycle_tasks_lineage_shape",
      sql`(${table.origin} = 'TEMPLATE' AND ${table.sourceTemplateId} IS NOT NULL AND ${table.sourceActivityId} IS NOT NULL AND ${table.sourceTemplateScope} IS NOT NULL AND ${table.sourceTemplateName} IS NOT NULL AND ${table.sourceActivityName} IS NOT NULL AND ${table.creationRequestId} IS NULL) OR (${table.origin} = 'MANUAL' AND ${table.sourceTemplateId} IS NULL AND ${table.sourceActivityId} IS NULL AND ${table.sourceTemplateScope} IS NULL AND ${table.sourceProductId} IS NULL AND ${table.sourceTemplateName} IS NULL AND ${table.sourceActivityName} IS NULL AND ${table.sourceProductName} IS NULL AND ${table.creationRequestId} IS NOT NULL)`,
    ),
    check(
      "cycle_tasks_source_scope_product_shape",
      sql`${table.origin} = 'MANUAL' OR (${table.sourceTemplateScope} = 'CYCLE' AND ${table.sourceProductId} IS NULL AND ${table.sourceProductName} IS NULL) OR (${table.sourceTemplateScope} = 'PRODUCT' AND ${table.sourceProductId} IS NOT NULL AND ${table.sourceProductName} IS NOT NULL)`,
    ),
    check(
      "cycle_tasks_creation_request_shape",
      sql`(${table.origin} = 'MANUAL' AND ${table.creationRequestId} IS NOT NULL) OR (${table.origin} = 'TEMPLATE' AND ${table.creationRequestId} IS NULL)`,
    ),
    check(
      "cycle_tasks_product_pairing",
      sql`(${table.productId} IS NULL AND ${table.productName} IS NULL) OR (${table.productId} IS NOT NULL AND ${table.productName} IS NOT NULL)`,
    ),
    check(
      "cycle_tasks_batch_count_positive",
      sql`${table.batchCount} IS NULL OR ${table.batchCount} > 0`,
    ),
    check(
      "cycle_tasks_duration_positive",
      sql`${table.estimatedDurationMinutes} > 0`,
    ),
    check("cycle_tasks_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "cycle_tasks_skip_reason_shape",
      sql`(${table.status} = 'SKIPPED' AND ${table.skipReason} IS NOT NULL AND length(btrim(${table.skipReason})) > 0) OR (${table.status} <> 'SKIPPED' AND ${table.skipReason} IS NULL)`,
    ),
    check(
      "cycle_tasks_deleted_at_shape",
      sql`${table.deletedAt} IS NULL OR (${table.origin} = 'MANUAL' AND ${table.status} = 'PENDING')`,
    ),
  ],
).enableRLS();
