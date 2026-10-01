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
