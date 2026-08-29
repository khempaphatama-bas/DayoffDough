ALTER TABLE "cycle_order_snapshots" ADD COLUMN "delivery_requires_location" boolean;--> statement-breakpoint
UPDATE "cycle_order_snapshots" AS "snapshot"
SET "delivery_requires_location" = COALESCE((
  SELECT "method"."requires_delivery_location"
  FROM "delivery_methods" AS "method"
  WHERE "method"."owner_id" = "snapshot"."owner_id"
    AND "method"."id" = "snapshot"."source_delivery_method_id"
), false);--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ALTER COLUMN "delivery_requires_location" SET NOT NULL;
