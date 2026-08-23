ALTER TABLE "cycle_material_requirements" DROP CONSTRAINT "cycle_material_requirements_owned_recipe_plan_fk";
--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" DROP CONSTRAINT "cycle_material_requirements_owned_source_ingredient_fk";
--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" DROP CONSTRAINT "cycle_order_item_snapshots_owned_order_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" DROP CONSTRAINT "cycle_order_item_snapshots_owned_source_item_fk";
--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD COLUMN "source_recipe_version_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD COLUMN "source_order_id" uuid;--> statement-breakpoint
UPDATE "cycle_material_requirements" AS "requirement"
SET "source_recipe_version_id" = "plan"."source_recipe_version_id"
FROM "cycle_recipe_plans" AS "plan"
WHERE "requirement"."owner_id" = "plan"."owner_id"
  AND "requirement"."planning_snapshot_id" = "plan"."planning_snapshot_id"
  AND "requirement"."recipe_plan_id" = "plan"."id";--> statement-breakpoint
UPDATE "cycle_order_item_snapshots" AS "item"
SET "source_order_id" = "snapshot"."source_order_id"
FROM "cycle_order_snapshots" AS "snapshot"
WHERE "item"."owner_id" = "snapshot"."owner_id"
  AND "item"."planning_snapshot_id" = "snapshot"."planning_snapshot_id"
  AND "item"."order_snapshot_id" = "snapshot"."id";--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ALTER COLUMN "source_recipe_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ALTER COLUMN "source_order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owner_snapshot_source_id_unique" UNIQUE("owner_id","planning_snapshot_id","source_order_id","id");--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owner_snapshot_version_id_unique" UNIQUE("owner_id","planning_snapshot_id","source_recipe_version_id","id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_owner_order_product_id_unique" UNIQUE("owner_id","order_id","product_id","id");--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_owner_version_item_id_unique" UNIQUE("owner_id","recipe_version_id","inventory_item_id","id");--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_recipe_plan_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","source_recipe_version_id","recipe_plan_id") REFERENCES "public"."cycle_recipe_plans"("owner_id","planning_snapshot_id","source_recipe_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_source_ingredient_fk" FOREIGN KEY ("owner_id","source_recipe_version_id","inventory_item_id","source_recipe_ingredient_id") REFERENCES "public"."recipe_ingredients"("owner_id","recipe_version_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_order_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","source_order_id","order_snapshot_id") REFERENCES "public"."cycle_order_snapshots"("owner_id","planning_snapshot_id","source_order_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_source_item_fk" FOREIGN KEY ("owner_id","source_order_id","source_product_id","source_order_item_id") REFERENCES "public"."order_items"("owner_id","order_id","product_id","id") ON DELETE restrict ON UPDATE no action;
