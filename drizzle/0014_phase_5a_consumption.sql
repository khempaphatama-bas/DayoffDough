CREATE TYPE "public"."consumption_basis" AS ENUM('PLANNED', 'OWNER_REPORTED');--> statement-breakpoint
CREATE TYPE "public"."consumption_operation_kind" AS ENUM('CONFIRM', 'CORRECT', 'SETTLE');--> statement-breakpoint
CREATE TYPE "public"."consumption_policy" AS ENUM('LEGACY', 'CONSUMPTION_V1');--> statement-breakpoint
CREATE TYPE "public"."stock_effect_mode" AS ENUM('DIRECT', 'HISTORY_ONLY', 'COUNT_SETTLED');--> statement-breakpoint
CREATE TABLE "consumption_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "consumption_operation_kind" NOT NULL,
	"manifest" text NOT NULL,
	"revision_ids" uuid[] NOT NULL,
	"count_movement_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_operations_owned_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "consumption_operations_request_unique" UNIQUE("owner_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "consumption_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consumption_revision_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"used_quantity" numeric(18, 6) NOT NULL,
	"basis" "consumption_basis" NOT NULL,
	"reason" text,
	"mode" "stock_effect_mode" NOT NULL,
	"quantity_delta" numeric(18, 6) NOT NULL,
	"initial_count_movement_id" uuid,
	"movement_id" uuid NOT NULL,
	"settlement_count_movement_id" uuid,
	CONSTRAINT "consumption_revision_items_revision_item_unique" UNIQUE("owner_id","revision_id","inventory_item_id"),
	CONSTRAINT "consumption_revision_items_movement_unique" UNIQUE("owner_id","movement_id"),
	CONSTRAINT "consumption_revision_items_quantity_nonnegative" CHECK ("consumption_revision_items"."used_quantity" >= 0),
	CONSTRAINT "consumption_revision_items_zero_reason" CHECK ("consumption_revision_items"."used_quantity" <> 0 OR ("consumption_revision_items"."reason" IS NOT NULL AND length(btrim("consumption_revision_items"."reason")) > 0)),
	CONSTRAINT "consumption_revision_items_effect_shape" CHECK (("consumption_revision_items"."mode" = 'DIRECT' AND "consumption_revision_items"."settlement_count_movement_id" IS NULL) OR ("consumption_revision_items"."mode" = 'HISTORY_ONLY' AND "consumption_revision_items"."quantity_delta" = 0 AND "consumption_revision_items"."settlement_count_movement_id" IS NULL) OR ("consumption_revision_items"."mode" = 'COUNT_SETTLED' AND "consumption_revision_items"."quantity_delta" = 0 AND "consumption_revision_items"."settlement_count_movement_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "consumption_revision_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consumption_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"previous_revision_id" uuid,
	"reason" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_revisions_owned_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "consumption_revisions_context_id_unique" UNIQUE("owner_id","context_id","id"),
	CONSTRAINT "consumption_revisions_number_unique" UNIQUE("owner_id","context_id","revision_number"),
	CONSTRAINT "consumption_revisions_operation_context_unique" UNIQUE("owner_id","operation_id","context_id"),
	CONSTRAINT "consumption_revisions_predecessor_shape" CHECK (("consumption_revisions"."revision_number" = 1 AND "consumption_revisions"."previous_revision_id" IS NULL) OR ("consumption_revisions"."revision_number" > 1 AND "consumption_revisions"."previous_revision_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "consumption_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_consumption_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"task_generation_id" uuid NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_contexts_owned_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "consumption_contexts_source_unique" UNIQUE("owner_id","bake_cycle_id","planning_snapshot_id"),
	CONSTRAINT "consumption_contexts_snapshot_id_unique" UNIQUE("owner_id","planning_snapshot_id","id")
);
--> statement-breakpoint
ALTER TABLE "cycle_consumption_contexts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_consumption_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"inventory_item_name" varchar(160) NOT NULL,
	"inventory_category" "inventory_category" NOT NULL,
	"base_unit" varchar(16) NOT NULL,
	"price_snapshot_id" uuid,
	"planned_quantity" numeric(18, 6) NOT NULL,
	CONSTRAINT "consumption_items_membership_unique" UNIQUE("owner_id","context_id","inventory_item_id"),
	CONSTRAINT "consumption_items_quantity_nonnegative" CHECK ("cycle_consumption_items"."planned_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_consumption_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_ledger_states" (
	"owner_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"ledger_revision" bigint DEFAULT 0 NOT NULL,
	"latest_count_movement_id" uuid,
	CONSTRAINT "inventory_ledger_states_owner_id_inventory_item_id_pk" PRIMARY KEY("owner_id","inventory_item_id"),
	CONSTRAINT "ledger_states_revision_nonnegative" CHECK ("inventory_ledger_states"."ledger_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_ledger_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The migration runner executes this migration transactionally. Existing rows
-- receive LEGACY before the V1 default and immutable policy guard are enabled.
ALTER TABLE "bake_cycles" ADD COLUMN "consumption_policy" "consumption_policy";--> statement-breakpoint
UPDATE bake_cycles SET consumption_policy = 'LEGACY';--> statement-breakpoint
ALTER TABLE bake_cycles ALTER COLUMN consumption_policy SET NOT NULL;--> statement-breakpoint
ALTER TABLE bake_cycles ALTER COLUMN consumption_policy SET DEFAULT 'CONSUMPTION_V1';--> statement-breakpoint
ALTER TABLE "consumption_revision_items" ADD CONSTRAINT "consumption_revision_items_revision_fk" FOREIGN KEY ("owner_id","context_id","revision_id") REFERENCES "public"."consumption_revisions"("owner_id","context_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revision_items" ADD CONSTRAINT "consumption_revision_items_membership_fk" FOREIGN KEY ("owner_id","context_id","inventory_item_id") REFERENCES "public"."cycle_consumption_items"("owner_id","context_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revision_items" ADD CONSTRAINT "consumption_revision_items_movement_fk" FOREIGN KEY ("owner_id","inventory_item_id","movement_id") REFERENCES "public"."inventory_movements"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revision_items" ADD CONSTRAINT "consumption_revision_items_initial_count_fk" FOREIGN KEY ("owner_id","inventory_item_id","initial_count_movement_id") REFERENCES "public"."inventory_movements"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revision_items" ADD CONSTRAINT "consumption_revision_items_settlement_count_fk" FOREIGN KEY ("owner_id","inventory_item_id","settlement_count_movement_id") REFERENCES "public"."inventory_movements"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revisions" ADD CONSTRAINT "consumption_revisions_context_fk" FOREIGN KEY ("owner_id","context_id") REFERENCES "public"."cycle_consumption_contexts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revisions" ADD CONSTRAINT "consumption_revisions_operation_fk" FOREIGN KEY ("owner_id","operation_id") REFERENCES "public"."consumption_operations"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_revisions" ADD CONSTRAINT "consumption_revisions_previous_fk" FOREIGN KEY ("owner_id","context_id","previous_revision_id") REFERENCES "public"."consumption_revisions"("owner_id","context_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_contexts" ADD CONSTRAINT "consumption_contexts_cycle_fk" FOREIGN KEY ("owner_id","bake_cycle_id") REFERENCES "public"."bake_cycles"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_contexts" ADD CONSTRAINT "consumption_contexts_snapshot_fk" FOREIGN KEY ("owner_id","bake_cycle_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","bake_cycle_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_contexts" ADD CONSTRAINT "consumption_contexts_generation_fk" FOREIGN KEY ("owner_id","task_generation_id") REFERENCES "public"."cycle_task_generations"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_contexts" ADD CONSTRAINT "consumption_contexts_current_fk" FOREIGN KEY ("owner_id","id","current_revision_id") REFERENCES "public"."consumption_revisions"("owner_id","context_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_items" ADD CONSTRAINT "consumption_items_context_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","context_id") REFERENCES "public"."cycle_consumption_contexts"("owner_id","planning_snapshot_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_items" ADD CONSTRAINT "consumption_items_inventory_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consumption_items" ADD CONSTRAINT "consumption_items_price_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","inventory_item_id","price_snapshot_id") REFERENCES "public"."cycle_inventory_price_snapshots"("owner_id","planning_snapshot_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_states" ADD CONSTRAINT "ledger_states_owned_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_states" ADD CONSTRAINT "ledger_states_owned_count_fk" FOREIGN KEY ("owner_id","inventory_item_id","latest_count_movement_id") REFERENCES "public"."inventory_movements"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_revisions_one_initial" ON "consumption_revisions" USING btree ("owner_id","context_id") WHERE "consumption_revisions"."previous_revision_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_revisions_one_successor" ON "consumption_revisions" USING btree ("owner_id","context_id","previous_revision_id") WHERE "consumption_revisions"."previous_revision_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "consumption_items_owner_inventory_idx" ON "cycle_consumption_items" USING btree ("owner_id","inventory_item_id");--> statement-breakpoint

-- Cutover baseline deliberately does not infer historical COUNT application
-- order from UUIDs, occurred_at, or created_at. No movement/event is backfilled.
INSERT INTO inventory_ledger_states (owner_id, inventory_item_id, ledger_revision, latest_count_movement_id)
SELECT owner_id, id, 0, NULL FROM inventory_items;--> statement-breakpoint

CREATE FUNCTION enforce_consumption_policy() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.consumption_policy IS DISTINCT FROM 'CONSUMPTION_V1')
    OR (TG_OP = 'UPDATE' AND NEW.consumption_policy IS DISTINCT FROM OLD.consumption_policy) THEN
    RAISE EXCEPTION 'cycle consumption policy is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cycle_consumption_policy_guard BEFORE INSERT OR UPDATE ON bake_cycles
FOR EACH ROW EXECUTE FUNCTION enforce_consumption_policy();--> statement-breakpoint

CREATE FUNCTION reject_consumption_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consumption and inventory history is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_items_append_only BEFORE UPDATE OR DELETE ON cycle_consumption_items
FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_operations_append_only BEFORE UPDATE OR DELETE ON consumption_operations
FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_revisions_append_only BEFORE UPDATE OR DELETE ON consumption_revisions
FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_revision_items_append_only BEFORE UPDATE OR DELETE ON consumption_revision_items
FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint

-- This is the immutable-row / immediate-successor skeleton. Deferred exact
-- registration, revision completeness, lifecycle and operation guards are added
-- by the subsequent consumption tasks to this same unreleased migration.
CREATE FUNCTION enforce_consumption_context_identity() RETURNS trigger AS $$
DECLARE
  successor consumption_revisions%ROWTYPE;
  previous_number integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consumption context is immutable';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.current_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'consumption context starts without a revision';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'current_revision_id') IS DISTINCT FROM (to_jsonb(OLD) - 'current_revision_id') THEN
    RAISE EXCEPTION 'consumption context identity is immutable';
  END IF;
  IF NEW.current_revision_id IS NOT DISTINCT FROM OLD.current_revision_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO successor FROM consumption_revisions
    WHERE owner_id = OLD.owner_id AND context_id = OLD.id AND id = NEW.current_revision_id;
  IF NOT FOUND OR successor.previous_revision_id IS DISTINCT FROM OLD.current_revision_id THEN
    RAISE EXCEPTION 'consumption pointer requires an immediate owned successor';
  END IF;
  previous_number := 0;
  IF OLD.current_revision_id IS NOT NULL THEN
    SELECT revision_number INTO previous_number FROM consumption_revisions
      WHERE owner_id = OLD.owner_id AND context_id = OLD.id AND id = OLD.current_revision_id;
  END IF;
  IF successor.revision_number <> previous_number + 1 THEN
    RAISE EXCEPTION 'consumption pointer requires an immediate owned successor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER consumption_context_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON cycle_consumption_contexts
FOR EACH ROW EXECUTE FUNCTION enforce_consumption_context_identity();--> statement-breakpoint

CREATE FUNCTION initialize_inventory_ledger_state() RETURNS trigger AS $$
BEGIN
  INSERT INTO inventory_ledger_states (owner_id, inventory_item_id)
    VALUES (NEW.owner_id, NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER inventory_item_initialize_ledger AFTER INSERT ON inventory_items
FOR EACH ROW EXECUTE FUNCTION initialize_inventory_ledger_state();--> statement-breakpoint

CREATE FUNCTION lock_inventory_movement_item() RETURNS trigger AS $$
BEGIN
  -- Direct row-trigger SQL may already hold a child tuple; never invert a
  -- blocking wait against item-first commands. 55P03 means retry the transaction.
  PERFORM 1 FROM inventory_items WHERE owner_id = NEW.owner_id AND id = NEW.inventory_item_id
    FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory movement requires an owned item';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER inventory_movement_item_lock BEFORE INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION lock_inventory_movement_item();--> statement-breakpoint

CREATE FUNCTION apply_inventory_movement_token() RETURNS trigger AS $$
BEGIN
  -- AFTER INSERT is essential: ON CONFLICT DO NOTHING must not advance tokens.
  -- The BEFORE trigger has locked the item, before acquiring metadata locks.
  PERFORM 1 FROM inventory_ledger_states
    WHERE owner_id = NEW.owner_id AND inventory_item_id = NEW.inventory_item_id
    FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory ledger metadata is missing';
  END IF;
  UPDATE inventory_ledger_states SET
    ledger_revision = ledger_revision + 1,
    latest_count_movement_id = CASE WHEN NEW.type = 'COUNT' THEN NEW.id ELSE latest_count_movement_id END
    WHERE owner_id = NEW.owner_id AND inventory_item_id = NEW.inventory_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER inventory_movement_applied_token AFTER INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement_token();--> statement-breakpoint

CREATE FUNCTION protect_inventory_ledger_state() RETURNS trigger AS $$
BEGIN
  -- Only the installed item/movement AFTER INSERT triggers write this table.
  -- A trigger-returning function cannot be called as an ordinary SQL function;
  -- direct DML runs at depth 1 and cannot impersonate these derived effects.
  -- This is not a defense against privileged DDL/trigger replacement.
  IF TG_OP = 'DELETE' OR pg_trigger_depth() <> 2 THEN
    RAISE EXCEPTION 'inventory ledger metadata is derived and cannot be written directly';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.ledger_revision <> 0 OR NEW.latest_count_movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'new inventory ledger metadata requires the zero baseline';
    END IF;
  ELSE
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id
      OR NEW.ledger_revision <> OLD.ledger_revision + 1 THEN
      RAISE EXCEPTION 'inventory ledger revision must advance exactly once';
    END IF;
    IF NEW.latest_count_movement_id IS DISTINCT FROM OLD.latest_count_movement_id THEN
      PERFORM 1 FROM inventory_movements WHERE owner_id = NEW.owner_id
        AND inventory_item_id = NEW.inventory_item_id AND id = NEW.latest_count_movement_id AND type = 'COUNT';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory ledger fence requires an owned COUNT';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER inventory_ledger_state_derived_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_ledger_states
FOR EACH ROW EXECUTE FUNCTION protect_inventory_ledger_state();--> statement-breakpoint

CREATE TRIGGER inventory_movements_no_truncate BEFORE TRUNCATE ON inventory_movements
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER inventory_ledger_states_no_truncate BEFORE TRUNCATE ON inventory_ledger_states
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_contexts_no_truncate BEFORE TRUNCATE ON cycle_consumption_contexts
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_items_no_truncate BEFORE TRUNCATE ON cycle_consumption_items
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_operations_no_truncate BEFORE TRUNCATE ON consumption_operations
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_revisions_no_truncate BEFORE TRUNCATE ON consumption_revisions
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();--> statement-breakpoint
CREATE TRIGGER consumption_revision_items_no_truncate BEFORE TRUNCATE ON consumption_revision_items
FOR EACH STATEMENT EXECUTE FUNCTION reject_consumption_history_mutation();
--> statement-breakpoint

-- Snapshot planned_requirement already includes its buffer. Sum it exactly once;
-- no live recipe, purchase profile, price value or editable Task batch is read.
CREATE FUNCTION consumption_snapshot_requirements(p_owner uuid, p_snapshot uuid)
RETURNS TABLE (inventory_item_id uuid, inventory_item_name varchar, inventory_category inventory_category,
  base_unit varchar, price_snapshot_id uuid, planned_quantity numeric) AS $$
  SELECT r.inventory_item_id, r.inventory_item_name, p.inventory_category, r.base_unit,
    r.price_snapshot_id, sum(r.planned_requirement)
  FROM (
    SELECT owner_id, planning_snapshot_id, inventory_item_id, inventory_item_name, base_unit, price_snapshot_id, planned_requirement
      FROM cycle_material_requirements WHERE owner_id = p_owner AND planning_snapshot_id = p_snapshot
    UNION ALL
    SELECT owner_id, planning_snapshot_id, inventory_item_id, inventory_item_name, base_unit, price_snapshot_id, planned_requirement
      FROM cycle_packaging_requirements WHERE owner_id = p_owner AND planning_snapshot_id = p_snapshot
  ) r LEFT JOIN cycle_inventory_price_snapshots p ON p.owner_id = r.owner_id
    AND p.planning_snapshot_id = r.planning_snapshot_id AND p.inventory_item_id = r.inventory_item_id AND p.id = r.price_snapshot_id
  GROUP BY r.inventory_item_id, r.inventory_item_name, p.inventory_category, r.base_unit, r.price_snapshot_id;
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE FUNCTION lock_consumption_registration_source(p_owner uuid, p_cycle uuid, p_snapshot uuid, p_generation uuid)
RETURNS void AS $$
DECLARE
  c bake_cycles%ROWTYPE;
  s cycle_planning_snapshots%ROWTYPE;
  g cycle_task_generations%ROWTYPE;
  item_id uuid;
BEGIN
  -- A direct SQL child write may already hold a tuple. Never wait upstream.
  SELECT * INTO c FROM bake_cycles WHERE owner_id = p_owner AND id = p_cycle FOR UPDATE NOWAIT;
  SELECT * INTO s FROM cycle_planning_snapshots WHERE owner_id = p_owner AND bake_cycle_id = p_cycle AND id = p_snapshot FOR UPDATE NOWAIT;
  SELECT * INTO g FROM cycle_task_generations WHERE owner_id = p_owner AND id = p_generation FOR UPDATE NOWAIT;
  IF c.id IS NULL OR c.consumption_policy <> 'CONSUMPTION_V1'
    OR c.active_planning_snapshot_id IS DISTINCT FROM s.id OR s.id IS NULL OR s.status <> 'ACTIVE'
    OR g.id IS NULL OR g.bake_cycle_id <> c.id OR g.planning_snapshot_id <> s.id OR g.generation <> s.generation THEN
    RAISE EXCEPTION 'consumption requires the exact current generation';
  END IF;
  FOR item_id IN SELECT DISTINCT r.inventory_item_id FROM consumption_snapshot_requirements(p_owner, p_snapshot) r ORDER BY r.inventory_item_id LOOP
    PERFORM 1 FROM inventory_items WHERE owner_id = p_owner AND id = item_id FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'consumption requires an owned source item'; END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION enforce_consumption_registration_start() RETURNS trigger AS $$
DECLARE c bake_cycles%ROWTYPE;
BEGIN
  PERFORM lock_consumption_registration_source(NEW.owner_id, NEW.bake_cycle_id, NEW.planning_snapshot_id, NEW.task_generation_id);
  SELECT * INTO c FROM bake_cycles WHERE owner_id = NEW.owner_id AND id = NEW.bake_cycle_id;
  IF c.status <> 'LOCKED' THEN RAISE EXCEPTION 'consumption registration requires a locked cycle'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER consumption_registration_start BEFORE INSERT ON cycle_consumption_contexts
FOR EACH ROW EXECUTE FUNCTION enforce_consumption_registration_start();--> statement-breakpoint

CREATE FUNCTION validate_consumption_registration(p_owner uuid, p_context uuid) RETURNS void AS $$
DECLARE c cycle_consumption_contexts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM cycle_consumption_contexts WHERE owner_id = p_owner AND id = p_context;
  IF NOT FOUND THEN RAISE EXCEPTION 'consumption context is missing'; END IF;
  PERFORM lock_consumption_registration_source(c.owner_id, c.bake_cycle_id, c.planning_snapshot_id, c.task_generation_id);
  IF EXISTS (SELECT 1 FROM consumption_snapshot_requirements(c.owner_id, c.planning_snapshot_id) r
      GROUP BY r.inventory_item_id HAVING count(*) <> 1)
    OR EXISTS (
      WITH required AS (SELECT * FROM consumption_snapshot_requirements(c.owner_id, c.planning_snapshot_id)),
      copied AS (SELECT * FROM cycle_consumption_items WHERE owner_id = c.owner_id AND context_id = c.id)
      SELECT 1 FROM required r FULL JOIN copied i ON i.inventory_item_id = r.inventory_item_id
      WHERE r.inventory_item_id IS NULL OR i.inventory_item_id IS NULL OR r.inventory_category IS NULL
        OR i.inventory_item_name IS DISTINCT FROM r.inventory_item_name OR i.inventory_category IS DISTINCT FROM r.inventory_category
        OR i.base_unit IS DISTINCT FROM r.base_unit OR i.price_snapshot_id IS DISTINCT FROM r.price_snapshot_id
        OR i.planned_quantity IS DISTINCT FROM r.planned_quantity
    ) THEN RAISE EXCEPTION 'consumption registration requires the exact snapshot item set'; END IF;
  IF EXISTS (
    WITH required AS (SELECT * FROM consumption_snapshot_requirements(c.owner_id, c.planning_snapshot_id)),
    checked AS (SELECT * FROM cycle_inventory_counts WHERE owner_id = c.owner_id AND bake_cycle_id = c.bake_cycle_id AND planning_snapshot_id = c.planning_snapshot_id)
    SELECT 1 FROM required r FULL JOIN checked n ON n.inventory_item_id = r.inventory_item_id
    WHERE r.inventory_item_id IS NULL OR n.inventory_item_id IS NULL
      OR n.required_quantity IS DISTINCT FROM r.planned_quantity OR n.price_snapshot_id IS DISTINCT FROM r.price_snapshot_id
  ) THEN RAISE EXCEPTION 'consumption requires the exact initial stock check'; END IF;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION check_consumption_registration_complete() RETURNS trigger AS $$
DECLARE context_id uuid; c cycle_consumption_contexts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'cycle_consumption_contexts' THEN context_id := NEW.id;
  ELSE context_id := NEW.context_id; END IF;
  SELECT * INTO c FROM cycle_consumption_contexts WHERE owner_id = NEW.owner_id AND id = context_id;
  PERFORM validate_consumption_registration(c.owner_id, c.id);
  IF NOT EXISTS (SELECT 1 FROM bake_cycles WHERE owner_id = c.owner_id AND id = c.bake_cycle_id AND status IN ('IN_PRODUCTION', 'COMPLETED')) THEN
    RAISE EXCEPTION 'consumption registration must start production atomically';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consumption_context_complete AFTER INSERT ON cycle_consumption_contexts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_consumption_registration_complete();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consumption_source_complete AFTER INSERT ON cycle_consumption_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_consumption_registration_complete();--> statement-breakpoint

CREATE FUNCTION check_cycle_consumption_context() RETURNS trigger AS $$
DECLARE context_id uuid;
BEGIN
  IF NEW.consumption_policy = 'CONSUMPTION_V1' AND NEW.status IN ('IN_PRODUCTION', 'COMPLETED') THEN
    SELECT id INTO context_id FROM cycle_consumption_contexts WHERE owner_id = NEW.owner_id AND bake_cycle_id = NEW.id AND planning_snapshot_id = NEW.active_planning_snapshot_id;
    IF context_id IS NULL THEN RAISE EXCEPTION 'V1 production requires registered consumption'; END IF;
    PERFORM validate_consumption_registration(NEW.owner_id, context_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cycle_consumption_context_complete AFTER INSERT OR UPDATE ON bake_cycles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cycle_consumption_context();--> statement-breakpoint

-- Ordinary COUNT has no bypass. Settlement authority is implemented separately
-- when complete operation/revision/item links become available (Task 7).
CREATE OR REPLACE FUNCTION lock_inventory_movement_item() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM inventory_items WHERE owner_id = NEW.owner_id AND id = NEW.inventory_item_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory movement requires an owned item'; END IF;
  IF NEW.type = 'COUNT' AND EXISTS (
    SELECT 1 FROM cycle_consumption_contexts c
    WHERE c.owner_id = NEW.owner_id AND c.current_revision_id IS NULL AND (
      EXISTS (SELECT 1 FROM cycle_consumption_items i WHERE i.owner_id = c.owner_id AND i.context_id = c.id AND i.inventory_item_id = NEW.inventory_item_id)
      -- Also cover the creation transaction before its exact source children
      -- have been inserted. Persisted membership remains the audit authority.
      OR EXISTS (SELECT 1 FROM consumption_snapshot_requirements(c.owner_id, c.planning_snapshot_id) r WHERE r.inventory_item_id = NEW.inventory_item_id)
    )
  ) THEN RAISE EXCEPTION 'PENDING_USE: record pending consumption before counting stock'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
-- Only the two forward event links are deferred. All owner/item identity and
-- RESTRICT protections remain intact, and completeness is checked at commit.
ALTER TABLE consumption_revision_items ALTER CONSTRAINT consumption_revision_items_movement_fk DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE consumption_revision_items ALTER CONSTRAINT consumption_revision_items_settlement_count_fk DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- Match the compact, sorted-object JSON representation used by the domain.
-- ECMAScript String.trim whitespace, matching the strict input schemas rather
-- than PostgreSQL btrim's default ASCII-space-only behavior.
CREATE FUNCTION consumption_trim_reason(value text) RETURNS text AS $$
  SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$ LANGUAGE sql IMMUTABLE STRICT;--> statement-breakpoint

CREATE FUNCTION consumption_canonical_json(value jsonb) RETURNS text AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN '{' || coalesce((SELECT string_agg(to_jsonb(key)::text || ':' || consumption_canonical_json(val), ',' ORDER BY key COLLATE "C") FROM jsonb_each(value) AS e(key, val)), '') || '}'
    WHEN 'array' THEN '[' || coalesce((SELECT string_agg(consumption_canonical_json(val), ',' ORDER BY ordinal) FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val, ordinal)), '') || ']'
    ELSE value::text END;
$$ LANGUAGE sql IMMUTABLE STRICT;--> statement-breakpoint

CREATE FUNCTION lock_consumption_revision_source() RETURNS trigger AS $$
DECLARE c cycle_consumption_contexts%ROWTYPE; o consumption_operations%ROWTYPE; cycle_status bake_cycle_status; previous_number integer;
BEGIN
  SELECT * INTO c FROM cycle_consumption_contexts WHERE owner_id = NEW.owner_id AND id = NEW.context_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'consumption context is missing'; END IF;
  -- Direct child writers may hold tuples already: upstream locks never wait.
  PERFORM lock_consumption_registration_source(c.owner_id, c.bake_cycle_id, c.planning_snapshot_id, c.task_generation_id);
  SELECT * INTO c FROM cycle_consumption_contexts WHERE owner_id = NEW.owner_id AND id = NEW.context_id FOR UPDATE NOWAIT;
  SELECT * INTO o FROM consumption_operations WHERE owner_id = NEW.owner_id AND id = NEW.operation_id;
  -- Let the owned composite FK report missing/foreign operation identity.
  IF o.id IS NULL THEN RETURN NEW; END IF;
  IF o.kind NOT IN ('CONFIRM', 'CORRECT') THEN RAISE EXCEPTION 'consumption operation kind is not yet supported'; END IF;
  SELECT status INTO cycle_status FROM bake_cycles WHERE owner_id = c.owner_id AND id = c.bake_cycle_id;
  IF o.kind = 'CONFIRM' THEN
    IF cycle_status NOT IN ('IN_PRODUCTION', 'CANCELLED') OR c.current_revision_id IS NOT NULL
      OR NEW.revision_number <> 1 OR NEW.previous_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'initial consumption requires a pending production context';
    END IF;
  ELSE
    SELECT revision_number INTO previous_number FROM consumption_revisions
      WHERE owner_id = c.owner_id AND context_id = c.id AND id = c.current_revision_id FOR UPDATE NOWAIT;
    IF cycle_status NOT IN ('IN_PRODUCTION', 'CANCELLED', 'COMPLETED') OR c.current_revision_id IS NULL
      OR NEW.previous_revision_id IS DISTINCT FROM c.current_revision_id OR NEW.revision_number IS DISTINCT FROM previous_number + 1
      OR nullif(consumption_trim_reason(NEW.reason), '') IS NULL THEN
      RAISE EXCEPTION 'correction requires a current immediate predecessor and reason';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER consumption_revision_source_guard BEFORE INSERT ON consumption_revisions
FOR EACH ROW EXECUTE FUNCTION lock_consumption_revision_source();--> statement-breakpoint

CREATE FUNCTION check_initial_consumption_item() RETURNS trigger AS $$
DECLARE r consumption_revisions%ROWTYPE; o consumption_operations%ROWTYPE;
  ledger inventory_ledger_states%ROWTYPE; token jsonb; planned numeric; cycle_status bake_cycle_status;
  previous_item consumption_revision_items%ROWTYPE; initial_fence uuid; expected_mode stock_effect_mode; expected_delta numeric;
BEGIN
  SELECT * INTO r FROM consumption_revisions WHERE owner_id = NEW.owner_id AND context_id = NEW.context_id AND id = NEW.revision_id;
  SELECT * INTO o FROM consumption_operations WHERE owner_id = NEW.owner_id AND id = r.operation_id;
  IF o.id IS NULL THEN RETURN NEW; END IF;
  IF o.kind NOT IN ('CONFIRM', 'CORRECT') THEN RAISE EXCEPTION 'consumption operation kind is not yet supported'; END IF;
  PERFORM 1 FROM inventory_items WHERE owner_id = NEW.owner_id AND id = NEW.inventory_item_id FOR UPDATE NOWAIT;
  SELECT * INTO ledger FROM inventory_ledger_states WHERE owner_id = NEW.owner_id AND inventory_item_id = NEW.inventory_item_id FOR UPDATE NOWAIT;
  SELECT val INTO token FROM jsonb_array_elements(o.manifest::jsonb->'expectedLedger') AS e(val)
    WHERE val->>'inventoryItemId' = NEW.inventory_item_id::text;
  IF token IS NULL OR token->>'ledgerRevision' IS DISTINCT FROM ledger.ledger_revision::text
    OR token->>'countMovementId' IS DISTINCT FROM ledger.latest_count_movement_id::text THEN
    RAISE EXCEPTION 'consumption requires current applied ledger tokens';
  END IF;
  IF o.kind = 'CONFIRM' THEN
    initial_fence := ledger.latest_count_movement_id;
    expected_mode := 'DIRECT'; expected_delta := -NEW.used_quantity;
  ELSE
    SELECT * INTO previous_item FROM consumption_revision_items
      WHERE owner_id = NEW.owner_id AND context_id = NEW.context_id AND revision_id = r.previous_revision_id AND inventory_item_id = NEW.inventory_item_id;
    SELECT i.initial_count_movement_id INTO initial_fence FROM consumption_revision_items i JOIN consumption_revisions first_use
      ON first_use.owner_id = i.owner_id AND first_use.id = i.revision_id AND first_use.context_id = i.context_id
      WHERE i.owner_id = NEW.owner_id AND i.context_id = NEW.context_id AND first_use.revision_number = 1 AND i.inventory_item_id = NEW.inventory_item_id;
    IF previous_item.id IS NULL OR previous_item.initial_count_movement_id IS DISTINCT FROM initial_fence THEN
      RAISE EXCEPTION 'correction requires immutable first-use lineage';
    END IF;
    IF initial_fence IS DISTINCT FROM ledger.latest_count_movement_id THEN
      expected_mode := 'HISTORY_ONLY'; expected_delta := 0;
    ELSE
      expected_mode := 'DIRECT'; expected_delta := previous_item.used_quantity - NEW.used_quantity;
    END IF;
  END IF;
  IF NEW.initial_count_movement_id IS DISTINCT FROM initial_fence THEN RAISE EXCEPTION 'consumption requires immutable initial fence'; END IF;
  SELECT planned_quantity INTO planned FROM cycle_consumption_items WHERE owner_id = NEW.owner_id AND context_id = NEW.context_id AND inventory_item_id = NEW.inventory_item_id;
  SELECT b.status INTO cycle_status FROM cycle_consumption_contexts c JOIN bake_cycles b ON b.owner_id = c.owner_id AND b.id = c.bake_cycle_id
    WHERE c.owner_id = NEW.owner_id AND c.id = NEW.context_id;
  IF (cycle_status = 'CANCELLED' AND NEW.basis <> 'OWNER_REPORTED')
    OR (NEW.used_quantity IS DISTINCT FROM planned AND (NEW.basis <> 'OWNER_REPORTED' OR nullif(btrim(NEW.reason), '') IS NULL))
    OR NEW.mode <> expected_mode OR NEW.quantity_delta <> expected_delta OR NEW.settlement_count_movement_id IS NOT NULL THEN
    IF o.kind = 'CONFIRM' THEN RAISE EXCEPTION 'initial consumption requires exact usage provenance and direct delta'; END IF;
    RAISE EXCEPTION 'correction requires exact usage provenance and fenced delta';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER consumption_initial_item_guard BEFORE INSERT ON consumption_revision_items
FOR EACH ROW EXECUTE FUNCTION check_initial_consumption_item();--> statement-breakpoint

-- This event guard checks the live balance at application time, not a final SUM
-- that a later PURCHASE/COUNT in the same transaction could use to mask shortage.
CREATE FUNCTION check_consumption_movement() RETURNS trigger AS $$
DECLARE i consumption_revision_items%ROWTYPE; r consumption_revisions%ROWTYPE; o consumption_operations%ROWTYPE; balance numeric;
  ledger inventory_ledger_states%ROWTYPE; token jsonb;
BEGIN
  IF NEW.type <> 'CONSUMPTION' AND NEW.reference_type IS DISTINCT FROM 'CONSUMPTION_REVISION' THEN RETURN NEW; END IF;
  PERFORM 1 FROM inventory_items WHERE owner_id = NEW.owner_id AND id = NEW.inventory_item_id FOR UPDATE NOWAIT;
  SELECT * INTO i FROM consumption_revision_items WHERE owner_id = NEW.owner_id AND inventory_item_id = NEW.inventory_item_id AND movement_id = NEW.id;
  SELECT * INTO r FROM consumption_revisions WHERE owner_id = i.owner_id AND id = i.revision_id;
  SELECT * INTO o FROM consumption_operations WHERE owner_id = r.owner_id AND id = r.operation_id;
  IF i.id IS NULL OR r.id IS NULL OR o.id IS NULL OR o.kind NOT IN ('CONFIRM', 'CORRECT')
    OR NEW.type IS DISTINCT FROM (CASE WHEN o.kind = 'CONFIRM' THEN 'CONSUMPTION' ELSE 'CORRECTION' END)::inventory_movement_type OR NEW.reference_type IS DISTINCT FROM 'CONSUMPTION_REVISION'
    OR NEW.reference_id IS DISTINCT FROM i.revision_id OR NEW.quantity_delta_in_base_unit <> i.quantity_delta
    OR NEW.counted_quantity_in_base_unit IS NOT NULL OR NEW.occurred_at IS DISTINCT FROM r.confirmed_at
    OR NEW.notes IS DISTINCT FROM i.reason THEN RAISE EXCEPTION 'consumption movement requires exact owned revision lineage'; END IF;
  SELECT * INTO ledger FROM inventory_ledger_states WHERE owner_id = NEW.owner_id AND inventory_item_id = NEW.inventory_item_id FOR UPDATE NOWAIT;
  SELECT val INTO token FROM jsonb_array_elements(o.manifest::jsonb->'expectedLedger') AS e(val)
    WHERE val->>'inventoryItemId' = NEW.inventory_item_id::text;
  -- Preparing rows does not apply stock. Recheck at the event boundary so a
  -- raw interleaved PURCHASE/COUNT cannot make the recorded initial fence stale.
  IF token IS NULL OR token->>'ledgerRevision' IS DISTINCT FROM ledger.ledger_revision::text
    OR token->>'countMovementId' IS DISTINCT FROM ledger.latest_count_movement_id::text THEN
    RAISE EXCEPTION 'consumption requires current applied ledger tokens';
  END IF;
  SELECT coalesce(sum(quantity_delta_in_base_unit), 0) INTO balance FROM inventory_movements WHERE owner_id = NEW.owner_id AND inventory_item_id = NEW.inventory_item_id;
  IF balance + NEW.quantity_delta_in_base_unit < 0 THEN RAISE EXCEPTION 'consumption cannot make stock negative'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER consumption_movement_guard BEFORE INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION check_consumption_movement();--> statement-breakpoint

CREATE FUNCTION validate_consumption_operation(p_owner uuid, p_operation uuid) RETURNS void AS $$
DECLARE o consumption_operations%ROWTYPE; r consumption_revisions%ROWTYPE; c cycle_consumption_contexts%ROWTYPE;
  manifest jsonb; expected jsonb; items jsonb; tokens jsonb; actual_ids uuid[];
BEGIN
  SELECT * INTO o FROM consumption_operations WHERE owner_id = p_owner AND id = p_operation;
  IF o.id IS NULL THEN RAISE EXCEPTION 'consumption operation is missing'; END IF;
  IF o.kind NOT IN ('CONFIRM', 'CORRECT') THEN RAISE EXCEPTION 'consumption operation kind is not yet supported'; END IF;
  manifest := o.manifest::jsonb;
  SELECT array_agg(id ORDER BY context_id) INTO actual_ids FROM consumption_revisions WHERE owner_id = o.owner_id AND operation_id = o.id;
  IF cardinality(o.revision_ids) <> 1 OR o.revision_ids IS DISTINCT FROM actual_ids OR cardinality(o.count_movement_ids) <> 0 THEN
    RAISE EXCEPTION 'consumption receipt requires the complete exact result set';
  END IF;
  SELECT * INTO r FROM consumption_revisions WHERE owner_id = o.owner_id AND id = o.revision_ids[1];
  SELECT * INTO c FROM cycle_consumption_contexts WHERE owner_id = r.owner_id AND id = r.context_id;
  IF (o.kind = 'CONFIRM' AND (r.revision_number <> 1 OR r.previous_revision_id IS NOT NULL))
    OR (o.kind = 'CORRECT' AND (r.revision_number <= 1 OR r.previous_revision_id IS NULL OR nullif(consumption_trim_reason(r.reason), '') IS NULL))
    OR c.current_revision_id IS DISTINCT FROM r.id
    OR r.confirmed_at IS DISTINCT FROM o.created_at THEN RAISE EXCEPTION 'consumption requires a complete current initial revision'; END IF;
  IF EXISTS (
    WITH source AS (SELECT inventory_item_id FROM cycle_consumption_items WHERE owner_id = r.owner_id AND context_id = r.context_id),
    used AS (SELECT inventory_item_id FROM consumption_revision_items WHERE owner_id = r.owner_id AND revision_id = r.id)
    SELECT 1 FROM source FULL JOIN used USING (inventory_item_id) WHERE source.inventory_item_id IS NULL OR used.inventory_item_id IS NULL
  ) THEN RAISE EXCEPTION 'consumption requires the complete exact source item set'; END IF;
  IF EXISTS (SELECT 1 FROM consumption_revision_items i LEFT JOIN inventory_movements m
      ON m.owner_id = i.owner_id AND m.inventory_item_id = i.inventory_item_id AND m.id = i.movement_id
      WHERE i.owner_id = r.owner_id AND i.revision_id = r.id AND (m.id IS NULL OR m.type IS DISTINCT FROM (CASE WHEN o.kind = 'CONFIRM' THEN 'CONSUMPTION' ELSE 'CORRECTION' END)::inventory_movement_type
        OR m.reference_type IS DISTINCT FROM 'CONSUMPTION_REVISION' OR m.reference_id IS DISTINCT FROM r.id
        OR m.quantity_delta_in_base_unit <> i.quantity_delta OR m.occurred_at IS DISTINCT FROM r.confirmed_at
        OR m.notes IS DISTINCT FROM i.reason OR m.counted_quantity_in_base_unit IS NOT NULL)) THEN
    RAISE EXCEPTION 'consumption requires every exact owned audit movement';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('inventoryItemId', inventory_item_id::text,
    'usedQuantity', trim_scale(used_quantity)::text, 'basis', basis::text, 'reason', reason) ORDER BY inventory_item_id), '[]'::jsonb)
    INTO items FROM consumption_revision_items WHERE owner_id = r.owner_id AND revision_id = r.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('inventoryItemId', i.inventory_item_id::text,
    'ledgerRevision', t.val->>'ledgerRevision', 'countMovementId', CASE WHEN o.kind = 'CONFIRM' THEN to_jsonb(i.initial_count_movement_id::text) ELSE t.val->'countMovementId' END) ORDER BY i.inventory_item_id), '[]'::jsonb)
    INTO tokens FROM consumption_revision_items i LEFT JOIN LATERAL (
      SELECT val FROM jsonb_array_elements(manifest->'expectedLedger') AS e(val) WHERE val->>'inventoryItemId' = i.inventory_item_id::text
    ) t ON true WHERE i.owner_id = r.owner_id AND i.revision_id = r.id;
  expected := jsonb_build_object('kind', o.kind::text, 'requestId', o.request_id::text,
    'cycleId', c.bake_cycle_id::text, 'planningSnapshotId', c.planning_snapshot_id::text, 'contextId', c.id::text,
    'items', items, 'expectedLedger', tokens, 'reason', r.reason);
  IF o.kind = 'CONFIRM' THEN
    expected := expected || jsonb_build_object('confirmTakenOutOfUse', true, 'confirmEmpty', manifest->'confirmEmpty');
  ELSE
    expected := expected || jsonb_build_object('expectedRevisionId', r.previous_revision_id::text);
  END IF;
  IF (o.kind = 'CONFIRM' AND (jsonb_typeof(manifest->'confirmEmpty') IS DISTINCT FROM 'boolean'
      OR (items = '[]'::jsonb AND (manifest->'confirmEmpty' <> 'true'::jsonb OR nullif(btrim(r.reason), '') IS NULL))))
    OR jsonb_array_length(manifest->'expectedLedger') IS DISTINCT FROM jsonb_array_length(items)
    OR (r.reason IS NOT NULL AND r.reason <> consumption_trim_reason(r.reason))
    OR EXISTS (SELECT 1 FROM consumption_revision_items WHERE owner_id = r.owner_id AND revision_id = r.id AND reason IS NOT NULL AND reason <> consumption_trim_reason(reason))
    OR o.manifest IS DISTINCT FROM consumption_canonical_json(expected) THEN
    RAISE EXCEPTION 'consumption requires the canonical complete confirmed payload';
  END IF;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION check_consumption_operation_complete() RETURNS trigger AS $$
DECLARE operation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'consumption_operations' THEN operation_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'consumption_revisions' THEN operation_id := NEW.operation_id;
  ELSIF TG_TABLE_NAME = 'consumption_revision_items' THEN
    SELECT r.operation_id INTO operation_id FROM consumption_revisions r WHERE r.owner_id = NEW.owner_id AND r.id = NEW.revision_id;
  ELSE
    IF NEW.current_revision_id IS NOT DISTINCT FROM OLD.current_revision_id THEN RETURN NULL; END IF;
    SELECT r.operation_id INTO operation_id FROM consumption_revisions r WHERE r.owner_id = NEW.owner_id AND r.id = NEW.current_revision_id;
  END IF;
  PERFORM validate_consumption_operation(NEW.owner_id, operation_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consumption_operation_complete AFTER INSERT ON consumption_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_consumption_operation_complete();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consumption_revision_complete AFTER INSERT ON consumption_revisions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_consumption_operation_complete();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consumption_revision_items_complete AFTER INSERT ON consumption_revision_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_consumption_operation_complete();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER consumption_pointer_complete AFTER UPDATE ON cycle_consumption_contexts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_consumption_operation_complete();
