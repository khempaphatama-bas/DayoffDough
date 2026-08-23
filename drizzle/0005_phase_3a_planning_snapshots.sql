CREATE TYPE "public"."planning_snapshot_status" AS ENUM('ACTIVE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."planning_warning_scope" AS ENUM('CYCLE', 'ORDER', 'PRODUCT', 'INVENTORY_ITEM');--> statement-breakpoint
CREATE TYPE "public"."waste_allowance_source" AS ENUM('RECIPE', 'SHOP_DEFAULT');--> statement-breakpoint
CREATE TABLE "cycle_cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"known_base_ingredient_cost_satang" integer NOT NULL,
	"known_waste_cost_satang" integer NOT NULL,
	"known_product_packaging_cost_satang" integer NOT NULL,
	"known_delivery_packaging_cost_satang" integer NOT NULL,
	"labor_cost_satang" integer NOT NULL,
	"utility_cost_satang" integer NOT NULL,
	"known_production_cost_satang" integer NOT NULL,
	"complete_production_cost_satang" integer,
	"missing_price_count" integer NOT NULL,
	"cost_complete" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_cost_snapshots_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_cost_snapshots_owner_snapshot_unique" UNIQUE("owner_id","planning_snapshot_id"),
	CONSTRAINT "cycle_cost_snapshots_money_non_negative" CHECK ("cycle_cost_snapshots"."known_base_ingredient_cost_satang" >= 0 AND "cycle_cost_snapshots"."known_waste_cost_satang" >= 0 AND "cycle_cost_snapshots"."known_product_packaging_cost_satang" >= 0 AND "cycle_cost_snapshots"."known_delivery_packaging_cost_satang" >= 0 AND "cycle_cost_snapshots"."labor_cost_satang" >= 0 AND "cycle_cost_snapshots"."utility_cost_satang" >= 0 AND "cycle_cost_snapshots"."known_production_cost_satang" >= 0 AND ("cycle_cost_snapshots"."complete_production_cost_satang" IS NULL OR "cycle_cost_snapshots"."complete_production_cost_satang" >= 0)),
	CONSTRAINT "cycle_cost_snapshots_missing_price_non_negative" CHECK ("cycle_cost_snapshots"."missing_price_count" >= 0),
	CONSTRAINT "cycle_cost_snapshots_completeness" CHECK (("cycle_cost_snapshots"."cost_complete" AND "cycle_cost_snapshots"."complete_production_cost_satang" IS NOT NULL AND "cycle_cost_snapshots"."missing_price_count" = 0) OR (NOT "cycle_cost_snapshots"."cost_complete" AND "cycle_cost_snapshots"."complete_production_cost_satang" IS NULL AND "cycle_cost_snapshots"."missing_price_count" > 0))
);
--> statement-breakpoint
CREATE TABLE "cycle_inventory_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"inventory_item_name" varchar(160) NOT NULL,
	"inventory_category" "inventory_category" NOT NULL,
	"base_unit" varchar(16) NOT NULL,
	"source_price_id" uuid,
	"pack_price_satang" integer,
	"pack_base_quantity" numeric(18, 6),
	"effective_at" timestamp with time zone,
	"unit_cost_satang" numeric(24, 12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_inventory_price_snapshots_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_inventory_price_snapshots_owner_snapshot_item_unique" UNIQUE("owner_id","planning_snapshot_id","inventory_item_id"),
	CONSTRAINT "cycle_inventory_price_snapshots_all_null_or_present" CHECK (("cycle_inventory_price_snapshots"."source_price_id" IS NULL AND "cycle_inventory_price_snapshots"."pack_price_satang" IS NULL AND "cycle_inventory_price_snapshots"."pack_base_quantity" IS NULL AND "cycle_inventory_price_snapshots"."effective_at" IS NULL AND "cycle_inventory_price_snapshots"."unit_cost_satang" IS NULL) OR ("cycle_inventory_price_snapshots"."source_price_id" IS NOT NULL AND "cycle_inventory_price_snapshots"."pack_price_satang" IS NOT NULL AND "cycle_inventory_price_snapshots"."pack_base_quantity" IS NOT NULL AND "cycle_inventory_price_snapshots"."effective_at" IS NOT NULL AND "cycle_inventory_price_snapshots"."unit_cost_satang" IS NOT NULL)),
	CONSTRAINT "cycle_inventory_price_snapshots_values_valid" CHECK ("cycle_inventory_price_snapshots"."pack_price_satang" IS NULL OR ("cycle_inventory_price_snapshots"."pack_price_satang" >= 0 AND "cycle_inventory_price_snapshots"."pack_base_quantity" > 0 AND "cycle_inventory_price_snapshots"."unit_cost_satang" >= 0))
);
--> statement-breakpoint
CREATE TABLE "cycle_material_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"product_plan_id" uuid NOT NULL,
	"recipe_plan_id" uuid NOT NULL,
	"source_recipe_ingredient_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"price_snapshot_id" uuid NOT NULL,
	"inventory_item_name" varchar(160) NOT NULL,
	"base_unit" varchar(16) NOT NULL,
	"quantity_per_batch" numeric(18, 6) NOT NULL,
	"selected_batch_count" numeric(18, 6) NOT NULL,
	"base_requirement" numeric(18, 6) NOT NULL,
	"waste_allowance_percent" numeric(7, 4) NOT NULL,
	"waste_quantity" numeric(18, 6) NOT NULL,
	"planned_requirement" numeric(18, 6) NOT NULL,
	"base_cost_satang" integer,
	"waste_cost_satang" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_material_requirements_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_material_requirements_quantities_valid" CHECK ("cycle_material_requirements"."quantity_per_batch" > 0 AND "cycle_material_requirements"."selected_batch_count" > 0 AND "cycle_material_requirements"."base_requirement" > 0 AND "cycle_material_requirements"."waste_quantity" >= 0 AND "cycle_material_requirements"."planned_requirement" > 0),
	CONSTRAINT "cycle_material_requirements_waste_percent_range" CHECK ("cycle_material_requirements"."waste_allowance_percent" >= 0 AND "cycle_material_requirements"."waste_allowance_percent" <= 100),
	CONSTRAINT "cycle_material_requirements_costs_all_null_or_present" CHECK (("cycle_material_requirements"."base_cost_satang" IS NULL AND "cycle_material_requirements"."waste_cost_satang" IS NULL) OR ("cycle_material_requirements"."base_cost_satang" IS NOT NULL AND "cycle_material_requirements"."waste_cost_satang" IS NOT NULL)),
	CONSTRAINT "cycle_material_requirements_costs_non_negative" CHECK ("cycle_material_requirements"."base_cost_satang" IS NULL OR ("cycle_material_requirements"."base_cost_satang" >= 0 AND "cycle_material_requirements"."waste_cost_satang" >= 0))
);
--> statement-breakpoint
CREATE TABLE "cycle_order_item_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"order_snapshot_id" uuid NOT NULL,
	"source_order_item_id" uuid NOT NULL,
	"source_product_id" uuid NOT NULL,
	"product_name" varchar(160) NOT NULL,
	"selling_unit" varchar(16) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_satang" integer NOT NULL,
	"line_note" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_order_item_snapshots_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_order_item_snapshots_owner_snapshot_source_unique" UNIQUE("owner_id","planning_snapshot_id","source_order_item_id"),
	CONSTRAINT "cycle_order_item_snapshots_quantity_positive" CHECK ("cycle_order_item_snapshots"."quantity" > 0),
	CONSTRAINT "cycle_order_item_snapshots_price_non_negative" CHECK ("cycle_order_item_snapshots"."unit_price_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cycle_order_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"source_order_id" uuid NOT NULL,
	"source_customer_id" uuid NOT NULL,
	"customer_name" varchar(160) NOT NULL,
	"source_delivery_method_id" uuid,
	"delivery_method_name" varchar(160),
	"source_channel" "order_source_channel",
	"requested_delivery_date" date,
	"confirmed_delivery_date" date,
	"delivery_location" varchar(2000),
	"delivery_note" varchar(2000),
	"special_instructions" varchar(2000),
	"payment_status" "order_payment_status" NOT NULL,
	"fulfillment_status" "order_fulfillment_status" NOT NULL,
	"delivery_fee_payer" "delivery_fee_payer" NOT NULL,
	"delivery_fee_charged_satang" integer NOT NULL,
	"delivery_cost_satang" integer NOT NULL,
	"discount_satang" integer NOT NULL,
	"amount_paid_satang" integer NOT NULL,
	"subtotal_satang" integer NOT NULL,
	"grand_total_satang" integer NOT NULL,
	"balance_satang" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_order_snapshots_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_order_snapshots_owner_snapshot_source_unique" UNIQUE("owner_id","planning_snapshot_id","source_order_id"),
	CONSTRAINT "cycle_order_snapshots_money_non_negative" CHECK ("cycle_order_snapshots"."delivery_fee_charged_satang" >= 0 AND "cycle_order_snapshots"."delivery_cost_satang" >= 0 AND "cycle_order_snapshots"."discount_satang" >= 0 AND "cycle_order_snapshots"."amount_paid_satang" >= 0 AND "cycle_order_snapshots"."subtotal_satang" >= 0 AND "cycle_order_snapshots"."grand_total_satang" >= 0 AND "cycle_order_snapshots"."balance_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cycle_packaging_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"product_plan_id" uuid,
	"source_packaging_rule_id" uuid NOT NULL,
	"scope" "packaging_rule_scope" NOT NULL,
	"consumption_basis" "packaging_consumption_basis" NOT NULL,
	"source_product_id" uuid,
	"source_delivery_method_id" uuid,
	"target_name" varchar(160) NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"inventory_item_name" varchar(160) NOT NULL,
	"base_unit" varchar(16) NOT NULL,
	"price_snapshot_id" uuid NOT NULL,
	"rule_quantity" numeric(18, 6) NOT NULL,
	"multiplier" numeric(18, 6) NOT NULL,
	"planned_requirement" numeric(18, 6) NOT NULL,
	"cost_satang" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_packaging_requirements_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_packaging_requirements_scope_target" CHECK (("cycle_packaging_requirements"."scope" = 'PRODUCT' AND "cycle_packaging_requirements"."product_plan_id" IS NOT NULL AND "cycle_packaging_requirements"."source_product_id" IS NOT NULL AND "cycle_packaging_requirements"."source_delivery_method_id" IS NULL) OR ("cycle_packaging_requirements"."scope" = 'DELIVERY_METHOD' AND "cycle_packaging_requirements"."product_plan_id" IS NULL AND "cycle_packaging_requirements"."source_product_id" IS NULL AND "cycle_packaging_requirements"."source_delivery_method_id" IS NOT NULL)),
	CONSTRAINT "cycle_packaging_requirements_basis_valid" CHECK (("cycle_packaging_requirements"."scope" = 'PRODUCT' AND "cycle_packaging_requirements"."consumption_basis" IN ('PER_PRODUCT_UNIT', 'PER_ORDER')) OR ("cycle_packaging_requirements"."scope" = 'DELIVERY_METHOD' AND "cycle_packaging_requirements"."consumption_basis" = 'PER_DELIVERY')),
	CONSTRAINT "cycle_packaging_requirements_quantities_positive" CHECK ("cycle_packaging_requirements"."rule_quantity" > 0 AND "cycle_packaging_requirements"."multiplier" > 0 AND "cycle_packaging_requirements"."planned_requirement" > 0),
	CONSTRAINT "cycle_packaging_requirements_cost_non_negative" CHECK ("cycle_packaging_requirements"."cost_satang" IS NULL OR "cycle_packaging_requirements"."cost_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cycle_planning_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"status" "planning_snapshot_status" NOT NULL,
	"lock_request_id" uuid NOT NULL,
	"input_fingerprint" varchar(64) NOT NULL,
	"cycle_number" integer NOT NULL,
	"cycle_name" varchar(160) NOT NULL,
	"order_cutoff_at" timestamp with time zone,
	"target_production_date" date NOT NULL,
	"primary_delivery_date" date NOT NULL,
	"labor_rate_satang_per_hour" integer NOT NULL,
	"default_waste_allowance_percent" numeric(7, 4) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"cost_complete" boolean NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"unlocked_at" timestamp with time zone,
	"unlock_reason" varchar(2000),
	"unlocked_from_status" "bake_cycle_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_planning_snapshots_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_planning_snapshots_owner_cycle_generation_unique" UNIQUE("owner_id","bake_cycle_id","generation"),
	CONSTRAINT "cycle_planning_snapshots_owner_lock_request_unique" UNIQUE("owner_id","lock_request_id"),
	CONSTRAINT "cycle_planning_snapshots_generation_positive" CHECK ("cycle_planning_snapshots"."generation" > 0),
	CONSTRAINT "cycle_planning_snapshots_fingerprint_length" CHECK (char_length("cycle_planning_snapshots"."input_fingerprint") = 64),
	CONSTRAINT "cycle_planning_snapshots_cycle_number_positive" CHECK ("cycle_planning_snapshots"."cycle_number" > 0),
	CONSTRAINT "cycle_planning_snapshots_labor_rate_non_negative" CHECK ("cycle_planning_snapshots"."labor_rate_satang_per_hour" >= 0),
	CONSTRAINT "cycle_planning_snapshots_waste_percent_range" CHECK ("cycle_planning_snapshots"."default_waste_allowance_percent" >= 0 AND "cycle_planning_snapshots"."default_waste_allowance_percent" <= 100),
	CONSTRAINT "cycle_planning_snapshots_unlock_metadata" CHECK (("cycle_planning_snapshots"."status" = 'ACTIVE' AND "cycle_planning_snapshots"."unlocked_at" IS NULL AND "cycle_planning_snapshots"."unlock_reason" IS NULL AND "cycle_planning_snapshots"."unlocked_from_status" IS NULL) OR ("cycle_planning_snapshots"."status" = 'SUPERSEDED' AND "cycle_planning_snapshots"."unlocked_at" IS NOT NULL AND "cycle_planning_snapshots"."unlock_reason" IS NOT NULL AND char_length(trim("cycle_planning_snapshots"."unlock_reason")) > 0 AND "cycle_planning_snapshots"."unlocked_from_status" IN ('LOCKED', 'IN_PRODUCTION')))
);
--> statement-breakpoint
CREATE TABLE "cycle_planning_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"scope" "planning_warning_scope" NOT NULL,
	"source_entity_id" uuid,
	"message" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_planning_warnings_owner_id_id_unique" UNIQUE("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "cycle_product_cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"product_plan_id" uuid NOT NULL,
	"known_base_ingredient_cost_satang" integer NOT NULL,
	"known_waste_cost_satang" integer NOT NULL,
	"known_product_packaging_cost_satang" integer NOT NULL,
	"labor_cost_satang" integer NOT NULL,
	"utility_cost_satang" integer NOT NULL,
	"known_production_cost_satang" integer NOT NULL,
	"complete_production_cost_satang" integer,
	"cost_complete" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_product_cost_snapshots_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_product_cost_snapshots_owner_snapshot_product_unique" UNIQUE("owner_id","planning_snapshot_id","product_plan_id"),
	CONSTRAINT "cycle_product_cost_snapshots_money_non_negative" CHECK ("cycle_product_cost_snapshots"."known_base_ingredient_cost_satang" >= 0 AND "cycle_product_cost_snapshots"."known_waste_cost_satang" >= 0 AND "cycle_product_cost_snapshots"."known_product_packaging_cost_satang" >= 0 AND "cycle_product_cost_snapshots"."labor_cost_satang" >= 0 AND "cycle_product_cost_snapshots"."utility_cost_satang" >= 0 AND "cycle_product_cost_snapshots"."known_production_cost_satang" >= 0 AND ("cycle_product_cost_snapshots"."complete_production_cost_satang" IS NULL OR "cycle_product_cost_snapshots"."complete_production_cost_satang" >= 0)),
	CONSTRAINT "cycle_product_cost_snapshots_completeness" CHECK (("cycle_product_cost_snapshots"."cost_complete" AND "cycle_product_cost_snapshots"."complete_production_cost_satang" IS NOT NULL) OR (NOT "cycle_product_cost_snapshots"."cost_complete" AND "cycle_product_cost_snapshots"."complete_production_cost_satang" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "cycle_product_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"source_product_id" uuid NOT NULL,
	"recipe_plan_id" uuid NOT NULL,
	"product_name" varchar(160) NOT NULL,
	"selling_unit" varchar(16) NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"suggested_batch_count" integer NOT NULL,
	"selected_batch_count" numeric(18, 6) NOT NULL,
	"override_reason" varchar(2000),
	"planned_output" numeric(18, 6) NOT NULL,
	"output_difference" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_product_plans_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_product_plans_owner_snapshot_product_unique" UNIQUE("owner_id","planning_snapshot_id","source_product_id"),
	CONSTRAINT "cycle_product_plans_owner_snapshot_recipe_unique" UNIQUE("owner_id","planning_snapshot_id","recipe_plan_id"),
	CONSTRAINT "cycle_product_plans_quantities_positive" CHECK ("cycle_product_plans"."ordered_quantity" > 0 AND "cycle_product_plans"."suggested_batch_count" > 0 AND "cycle_product_plans"."selected_batch_count" > 0 AND "cycle_product_plans"."planned_output" > 0),
	CONSTRAINT "cycle_product_plans_override_reason" CHECK (("cycle_product_plans"."selected_batch_count" = "cycle_product_plans"."suggested_batch_count" AND "cycle_product_plans"."override_reason" IS NULL) OR ("cycle_product_plans"."selected_batch_count" <> "cycle_product_plans"."suggested_batch_count" AND "cycle_product_plans"."override_reason" IS NOT NULL AND char_length(trim("cycle_product_plans"."override_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "cycle_recipe_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"source_product_id" uuid NOT NULL,
	"source_recipe_id" uuid NOT NULL,
	"source_recipe_version_id" uuid NOT NULL,
	"recipe_name" varchar(160) NOT NULL,
	"version_code" varchar(80) NOT NULL,
	"instructions" text NOT NULL,
	"base_yield_quantity" numeric(18, 6) NOT NULL,
	"yield_unit" varchar(16) NOT NULL,
	"yield_in_selling_unit" numeric(18, 6) NOT NULL,
	"selling_unit" varchar(16) NOT NULL,
	"labor_minutes_per_batch" integer NOT NULL,
	"utility_cost_satang_per_batch" integer NOT NULL,
	"waste_allowance_percent" numeric(7, 4) NOT NULL,
	"waste_allowance_source" "waste_allowance_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_recipe_plans_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_recipe_plans_owner_snapshot_product_unique" UNIQUE("owner_id","planning_snapshot_id","source_product_id"),
	CONSTRAINT "cycle_recipe_plans_yields_positive" CHECK ("cycle_recipe_plans"."base_yield_quantity" > 0 AND "cycle_recipe_plans"."yield_in_selling_unit" > 0),
	CONSTRAINT "cycle_recipe_plans_labor_utility_non_negative" CHECK ("cycle_recipe_plans"."labor_minutes_per_batch" >= 0 AND "cycle_recipe_plans"."utility_cost_satang_per_batch" >= 0),
	CONSTRAINT "cycle_recipe_plans_waste_percent_range" CHECK ("cycle_recipe_plans"."waste_allowance_percent" >= 0 AND "cycle_recipe_plans"."waste_allowance_percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "bake_cycles" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bake_cycles" ADD COLUMN "active_planning_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_prices" ADD CONSTRAINT "inventory_prices_owner_id_id_unique" UNIQUE("owner_id","id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_owner_id_id_unique" UNIQUE("owner_id","id");--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "product_packaging_rules_owner_id_id_unique" UNIQUE("owner_id","id");--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_owner_id_id_unique" UNIQUE("owner_id","id");--> statement-breakpoint
ALTER TABLE "cycle_cost_snapshots" ADD CONSTRAINT "cycle_cost_snapshots_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ADD CONSTRAINT "cycle_inventory_price_snapshots_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ADD CONSTRAINT "cycle_inventory_price_snapshots_owned_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ADD CONSTRAINT "cycle_inventory_price_snapshots_owned_source_price_fk" FOREIGN KEY ("owner_id","source_price_id") REFERENCES "public"."inventory_prices"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_product_plan_fk" FOREIGN KEY ("owner_id","product_plan_id") REFERENCES "public"."cycle_product_plans"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_recipe_plan_fk" FOREIGN KEY ("owner_id","recipe_plan_id") REFERENCES "public"."cycle_recipe_plans"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_source_ingredient_fk" FOREIGN KEY ("owner_id","source_recipe_ingredient_id") REFERENCES "public"."recipe_ingredients"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_inventory_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ADD CONSTRAINT "cycle_material_requirements_owned_price_snapshot_fk" FOREIGN KEY ("owner_id","price_snapshot_id") REFERENCES "public"."cycle_inventory_price_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_order_snapshot_fk" FOREIGN KEY ("owner_id","order_snapshot_id") REFERENCES "public"."cycle_order_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_source_item_fk" FOREIGN KEY ("owner_id","source_order_item_id") REFERENCES "public"."order_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ADD CONSTRAINT "cycle_order_item_snapshots_owned_source_product_fk" FOREIGN KEY ("owner_id","source_product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owned_source_order_fk" FOREIGN KEY ("owner_id","source_order_id") REFERENCES "public"."orders"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owned_source_customer_fk" FOREIGN KEY ("owner_id","source_customer_id") REFERENCES "public"."customers"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ADD CONSTRAINT "cycle_order_snapshots_owned_delivery_method_fk" FOREIGN KEY ("owner_id","source_delivery_method_id") REFERENCES "public"."delivery_methods"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_product_plan_fk" FOREIGN KEY ("owner_id","product_plan_id") REFERENCES "public"."cycle_product_plans"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_source_rule_fk" FOREIGN KEY ("owner_id","source_packaging_rule_id") REFERENCES "public"."product_packaging_rules"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_source_product_fk" FOREIGN KEY ("owner_id","source_product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_delivery_method_fk" FOREIGN KEY ("owner_id","source_delivery_method_id") REFERENCES "public"."delivery_methods"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_inventory_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ADD CONSTRAINT "cycle_packaging_requirements_owned_price_snapshot_fk" FOREIGN KEY ("owner_id","price_snapshot_id") REFERENCES "public"."cycle_inventory_price_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_planning_snapshots" ADD CONSTRAINT "cycle_planning_snapshots_owned_cycle_fk" FOREIGN KEY ("owner_id","bake_cycle_id") REFERENCES "public"."bake_cycles"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bake_cycles" ADD CONSTRAINT "bake_cycles_owned_active_planning_snapshot_fk"
FOREIGN KEY ("owner_id", "active_planning_snapshot_id")
REFERENCES "cycle_planning_snapshots" ("owner_id", "id")
ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "cycle_planning_warnings" ADD CONSTRAINT "cycle_planning_warnings_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_cost_snapshots" ADD CONSTRAINT "cycle_product_cost_snapshots_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_cost_snapshots" ADD CONSTRAINT "cycle_product_cost_snapshots_owned_product_plan_fk" FOREIGN KEY ("owner_id","product_plan_id") REFERENCES "public"."cycle_product_plans"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owned_source_product_fk" FOREIGN KEY ("owner_id","source_product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ADD CONSTRAINT "cycle_product_plans_owned_recipe_plan_fk" FOREIGN KEY ("owner_id","recipe_plan_id") REFERENCES "public"."cycle_recipe_plans"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owned_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owned_source_product_fk" FOREIGN KEY ("owner_id","source_product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owned_source_recipe_fk" FOREIGN KEY ("owner_id","source_recipe_id") REFERENCES "public"."recipes"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ADD CONSTRAINT "cycle_recipe_plans_owned_source_version_fk" FOREIGN KEY ("owner_id","source_recipe_version_id") REFERENCES "public"."recipe_versions"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_cost_snapshots_owner_snapshot_idx" ON "cycle_cost_snapshots" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_inventory_price_snapshots_owner_snapshot_idx" ON "cycle_inventory_price_snapshots" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_material_requirements_owner_snapshot_item_idx" ON "cycle_material_requirements" USING btree ("owner_id","planning_snapshot_id","inventory_item_id");--> statement-breakpoint
CREATE INDEX "cycle_order_item_snapshots_owner_snapshot_idx" ON "cycle_order_item_snapshots" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_order_snapshots_owner_snapshot_idx" ON "cycle_order_snapshots" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_packaging_requirements_owner_snapshot_item_idx" ON "cycle_packaging_requirements" USING btree ("owner_id","planning_snapshot_id","inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_planning_snapshots_one_active_per_cycle_idx" ON "cycle_planning_snapshots" USING btree ("owner_id","bake_cycle_id") WHERE "cycle_planning_snapshots"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "cycle_planning_snapshots_owner_cycle_locked_idx" ON "cycle_planning_snapshots" USING btree ("owner_id","bake_cycle_id","locked_at");--> statement-breakpoint
CREATE INDEX "cycle_planning_warnings_owner_snapshot_idx" ON "cycle_planning_warnings" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_product_cost_snapshots_owner_snapshot_idx" ON "cycle_product_cost_snapshots" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_product_plans_owner_snapshot_idx" ON "cycle_product_plans" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_recipe_plans_owner_snapshot_idx" ON "cycle_recipe_plans" USING btree ("owner_id","planning_snapshot_id");--> statement-breakpoint
ALTER TABLE "cycle_planning_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_planning_warnings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_order_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_order_item_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_recipe_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_product_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_inventory_price_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_material_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_packaging_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_product_cost_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_cost_snapshots" ENABLE ROW LEVEL SECURITY;
