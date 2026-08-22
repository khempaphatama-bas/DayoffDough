CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"selling_unit" varchar(16) NOT NULL,
	"default_unit_price_satang" integer NOT NULL,
	"active_recipe_version_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_owner_name_unique" UNIQUE("owner_id","name"),
	CONSTRAINT "products_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "products_default_price_non_negative" CHECK ("products"."default_unit_price_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity_in_base_unit" numeric(18, 6) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_ingredients_quantity_positive" CHECK ("recipe_ingredients"."quantity_in_base_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version_code" varchar(80) NOT NULL,
	"base_yield_quantity" numeric(18, 6) NOT NULL,
	"yield_unit" varchar(16) NOT NULL,
	"labor_minutes_per_batch" integer NOT NULL,
	"utility_cost_satang_per_batch" integer NOT NULL,
	"waste_allowance_percent" numeric(7, 4),
	"instructions" text NOT NULL,
	"active_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_recipe_code_unique" UNIQUE("recipe_id","version_code"),
	CONSTRAINT "recipe_versions_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "recipe_versions_base_yield_positive" CHECK ("recipe_versions"."base_yield_quantity" > 0),
	CONSTRAINT "recipe_versions_labor_non_negative" CHECK ("recipe_versions"."labor_minutes_per_batch" >= 0),
	CONSTRAINT "recipe_versions_utility_non_negative" CHECK ("recipe_versions"."utility_cost_satang_per_batch" >= 0),
	CONSTRAINT "recipe_versions_waste_range" CHECK ("recipe_versions"."waste_allowance_percent" IS NULL OR ("recipe_versions"."waste_allowance_percent" >= 0 AND "recipe_versions"."waste_allowance_percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_owner_product_unique" UNIQUE("owner_id","product_id"),
	CONSTRAINT "recipes_owner_id_id_unique" UNIQUE("owner_id","id")
);
--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_owned_version_fk" FOREIGN KEY ("owner_id","recipe_version_id") REFERENCES "public"."recipe_versions"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_owned_inventory_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_owned_recipe_fk" FOREIGN KEY ("owner_id","recipe_id") REFERENCES "public"."recipes"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owned_product_fk" FOREIGN KEY ("owner_id","product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_owner_id_idx" ON "products" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_owner_version_idx" ON "recipe_ingredients" USING btree ("owner_id","recipe_version_id");--> statement-breakpoint
CREATE INDEX "recipe_versions_owner_recipe_idx" ON "recipe_versions" USING btree ("owner_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_owner_id_idx" ON "recipes" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owned_active_recipe_version_fk" FOREIGN KEY ("owner_id","active_recipe_version_id") REFERENCES "public"."recipe_versions"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ENABLE ROW LEVEL SECURITY;
