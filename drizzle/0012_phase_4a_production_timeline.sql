CREATE TYPE "public"."cycle_task_origin" AS ENUM('TEMPLATE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."cycle_task_status" AS ENUM('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."production_template_scope" AS ENUM('CYCLE', 'PRODUCT');--> statement-breakpoint
CREATE TABLE "cycle_task_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"primary_delivery_date" date NOT NULL,
	"timezone" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_task_generations_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_task_generations_owner_snapshot_unique" UNIQUE("owner_id","planning_snapshot_id"),
	CONSTRAINT "cycle_task_generations_owner_cycle_generation_unique" UNIQUE("owner_id","bake_cycle_id","generation"),
	CONSTRAINT "cycle_task_generations_generation_positive" CHECK ("cycle_task_generations"."generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_task_generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"cycle_task_generation_id" uuid NOT NULL,
	"origin" "cycle_task_origin" NOT NULL,
	"source_template_id" uuid,
	"source_activity_id" uuid,
	"source_template_scope" "production_template_scope",
	"source_product_id" uuid,
	"source_template_name" varchar(160),
	"source_activity_name" varchar(160),
	"source_product_name" varchar(160),
	"creation_request_id" uuid,
	"title" varchar(160) NOT NULL,
	"product_id" uuid,
	"product_name" varchar(160),
	"batch_count" numeric(18, 6),
	"scheduled_at" timestamp with time zone NOT NULL,
	"estimated_duration_minutes" integer NOT NULL,
	"notes" text,
	"sequence" integer NOT NULL,
	"status" "cycle_task_status" DEFAULT 'PENDING' NOT NULL,
	"skip_reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_tasks_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_tasks_owner_creation_request_unique" UNIQUE("owner_id","creation_request_id"),
	CONSTRAINT "cycle_tasks_lineage_shape" CHECK (("cycle_tasks"."origin" = 'TEMPLATE' AND "cycle_tasks"."source_template_id" IS NOT NULL AND "cycle_tasks"."source_activity_id" IS NOT NULL AND "cycle_tasks"."source_template_scope" IS NOT NULL AND "cycle_tasks"."source_template_name" IS NOT NULL AND "cycle_tasks"."source_activity_name" IS NOT NULL AND "cycle_tasks"."creation_request_id" IS NULL) OR ("cycle_tasks"."origin" = 'MANUAL' AND "cycle_tasks"."source_template_id" IS NULL AND "cycle_tasks"."source_activity_id" IS NULL AND "cycle_tasks"."source_template_scope" IS NULL AND "cycle_tasks"."source_product_id" IS NULL AND "cycle_tasks"."source_template_name" IS NULL AND "cycle_tasks"."source_activity_name" IS NULL AND "cycle_tasks"."source_product_name" IS NULL AND "cycle_tasks"."creation_request_id" IS NOT NULL)),
	CONSTRAINT "cycle_tasks_source_scope_product_shape" CHECK ("cycle_tasks"."origin" = 'MANUAL' OR ("cycle_tasks"."source_template_scope" = 'CYCLE' AND "cycle_tasks"."source_product_id" IS NULL AND "cycle_tasks"."source_product_name" IS NULL) OR ("cycle_tasks"."source_template_scope" = 'PRODUCT' AND "cycle_tasks"."source_product_id" IS NOT NULL AND "cycle_tasks"."source_product_name" IS NOT NULL)),
	CONSTRAINT "cycle_tasks_creation_request_shape" CHECK (("cycle_tasks"."origin" = 'MANUAL' AND "cycle_tasks"."creation_request_id" IS NOT NULL) OR ("cycle_tasks"."origin" = 'TEMPLATE' AND "cycle_tasks"."creation_request_id" IS NULL)),
	CONSTRAINT "cycle_tasks_product_pairing" CHECK (("cycle_tasks"."product_id" IS NULL AND "cycle_tasks"."product_name" IS NULL) OR ("cycle_tasks"."product_id" IS NOT NULL AND "cycle_tasks"."product_name" IS NOT NULL)),
	CONSTRAINT "cycle_tasks_batch_count_positive" CHECK ("cycle_tasks"."batch_count" IS NULL OR "cycle_tasks"."batch_count" > 0),
	CONSTRAINT "cycle_tasks_duration_positive" CHECK ("cycle_tasks"."estimated_duration_minutes" > 0),
	CONSTRAINT "cycle_tasks_sequence_positive" CHECK ("cycle_tasks"."sequence" > 0),
	CONSTRAINT "cycle_tasks_skip_reason_shape" CHECK (("cycle_tasks"."status" = 'SKIPPED' AND "cycle_tasks"."skip_reason" IS NOT NULL AND length(btrim("cycle_tasks"."skip_reason")) > 0) OR ("cycle_tasks"."status" <> 'SKIPPED' AND "cycle_tasks"."skip_reason" IS NULL)),
	CONSTRAINT "cycle_tasks_deleted_at_shape" CHECK ("cycle_tasks"."deleted_at" IS NULL OR ("cycle_tasks"."origin" = 'MANUAL' AND "cycle_tasks"."status" = 'PENDING'))
);
--> statement-breakpoint
ALTER TABLE "cycle_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "production_template_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"production_template_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"offset_days_from_delivery" integer NOT NULL,
	"default_time" time NOT NULL,
	"estimated_duration_minutes" integer NOT NULL,
	"sequence" integer NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_template_activities_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "production_template_activities_owner_template_id_unique" UNIQUE("owner_id","production_template_id","id"),
	CONSTRAINT "production_template_activities_name_not_blank" CHECK (length(btrim("production_template_activities"."name")) > 0),
	CONSTRAINT "production_template_activities_duration_positive" CHECK ("production_template_activities"."estimated_duration_minutes" > 0),
	CONSTRAINT "production_template_activities_sequence_positive" CHECK ("production_template_activities"."sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_template_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "production_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"scope" "production_template_scope" NOT NULL,
	"product_id" uuid,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_templates_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "production_templates_scope_product_check" CHECK (("production_templates"."scope" = 'CYCLE' AND "production_templates"."product_id" IS NULL) OR ("production_templates"."scope" = 'PRODUCT' AND "production_templates"."product_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "production_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_task_generations" ADD CONSTRAINT "cycle_task_generations_owned_cycle_fk" FOREIGN KEY ("owner_id","bake_cycle_id") REFERENCES "public"."bake_cycles"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_task_generations" ADD CONSTRAINT "cycle_task_generations_owned_snapshot_fk" FOREIGN KEY ("owner_id","bake_cycle_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","bake_cycle_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_tasks" ADD CONSTRAINT "cycle_tasks_owned_generation_fk" FOREIGN KEY ("owner_id","cycle_task_generation_id") REFERENCES "public"."cycle_task_generations"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_tasks" ADD CONSTRAINT "cycle_tasks_owned_source_activity_fk" FOREIGN KEY ("owner_id","source_template_id","source_activity_id") REFERENCES "public"."production_template_activities"("owner_id","production_template_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_tasks" ADD CONSTRAINT "cycle_tasks_owned_source_product_fk" FOREIGN KEY ("owner_id","source_product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_tasks" ADD CONSTRAINT "cycle_tasks_owned_product_fk" FOREIGN KEY ("owner_id","product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_template_activities" ADD CONSTRAINT "production_template_activities_owned_template_fk" FOREIGN KEY ("owner_id","production_template_id") REFERENCES "public"."production_templates"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_templates" ADD CONSTRAINT "production_templates_owned_product_fk" FOREIGN KEY ("owner_id","product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_tasks_owner_generation_scheduled_idx" ON "cycle_tasks" USING btree ("owner_id","cycle_task_generation_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "production_template_activities_owner_template_sequence_idx" ON "production_template_activities" USING btree ("owner_id","production_template_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "production_template_activities_active_sequence_unique" ON "production_template_activities" USING btree ("owner_id","production_template_id","sequence") WHERE "production_template_activities"."active";--> statement-breakpoint
CREATE INDEX "production_templates_owner_scope_active_idx" ON "production_templates" USING btree ("owner_id","scope","active");--> statement-breakpoint
CREATE INDEX "production_templates_owner_product_active_idx" ON "production_templates" USING btree ("owner_id","product_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "production_templates_one_active_cycle_idx" ON "production_templates" USING btree ("owner_id") WHERE "production_templates"."active" AND "production_templates"."scope" = 'CYCLE';--> statement-breakpoint
CREATE UNIQUE INDEX "production_templates_one_active_product_idx" ON "production_templates" USING btree ("owner_id","product_id") WHERE "production_templates"."active" AND "production_templates"."scope" = 'PRODUCT';--> statement-breakpoint
CREATE FUNCTION enforce_cycle_task_generation_snapshot() RETURNS trigger AS $$
DECLARE
  snapshot_row cycle_planning_snapshots%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.bake_cycle_id IS DISTINCT FROM OLD.bake_cycle_id
      OR NEW.planning_snapshot_id IS DISTINCT FROM OLD.planning_snapshot_id
      OR NEW.generation IS DISTINCT FROM OLD.generation
      OR NEW.primary_delivery_date IS DISTINCT FROM OLD.primary_delivery_date
      OR NEW.timezone IS DISTINCT FROM OLD.timezone
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'task generation is immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO snapshot_row
  FROM cycle_planning_snapshots
  WHERE owner_id = NEW.owner_id
    AND bake_cycle_id = NEW.bake_cycle_id
    AND id = NEW.planning_snapshot_id;

  IF NOT FOUND
    OR NEW.generation <> snapshot_row.generation
    OR NEW.primary_delivery_date <> snapshot_row.primary_delivery_date
    OR NEW.timezone <> snapshot_row.timezone THEN
    RAISE EXCEPTION 'task generation snapshot mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cycle_task_generation_snapshot_guard
BEFORE INSERT OR UPDATE ON cycle_task_generations
FOR EACH ROW EXECUTE FUNCTION enforce_cycle_task_generation_snapshot();--> statement-breakpoint
CREATE FUNCTION enforce_cycle_task_lifecycle() RETURNS trigger AS $$
DECLARE
  generation_row cycle_task_generations%ROWTYPE;
  snapshot_row cycle_planning_snapshots%ROWTYPE;
  cycle_row bake_cycles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cycle task hard delete is not allowed';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.cycle_task_generation_id IS DISTINCT FROM OLD.cycle_task_generation_id
    OR NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.source_template_id IS DISTINCT FROM OLD.source_template_id
    OR NEW.source_activity_id IS DISTINCT FROM OLD.source_activity_id
    OR NEW.source_template_scope IS DISTINCT FROM OLD.source_template_scope
    OR NEW.source_product_id IS DISTINCT FROM OLD.source_product_id
    OR NEW.source_template_name IS DISTINCT FROM OLD.source_template_name
    OR NEW.source_activity_name IS DISTINCT FROM OLD.source_activity_name
    OR NEW.source_product_name IS DISTINCT FROM OLD.source_product_name
    OR NEW.creation_request_id IS DISTINCT FROM OLD.creation_request_id
  ) THEN
    RAISE EXCEPTION 'cycle task lineage is immutable';
  END IF;

  SELECT * INTO generation_row
  FROM cycle_task_generations
  WHERE owner_id = NEW.owner_id
    AND id = NEW.cycle_task_generation_id;

  SELECT * INTO snapshot_row
  FROM cycle_planning_snapshots
  WHERE owner_id = generation_row.owner_id
    AND bake_cycle_id = generation_row.bake_cycle_id
    AND id = generation_row.planning_snapshot_id;

  SELECT * INTO cycle_row
  FROM bake_cycles
  WHERE owner_id = generation_row.owner_id
    AND id = generation_row.bake_cycle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task generation is read-only';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF snapshot_row.status <> 'ACTIVE'
      OR cycle_row.active_planning_snapshot_id IS DISTINCT FROM snapshot_row.id
      OR cycle_row.status NOT IN ('LOCKED', 'IN_PRODUCTION') THEN
      RAISE EXCEPTION 'task generation is read-only';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.origin = 'MANUAL' THEN
    IF snapshot_row.status <> 'ACTIVE'
      OR cycle_row.active_planning_snapshot_id IS DISTINCT FROM snapshot_row.id
      OR cycle_row.status NOT IN ('LOCKED', 'IN_PRODUCTION') THEN
      RAISE EXCEPTION 'task generation is read-only';
    END IF;
    RETURN NEW;
  END IF;

  IF snapshot_row.status <> 'ACTIVE'
    OR cycle_row.status <> 'OPEN'
    OR cycle_row.active_planning_snapshot_id IS NOT NULL THEN
    RAISE EXCEPTION 'task generation is read-only';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cycle_task_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON cycle_tasks
FOR EACH ROW EXECUTE FUNCTION enforce_cycle_task_lifecycle();
