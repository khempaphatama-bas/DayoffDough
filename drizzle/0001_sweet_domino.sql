CREATE TYPE "public"."inventory_category" AS ENUM('INGREDIENT', 'PACKAGING', 'CONSUMABLE');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('COUNT', 'PURCHASE', 'CONSUMPTION', 'CORRECTION');--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" "inventory_category" NOT NULL,
	"base_unit" varchar(16) NOT NULL,
	"purchase_unit_label" varchar(160) NOT NULL,
	"base_quantity_per_purchase_pack" numeric(18, 6) NOT NULL,
	"minimum_stock_quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_owner_name_unique" UNIQUE("owner_id","name"),
	CONSTRAINT "inventory_items_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "inventory_items_pack_quantity_positive" CHECK ("inventory_items"."base_quantity_per_purchase_pack" > 0),
	CONSTRAINT "inventory_items_minimum_stock_non_negative" CHECK ("inventory_items"."minimum_stock_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"type" "inventory_movement_type" NOT NULL,
	"quantity_delta_in_base_unit" numeric(18, 6) NOT NULL,
	"counted_quantity_in_base_unit" numeric(18, 6),
	"reference_type" varchar(80),
	"reference_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_count_requires_quantity" CHECK ("inventory_movements"."type" <> 'COUNT' OR "inventory_movements"."counted_quantity_in_base_unit" IS NOT NULL),
	CONSTRAINT "inventory_movements_count_non_negative" CHECK ("inventory_movements"."counted_quantity_in_base_unit" IS NULL OR "inventory_movements"."counted_quantity_in_base_unit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"pack_price_satang" integer NOT NULL,
	"pack_base_quantity" numeric(18, 6) NOT NULL,
	"purchased_from" varchar(200),
	"effective_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_prices_pack_price_non_negative" CHECK ("inventory_prices"."pack_price_satang" >= 0),
	CONSTRAINT "inventory_prices_pack_quantity_positive" CHECK ("inventory_prices"."pack_base_quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_owned_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prices" ADD CONSTRAINT "inventory_prices_owned_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_owner_id_idx" ON "inventory_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_owner_item_occurred_idx" ON "inventory_movements" USING btree ("owner_id","inventory_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_prices_owner_item_effective_idx" ON "inventory_prices" USING btree ("owner_id","inventory_item_id","effective_at");--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
