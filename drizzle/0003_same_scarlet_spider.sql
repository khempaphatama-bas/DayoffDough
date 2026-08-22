CREATE TYPE "public"."packaging_consumption_basis" AS ENUM('PER_PRODUCT_UNIT', 'PER_ORDER', 'PER_DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."packaging_rule_scope" AS ENUM('PRODUCT', 'DELIVERY_METHOD');--> statement-breakpoint
CREATE TABLE "delivery_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"default_customer_fee_satang" integer NOT NULL,
	"default_internal_cost_satang" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_methods_owner_name_unique" UNIQUE("owner_id","name"),
	CONSTRAINT "delivery_methods_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "delivery_methods_customer_fee_non_negative" CHECK ("delivery_methods"."default_customer_fee_satang" >= 0),
	CONSTRAINT "delivery_methods_internal_cost_non_negative" CHECK ("delivery_methods"."default_internal_cost_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_packaging_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"scope" "packaging_rule_scope" NOT NULL,
	"product_id" uuid,
	"delivery_method_id" uuid,
	"inventory_item_id" uuid NOT NULL,
	"consumption_basis" "packaging_consumption_basis" NOT NULL,
	"quantity_in_base_unit" numeric(18, 6) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packaging_rules_quantity_positive" CHECK ("product_packaging_rules"."quantity_in_base_unit" > 0),
	CONSTRAINT "packaging_rules_exact_scope_target" CHECK (("product_packaging_rules"."scope" = 'PRODUCT' AND "product_packaging_rules"."product_id" IS NOT NULL AND "product_packaging_rules"."delivery_method_id" IS NULL) OR ("product_packaging_rules"."scope" = 'DELIVERY_METHOD' AND "product_packaging_rules"."product_id" IS NULL AND "product_packaging_rules"."delivery_method_id" IS NOT NULL)),
	CONSTRAINT "packaging_rules_valid_combination" CHECK (("product_packaging_rules"."scope" = 'PRODUCT' AND "product_packaging_rules"."consumption_basis" IN ('PER_PRODUCT_UNIT', 'PER_ORDER')) OR ("product_packaging_rules"."scope" = 'DELIVERY_METHOD' AND "product_packaging_rules"."consumption_basis" = 'PER_DELIVERY'))
);
--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owned_product_fk" FOREIGN KEY ("owner_id","product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owned_delivery_method_fk" FOREIGN KEY ("owner_id","delivery_method_id") REFERENCES "public"."delivery_methods"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ADD CONSTRAINT "packaging_rules_owned_inventory_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_methods_owner_id_idx" ON "delivery_methods" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "packaging_rules_owner_id_idx" ON "product_packaging_rules" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "delivery_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_packaging_rules" ENABLE ROW LEVEL SECURITY;
