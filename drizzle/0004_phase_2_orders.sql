CREATE TYPE "public"."bake_cycle_status" AS ENUM('DRAFT', 'OPEN', 'LOCKED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."delivery_fee_payer" AS ENUM('CUSTOMER', 'BAKERY', 'SHARED');--> statement-breakpoint
CREATE TYPE "public"."order_fulfillment_status" AS ENUM('NEW', 'CONFIRMED', 'IN_PRODUCTION', 'PACKED', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."order_source_channel" AS ENUM('INSTAGRAM', 'FACEBOOK', 'PHONE', 'OTHER');--> statement-breakpoint
CREATE TABLE "bake_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"cycle_number" serial NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" "bake_cycle_status" DEFAULT 'OPEN' NOT NULL,
	"order_cutoff_at" timestamp with time zone,
	"target_production_date" date NOT NULL,
	"primary_delivery_date" date NOT NULL,
	"notes" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bake_cycles_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "bake_cycles_cycle_number_unique" UNIQUE("cycle_number")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"contact_handle" varchar(200),
	"phone" varchar(200),
	"default_delivery_method_id" uuid,
	"default_delivery_location" varchar(2000),
	"default_delivery_note" varchar(2000),
	"notes" varchar(2000),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_owner_id_id_unique" UNIQUE("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_satang" integer NOT NULL,
	"line_note" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_non_negative" CHECK ("order_items"."unit_price_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"source_channel" "order_source_channel",
	"requested_delivery_date" date,
	"confirmed_delivery_date" date,
	"delivery_method_id" uuid,
	"delivery_fee_charged_satang" integer DEFAULT 0 NOT NULL,
	"delivery_cost_satang" integer DEFAULT 0 NOT NULL,
	"delivery_fee_payer" "delivery_fee_payer" DEFAULT 'CUSTOMER' NOT NULL,
	"discount_satang" integer DEFAULT 0 NOT NULL,
	"amount_paid_satang" integer DEFAULT 0 NOT NULL,
	"delivery_location" varchar(2000),
	"delivery_note" varchar(2000),
	"special_instructions" varchar(2000),
	"payment_status" "order_payment_status" DEFAULT 'UNPAID' NOT NULL,
	"fulfillment_status" "order_fulfillment_status" DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "orders_delivery_fee_non_negative" CHECK ("orders"."delivery_fee_charged_satang" >= 0),
	CONSTRAINT "orders_delivery_cost_non_negative" CHECK ("orders"."delivery_cost_satang" >= 0),
	CONSTRAINT "orders_discount_non_negative" CHECK ("orders"."discount_satang" >= 0),
	CONSTRAINT "orders_amount_paid_non_negative" CHECK ("orders"."amount_paid_satang" >= 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_methods" ADD COLUMN "requires_delivery_location" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owned_default_delivery_method_fk" FOREIGN KEY ("owner_id","default_delivery_method_id") REFERENCES "public"."delivery_methods"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_owned_order_fk" FOREIGN KEY ("owner_id","order_id") REFERENCES "public"."orders"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_owned_product_fk" FOREIGN KEY ("owner_id","product_id") REFERENCES "public"."products"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owned_customer_fk" FOREIGN KEY ("owner_id","customer_id") REFERENCES "public"."customers"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owned_bake_cycle_fk" FOREIGN KEY ("owner_id","bake_cycle_id") REFERENCES "public"."bake_cycles"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owned_delivery_method_fk" FOREIGN KEY ("owner_id","delivery_method_id") REFERENCES "public"."delivery_methods"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bake_cycles_owner_status_delivery_idx" ON "bake_cycles" USING btree ("owner_id","status","primary_delivery_date");--> statement-breakpoint
CREATE INDEX "bake_cycles_owner_status_production_idx" ON "bake_cycles" USING btree ("owner_id","status","target_production_date");--> statement-breakpoint
CREATE INDEX "customers_owner_name_idx" ON "customers" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "order_items_owner_order_idx" ON "order_items" USING btree ("owner_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_owner_cycle_created_idx" ON "orders" USING btree ("owner_id","bake_cycle_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_owner_customer_created_idx" ON "orders" USING btree ("owner_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_owner_payment_fulfillment_idx" ON "orders" USING btree ("owner_id","payment_status","fulfillment_status");--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bake_cycles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
