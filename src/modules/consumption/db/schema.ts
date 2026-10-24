import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryCategoryEnum, inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { cycleInventoryPriceSnapshots, cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { cycleTaskGenerations } from "@/modules/production/db/schema";

export const consumptionOperationKindEnum = pgEnum("consumption_operation_kind", ["CONFIRM", "CORRECT", "SETTLE"]);
export const consumptionBasisEnum = pgEnum("consumption_basis", ["PLANNED", "OWNER_REPORTED"]);
export const stockEffectModeEnum = pgEnum("stock_effect_mode", ["DIRECT", "HISTORY_ONLY", "COUNT_SETTLED"]);

export const cycleConsumptionContexts = pgTable("cycle_consumption_contexts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  bakeCycleId: uuid("bake_cycle_id").notNull(),
  planningSnapshotId: uuid("planning_snapshot_id").notNull(),
  taskGenerationId: uuid("task_generation_id").notNull(),
  currentRevisionId: uuid("current_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table): PgTableExtraConfigValue[] => [
  unique("consumption_contexts_owned_id_unique").on(table.ownerId, table.id),
  unique("consumption_contexts_source_unique").on(table.ownerId, table.bakeCycleId, table.planningSnapshotId),
  unique("consumption_contexts_snapshot_id_unique").on(table.ownerId, table.planningSnapshotId, table.id),
  foreignKey({ name: "consumption_contexts_cycle_fk", columns: [table.ownerId, table.bakeCycleId], foreignColumns: [bakeCycles.ownerId, bakeCycles.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_contexts_snapshot_fk", columns: [table.ownerId, table.bakeCycleId, table.planningSnapshotId], foreignColumns: [cyclePlanningSnapshots.ownerId, cyclePlanningSnapshots.bakeCycleId, cyclePlanningSnapshots.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_contexts_generation_fk", columns: [table.ownerId, table.taskGenerationId], foreignColumns: [cycleTaskGenerations.ownerId, cycleTaskGenerations.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_contexts_current_fk", columns: [table.ownerId, table.id, table.currentRevisionId], foreignColumns: [consumptionRevisions.ownerId, consumptionRevisions.contextId, consumptionRevisions.id] }).onDelete("restrict"),
]).enableRLS();

export const cycleConsumptionItems = pgTable("cycle_consumption_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  contextId: uuid("context_id").notNull(),
  planningSnapshotId: uuid("planning_snapshot_id").notNull(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  inventoryItemName: varchar("inventory_item_name", { length: 160 }).notNull(),
  inventoryCategory: inventoryCategoryEnum("inventory_category").notNull(),
  baseUnit: varchar("base_unit", { length: 16 }).notNull(),
  priceSnapshotId: uuid("price_snapshot_id"),
  plannedQuantity: numeric("planned_quantity", { precision: 18, scale: 6 }).notNull(),
}, (table) => [
  unique("consumption_items_membership_unique").on(table.ownerId, table.contextId, table.inventoryItemId),
  foreignKey({ name: "consumption_items_context_fk", columns: [table.ownerId, table.planningSnapshotId, table.contextId], foreignColumns: [cycleConsumptionContexts.ownerId, cycleConsumptionContexts.planningSnapshotId, cycleConsumptionContexts.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_items_inventory_fk", columns: [table.ownerId, table.inventoryItemId], foreignColumns: [inventoryItems.ownerId, inventoryItems.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_items_price_fk", columns: [table.ownerId, table.planningSnapshotId, table.inventoryItemId, table.priceSnapshotId], foreignColumns: [cycleInventoryPriceSnapshots.ownerId, cycleInventoryPriceSnapshots.planningSnapshotId, cycleInventoryPriceSnapshots.inventoryItemId, cycleInventoryPriceSnapshots.id] }).onDelete("restrict"),
  index("consumption_items_owner_inventory_idx").on(table.ownerId, table.inventoryItemId),
  check("consumption_items_quantity_nonnegative", sql`${table.plannedQuantity} >= 0`),
]).enableRLS();

export const consumptionOperations = pgTable("consumption_operations", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  requestId: uuid("request_id").notNull(),
  kind: consumptionOperationKindEnum("kind").notNull(),
  // Text preserves the byte-exact canonical JSON manifest produced by the domain.
  manifest: text("manifest").notNull(),
  revisionIds: uuid("revision_ids").array().notNull(),
  countMovementIds: uuid("count_movement_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("consumption_operations_owned_id_unique").on(table.ownerId, table.id),
  unique("consumption_operations_request_unique").on(table.ownerId, table.requestId),
]).enableRLS();

export const consumptionRevisions = pgTable("consumption_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  contextId: uuid("context_id").notNull(),
  operationId: uuid("operation_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  previousRevisionId: uuid("previous_revision_id"),
  reason: text("reason"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table): PgTableExtraConfigValue[] => [
  unique("consumption_revisions_owned_id_unique").on(table.ownerId, table.id),
  unique("consumption_revisions_context_id_unique").on(table.ownerId, table.contextId, table.id),
  unique("consumption_revisions_number_unique").on(table.ownerId, table.contextId, table.revisionNumber),
  unique("consumption_revisions_operation_context_unique").on(table.ownerId, table.operationId, table.contextId),
  uniqueIndex("consumption_revisions_one_initial").on(table.ownerId, table.contextId).where(sql`${table.previousRevisionId} IS NULL`),
  uniqueIndex("consumption_revisions_one_successor").on(table.ownerId, table.contextId, table.previousRevisionId).where(sql`${table.previousRevisionId} IS NOT NULL`),
  foreignKey({ name: "consumption_revisions_context_fk", columns: [table.ownerId, table.contextId], foreignColumns: [cycleConsumptionContexts.ownerId, cycleConsumptionContexts.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_revisions_operation_fk", columns: [table.ownerId, table.operationId], foreignColumns: [consumptionOperations.ownerId, consumptionOperations.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_revisions_previous_fk", columns: [table.ownerId, table.contextId, table.previousRevisionId], foreignColumns: [table.ownerId, table.contextId, table.id] }).onDelete("restrict"),
  check("consumption_revisions_predecessor_shape", sql`(${table.revisionNumber} = 1 AND ${table.previousRevisionId} IS NULL) OR (${table.revisionNumber} > 1 AND ${table.previousRevisionId} IS NOT NULL)`),
]).enableRLS();

export const consumptionRevisionItems = pgTable("consumption_revision_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  contextId: uuid("context_id").notNull(),
  revisionId: uuid("revision_id").notNull(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  usedQuantity: numeric("used_quantity", { precision: 18, scale: 6 }).notNull(),
  basis: consumptionBasisEnum("basis").notNull(),
  reason: text("reason"),
  mode: stockEffectModeEnum("mode").notNull(),
  quantityDelta: numeric("quantity_delta", { precision: 18, scale: 6 }).notNull(),
  initialCountMovementId: uuid("initial_count_movement_id"),
  movementId: uuid("movement_id").notNull(),
  settlementCountMovementId: uuid("settlement_count_movement_id"),
}, (table) => [
  unique("consumption_revision_items_revision_item_unique").on(table.ownerId, table.revisionId, table.inventoryItemId),
  unique("consumption_revision_items_movement_unique").on(table.ownerId, table.movementId),
  foreignKey({ name: "consumption_revision_items_revision_fk", columns: [table.ownerId, table.contextId, table.revisionId], foreignColumns: [consumptionRevisions.ownerId, consumptionRevisions.contextId, consumptionRevisions.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_revision_items_membership_fk", columns: [table.ownerId, table.contextId, table.inventoryItemId], foreignColumns: [cycleConsumptionItems.ownerId, cycleConsumptionItems.contextId, cycleConsumptionItems.inventoryItemId] }).onDelete("restrict"),
  foreignKey({ name: "consumption_revision_items_movement_fk", columns: [table.ownerId, table.inventoryItemId, table.movementId], foreignColumns: [inventoryMovements.ownerId, inventoryMovements.inventoryItemId, inventoryMovements.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_revision_items_initial_count_fk", columns: [table.ownerId, table.inventoryItemId, table.initialCountMovementId], foreignColumns: [inventoryMovements.ownerId, inventoryMovements.inventoryItemId, inventoryMovements.id] }).onDelete("restrict"),
  foreignKey({ name: "consumption_revision_items_settlement_count_fk", columns: [table.ownerId, table.inventoryItemId, table.settlementCountMovementId], foreignColumns: [inventoryMovements.ownerId, inventoryMovements.inventoryItemId, inventoryMovements.id] }).onDelete("restrict"),
  check("consumption_revision_items_quantity_nonnegative", sql`${table.usedQuantity} >= 0`),
  check("consumption_revision_items_zero_reason", sql`${table.usedQuantity} <> 0 OR (${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)`),
  check("consumption_revision_items_effect_shape", sql`(${table.mode} = 'DIRECT' AND ${table.settlementCountMovementId} IS NULL) OR (${table.mode} = 'HISTORY_ONLY' AND ${table.quantityDelta} = 0 AND ${table.settlementCountMovementId} IS NULL) OR (${table.mode} = 'COUNT_SETTLED' AND ${table.quantityDelta} = 0 AND ${table.settlementCountMovementId} IS NOT NULL)`),
]).enableRLS();
