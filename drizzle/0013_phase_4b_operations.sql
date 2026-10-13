ALTER TABLE "cycle_order_snapshots" ADD COLUMN "confirmed_delivery_time" time;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "confirmed_delivery_time" time;--> statement-breakpoint
CREATE TABLE "order_item_packing_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"packed_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_packing_progress_owner_item_unique" UNIQUE("owner_id","order_item_id"),
	CONSTRAINT "order_item_packing_progress_non_negative" CHECK ("order_item_packing_progress"."packed_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_item_packing_progress" ADD CONSTRAINT "order_item_packing_progress_owned_item_fk" FOREIGN KEY ("owner_id","order_item_id") REFERENCES "public"."order_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_packing_progress_owner_item_idx" ON "order_item_packing_progress" USING btree ("owner_id","order_item_id");--> statement-breakpoint
ALTER TABLE "order_item_packing_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO order_item_packing_progress (
  owner_id, order_item_id, packed_quantity
)
SELECT item.owner_id, item.id, item.quantity
FROM order_items AS item
JOIN orders AS order_row
  ON order_row.owner_id = item.owner_id
 AND order_row.id = item.order_id
WHERE item.active = true
  AND order_row.fulfillment_status IN ('PACKED', 'DELIVERED')
ON CONFLICT (owner_id, order_item_id) DO NOTHING;--> statement-breakpoint
CREATE FUNCTION enforce_order_item_packing_progress() RETURNS trigger AS $$
DECLARE
  item_row order_items%ROWTYPE;
  order_row orders%ROWTYPE;
  cycle_row bake_cycles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'packing progress hard delete is not allowed';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id
  ) THEN
    RAISE EXCEPTION 'packing progress owner and item are immutable';
  END IF;

  SELECT * INTO item_row
  FROM order_items
  WHERE owner_id = NEW.owner_id
    AND id = NEW.order_item_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'packing progress requires an active order item';
  END IF;

  IF NEW.packed_quantity > item_row.quantity THEN
    RAISE EXCEPTION 'packed quantity cannot exceed active order item quantity';
  END IF;

  SELECT * INTO order_row
  FROM orders
  WHERE owner_id = item_row.owner_id
    AND id = item_row.order_id;

  IF NOT FOUND OR order_row.fulfillment_status <> 'IN_PRODUCTION' THEN
    RAISE EXCEPTION 'packing progress requires order IN_PRODUCTION';
  END IF;

  SELECT * INTO cycle_row
  FROM bake_cycles
  WHERE owner_id = order_row.owner_id
    AND id = order_row.bake_cycle_id;

  IF NOT FOUND OR cycle_row.status <> 'IN_PRODUCTION' THEN
    RAISE EXCEPTION 'packing progress requires cycle IN_PRODUCTION';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_item_packing_progress_guard
BEFORE INSERT OR UPDATE OR DELETE ON order_item_packing_progress
FOR EACH ROW EXECUTE FUNCTION enforce_order_item_packing_progress();
--> statement-breakpoint
CREATE FUNCTION enforce_order_fulfillment_transition() RETURNS trigger AS $$
DECLARE
  cycle_status bake_cycle_status;
BEGIN
  IF NEW.fulfillment_status IS NOT DISTINCT FROM OLD.fulfillment_status THEN
    RETURN NEW;
  END IF;

  SELECT status INTO cycle_status
  FROM bake_cycles
  WHERE owner_id = NEW.owner_id AND id = NEW.bake_cycle_id
  FOR SHARE;

  IF cycle_status IS NULL THEN
    RAISE EXCEPTION 'order fulfillment transition not allowed: cycle missing';
  END IF;

  IF OLD.fulfillment_status = 'NEW' AND NEW.fulfillment_status = 'CONFIRMED'
     AND cycle_status IN ('DRAFT', 'OPEN', 'LOCKED', 'IN_PRODUCTION') THEN
    RETURN NEW;
  END IF;

  IF OLD.fulfillment_status = 'CONFIRMED' AND NEW.fulfillment_status = 'IN_PRODUCTION'
     AND cycle_status = 'IN_PRODUCTION' THEN
    RETURN NEW;
  END IF;

  IF OLD.fulfillment_status = 'IN_PRODUCTION' AND NEW.fulfillment_status = 'PACKED'
     AND cycle_status = 'IN_PRODUCTION' THEN
    IF EXISTS (
      SELECT 1 FROM order_items AS item
      LEFT JOIN order_item_packing_progress AS progress
        ON progress.owner_id = item.owner_id AND progress.order_item_id = item.id
      WHERE item.owner_id = NEW.owner_id AND item.order_id = NEW.id
        AND item.active = true
        AND COALESCE(progress.packed_quantity, 0) <> item.quantity
    ) THEN
      RAISE EXCEPTION 'order packing incomplete';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.fulfillment_status = 'PACKED'
     AND NEW.fulfillment_status IN ('DELIVERED', 'IN_PRODUCTION')
     AND cycle_status = 'IN_PRODUCTION' THEN
    RETURN NEW;
  END IF;

  IF OLD.fulfillment_status IN ('NEW', 'CONFIRMED', 'IN_PRODUCTION', 'PACKED')
     AND NEW.fulfillment_status = 'CANCELLED'
     AND cycle_status IN ('DRAFT', 'OPEN') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'order fulfillment transition not allowed';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_fulfillment_transition_guard
BEFORE UPDATE OF fulfillment_status ON orders
FOR EACH ROW EXECUTE FUNCTION enforce_order_fulfillment_transition();
--> statement-breakpoint
CREATE FUNCTION enforce_cycle_operations_lifecycle() RETURNS trigger AS $$
DECLARE
  current_generation_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'IN_PRODUCTION' AND OLD.status <> 'LOCKED'
     OR NEW.status = 'COMPLETED' AND OLD.status <> 'IN_PRODUCTION' THEN
    RAISE EXCEPTION 'cycle operations transition not allowed';
  END IF;

  IF OLD.status = 'LOCKED' AND NEW.status = 'IN_PRODUCTION'
     OR OLD.status = 'IN_PRODUCTION' AND NEW.status = 'COMPLETED' THEN
    SELECT generation.id INTO current_generation_id
    FROM cycle_planning_snapshots AS snapshot
    JOIN cycle_task_generations AS generation
      ON generation.owner_id = snapshot.owner_id
     AND generation.bake_cycle_id = snapshot.bake_cycle_id
     AND generation.planning_snapshot_id = snapshot.id
     AND generation.generation = snapshot.generation
    WHERE snapshot.owner_id = NEW.owner_id
      AND snapshot.bake_cycle_id = NEW.id
      AND snapshot.id = NEW.active_planning_snapshot_id
      AND snapshot.status = 'ACTIVE';

    IF current_generation_id IS NULL THEN
      RAISE EXCEPTION 'cycle operations requires current task generation';
    END IF;
  END IF;

  IF OLD.status = 'IN_PRODUCTION' AND NEW.status = 'COMPLETED' THEN
    IF EXISTS (
      SELECT 1 FROM cycle_tasks AS task
      WHERE task.owner_id = NEW.owner_id
        AND task.cycle_task_generation_id = current_generation_id
        AND task.deleted_at IS NULL
        AND task.status NOT IN ('DONE', 'SKIPPED')
    ) OR EXISTS (
      SELECT 1 FROM orders AS order_row
      WHERE order_row.owner_id = NEW.owner_id
        AND order_row.bake_cycle_id = NEW.id
        AND order_row.fulfillment_status NOT IN ('CANCELLED', 'DELIVERED')
    ) THEN
      RAISE EXCEPTION 'cycle completion blocked by unfinished work';
    END IF;
  END IF;

  IF OLD.status IN ('LOCKED', 'IN_PRODUCTION') AND NEW.status = 'OPEN' THEN
    IF EXISTS (
      SELECT 1 FROM orders AS order_row
      WHERE order_row.owner_id = NEW.owner_id
        AND order_row.bake_cycle_id = NEW.id
        AND order_row.fulfillment_status IN ('IN_PRODUCTION', 'PACKED', 'DELIVERED')
    ) OR EXISTS (
      SELECT 1 FROM order_item_packing_progress AS progress
      JOIN order_items AS item
        ON item.owner_id = progress.owner_id AND item.id = progress.order_item_id
      JOIN orders AS order_row
        ON order_row.owner_id = item.owner_id AND order_row.id = item.order_id
      WHERE progress.owner_id = NEW.owner_id
        AND order_row.bake_cycle_id = NEW.id
        AND progress.packed_quantity > 0
    ) THEN
      RAISE EXCEPTION 'cycle unlock blocked by operations';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cycle_operations_lifecycle_guard
BEFORE UPDATE OF status ON bake_cycles
FOR EACH ROW EXECUTE FUNCTION enforce_cycle_operations_lifecycle();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_cycle_task_lifecycle() RETURNS trigger AS $$
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
    AND id = generation_row.bake_cycle_id
  FOR SHARE;

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
$$ LANGUAGE plpgsql;
