ALTER TABLE "cycle_inventory_price_snapshots" DROP CONSTRAINT "cycle_inventory_price_snapshots_owned_source_price_fk";
--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" DROP CONSTRAINT "cycle_material_requirements_owned_product_plan_fk";
--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" DROP CONSTRAINT "cycle_material_requirements_owned_recipe_plan_fk";
--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" DROP CONSTRAINT "cycle_material_requirements_owned_source_ingredient_fk";
--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" DROP CONSTRAINT "cycle_material_requirements_owned_price_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" DROP CONSTRAINT "cycle_order_item_snapshots_owned_order_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" DROP CONSTRAINT "cycle_order_item_snapshots_owned_source_item_fk";
--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" DROP CONSTRAINT "cycle_order_snapshots_owned_source_order_fk";
--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" DROP CONSTRAINT "cycle_packaging_requirements_owned_product_plan_fk";
--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" DROP CONSTRAINT "cycle_packaging_requirements_owned_source_rule_fk";
--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" DROP CONSTRAINT "cycle_packaging_requirements_owned_price_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "cycle_product_cost_snapshots" DROP CONSTRAINT "cycle_product_cost_snapshots_owned_product_plan_fk";
--> statement-breakpoint
ALTER TABLE "cycle_product_plans" DROP CONSTRAINT "cycle_product_plans_owned_recipe_plan_fk";
--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" DROP CONSTRAINT "cycle_recipe_plans_owned_source_recipe_fk";
--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" DROP CONSTRAINT "cycle_recipe_plans_owned_source_version_fk";
--> statement-breakpoint
ALTER TABLE "bake_cycles" DROP CONSTRAINT "bake_cycles_owned_active_planning_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ADD CONSTRAINT "cycle_inventory_price_snapshots_owner_snapshot_id_unique" UNIQUE("owner_id","planning_snapshot_id","id");--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ADD CONSTRAINT "cycle_inventory_price_snapshots_snapshot_item_id_unique" UNIQUE("owner_id","planning_snapshot_id","inventory_item_id","id");--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owner_snapshot_id_unique" UNIQUE("owner_id","planning_snapshot_id","id");--> statement-breakpoint
ALTER TABLE "cycle_planning_snapshots" ADD CONSTRAINT "cycle_planning_snapshots_owner_cycle_id_unique" UNIQUE("owner_id","bake_cycle_id","id");--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owner_snapshot_id_unique" UNIQUE("owner_id","planning_snapshot_id","id");--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owner_snapshot_product_id_unique" UNIQUE("owner_id","planning_snapshot_id","source_product_id","id");--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owner_snapshot_recipe_id_unique" UNIQUE("owner_id","planning_snapshot_id","recipe_plan_id","id");--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owner_snapshot_id_unique" UNIQUE("owner_id","planning_snapshot_id","id");--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owner_snapshot_product_id_unique" UNIQUE("owner_id","planning_snapshot_id","source_product_id","id");--> statement-breakpoint
ALTER TABLE "inventory_prices" ADD CONSTRAINT "inventory_prices_owner_item_id_unique" UNIQUE("owner_id","inventory_item_id","id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_owner_product_id_unique" UNIQUE("owner_id","product_id","id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_customer_id_unique" UNIQUE("owner_id","customer_id","id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_delivery_method_id_unique" UNIQUE("owner_id","delivery_method_id","id");--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owner_item_id_unique" UNIQUE("owner_id","inventory_item_id","id");--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owner_product_id_unique" UNIQUE("owner_id","product_id","id");--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owner_delivery_id_unique" UNIQUE("owner_id","delivery_method_id","id");--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owner_scope_basis_id_unique" UNIQUE("owner_id","scope","consumption_basis","id");--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_owner_item_id_unique" UNIQUE("owner_id","inventory_item_id","id");--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_owner_recipe_id_unique" UNIQUE("owner_id","recipe_id","id");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_product_id_unique" UNIQUE("owner_id","product_id","id");--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ADD CONSTRAINT "cycle_inventory_price_snapshots_owned_source_price_fk" FOREIGN KEY ("owner_id","inventory_item_id","source_price_id") REFERENCES "public"."inventory_prices"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_product_plan_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","recipe_plan_id","product_plan_id") REFERENCES "public"."cycle_product_plans"("owner_id","planning_snapshot_id","recipe_plan_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_recipe_plan_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","recipe_plan_id") REFERENCES "public"."cycle_recipe_plans"("owner_id","planning_snapshot_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_source_ingredient_fk" FOREIGN KEY ("owner_id","inventory_item_id","source_recipe_ingredient_id") REFERENCES "public"."recipe_ingredients"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_price_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","inventory_item_id","price_snapshot_id") REFERENCES "public"."cycle_inventory_price_snapshots"("owner_id","planning_snapshot_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_order_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","order_snapshot_id") REFERENCES "public"."cycle_order_snapshots"("owner_id","planning_snapshot_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_source_item_fk" FOREIGN KEY ("owner_id","source_product_id","source_order_item_id") REFERENCES "public"."order_items"("owner_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owned_source_order_customer_fk" FOREIGN KEY ("owner_id","source_customer_id","source_order_id") REFERENCES "public"."orders"("owner_id","customer_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owned_source_order_delivery_fk" FOREIGN KEY ("owner_id","source_delivery_method_id","source_order_id") REFERENCES "public"."orders"("owner_id","delivery_method_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_rule_product_fk" FOREIGN KEY ("owner_id","source_product_id","source_packaging_rule_id") REFERENCES "public"."product_packaging_rules"("owner_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_rule_delivery_fk" FOREIGN KEY ("owner_id","source_delivery_method_id","source_packaging_rule_id") REFERENCES "public"."product_packaging_rules"("owner_id","delivery_method_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_rule_scope_basis_fk" FOREIGN KEY ("owner_id","scope","consumption_basis","source_packaging_rule_id") REFERENCES "public"."product_packaging_rules"("owner_id","scope","consumption_basis","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_product_plan_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","source_product_id","product_plan_id") REFERENCES "public"."cycle_product_plans"("owner_id","planning_snapshot_id","source_product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_source_rule_fk" FOREIGN KEY ("owner_id","inventory_item_id","source_packaging_rule_id") REFERENCES "public"."product_packaging_rules"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_price_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","inventory_item_id","price_snapshot_id") REFERENCES "public"."cycle_inventory_price_snapshots"("owner_id","planning_snapshot_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_cost_snapshots" ADD CONSTRAINT "cycle_product_cost_snapshots_owned_product_plan_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","product_plan_id") REFERENCES "public"."cycle_product_plans"("owner_id","planning_snapshot_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owned_recipe_plan_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","source_product_id","recipe_plan_id") REFERENCES "public"."cycle_recipe_plans"("owner_id","planning_snapshot_id","source_product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owned_source_recipe_fk" FOREIGN KEY ("owner_id","source_product_id","source_recipe_id") REFERENCES "public"."recipes"("owner_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owned_source_version_fk" FOREIGN KEY ("owner_id","source_recipe_id","source_recipe_version_id") REFERENCES "public"."recipe_versions"("owner_id","recipe_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bake_cycles" ADD CONSTRAINT "bake_cycles_owned_active_planning_snapshot_fk" FOREIGN KEY ("owner_id","id","active_planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","bake_cycle_id","id") ON DELETE restrict ON UPDATE no action;
