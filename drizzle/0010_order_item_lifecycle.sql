ALTER TABLE "order_items" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
WITH "ranked_order_items" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "owner_id", "order_id"
			ORDER BY "created_at", "id"
		) - 1 AS "position"
	FROM "order_items"
)
UPDATE "order_items"
SET "position" = "ranked_order_items"."position"
FROM "ranked_order_items"
WHERE "order_items"."id" = "ranked_order_items"."id";--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_owner_order_active_position_unique" ON "order_items" USING btree ("owner_id","order_id","position") WHERE "order_items"."active" = true;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_position_non_negative" CHECK ("order_items"."position" >= 0);
