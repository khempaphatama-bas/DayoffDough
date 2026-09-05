CREATE TABLE "cycle_inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"price_snapshot_id" uuid NOT NULL,
	"inventory_item_name" varchar(160) NOT NULL,
	"inventory_category" "inventory_category" NOT NULL,
	"base_unit" varchar(16) NOT NULL,
	"required_quantity" numeric(18, 6) NOT NULL,
	"system_balance_before_count" numeric(18, 6) NOT NULL,
	"counted_quantity" numeric(18, 6) NOT NULL,
	"count_delta_quantity" numeric(18, 6) NOT NULL,
	"purchase_unit_label" varchar(160) NOT NULL,
	"base_quantity_per_purchase_pack" numeric(18, 6) NOT NULL,
	"count_movement_id" uuid NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"confirmation_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_inventory_counts_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_inventory_counts_owner_snapshot_item_unique" UNIQUE("owner_id","planning_snapshot_id","inventory_item_id"),
	CONSTRAINT "cycle_inventory_counts_owner_cycle_snapshot_item_id_unique" UNIQUE("owner_id","bake_cycle_id","planning_snapshot_id","inventory_item_id","id"),
	CONSTRAINT "cycle_inventory_counts_required_category" CHECK ("cycle_inventory_counts"."inventory_category" IN ('INGREDIENT', 'PACKAGING')),
	CONSTRAINT "cycle_inventory_counts_quantities_valid" CHECK ("cycle_inventory_counts"."required_quantity" > 0 AND "cycle_inventory_counts"."system_balance_before_count" >= 0 AND "cycle_inventory_counts"."counted_quantity" >= 0 AND "cycle_inventory_counts"."base_quantity_per_purchase_pack" > 0),
	CONSTRAINT "cycle_inventory_counts_delta_matches" CHECK ("cycle_inventory_counts"."count_delta_quantity" = "cycle_inventory_counts"."counted_quantity" - "cycle_inventory_counts"."system_balance_before_count")
);
--> statement-breakpoint
ALTER TABLE "cycle_inventory_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_purchase_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"shopping_item_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"pack_count" integer NOT NULL,
	"pack_base_quantity" numeric(18, 6) NOT NULL,
	"purchased_quantity" numeric(18, 6) NOT NULL,
	"total_price_satang" integer NOT NULL,
	"purchased_from" varchar(200),
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"inventory_movement_id" uuid NOT NULL,
	"inventory_price_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_purchase_entries_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_purchase_entries_owner_request_unique" UNIQUE("owner_id","purchase_request_id"),
	CONSTRAINT "cycle_purchase_entries_owner_movement_unique" UNIQUE("owner_id","inventory_movement_id"),
	CONSTRAINT "cycle_purchase_entries_owner_price_unique" UNIQUE("owner_id","inventory_price_id"),
	CONSTRAINT "cycle_purchase_entries_quantities_valid" CHECK ("cycle_purchase_entries"."pack_count" > 0 AND "cycle_purchase_entries"."pack_base_quantity" > 0 AND "cycle_purchase_entries"."purchased_quantity" = "cycle_purchase_entries"."pack_count" * "cycle_purchase_entries"."pack_base_quantity"),
	CONSTRAINT "cycle_purchase_entries_total_price_non_negative" CHECK ("cycle_purchase_entries"."total_price_satang" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_purchase_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bake_cycle_id" uuid NOT NULL,
	"planning_snapshot_id" uuid NOT NULL,
	"inventory_count_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"shortfall_quantity" numeric(18, 6) NOT NULL,
	"suggested_pack_count" integer NOT NULL,
	"suggested_purchase_quantity" numeric(18, 6) NOT NULL,
	"estimated_cost_satang" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_shopping_items_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cycle_shopping_items_owner_snapshot_item_unique" UNIQUE("owner_id","planning_snapshot_id","inventory_item_id"),
	CONSTRAINT "cycle_shopping_items_owner_cycle_snapshot_item_id_unique" UNIQUE("owner_id","bake_cycle_id","planning_snapshot_id","inventory_item_id","id"),
	CONSTRAINT "cycle_shopping_items_quantities_valid" CHECK ("cycle_shopping_items"."shortfall_quantity" > 0 AND "cycle_shopping_items"."suggested_pack_count" > 0 AND "cycle_shopping_items"."suggested_purchase_quantity" > 0 AND "cycle_shopping_items"."suggested_purchase_quantity" >= "cycle_shopping_items"."shortfall_quantity"),
	CONSTRAINT "cycle_shopping_items_estimated_cost_non_negative" CHECK ("cycle_shopping_items"."estimated_cost_satang" IS NULL OR "cycle_shopping_items"."estimated_cost_satang" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_shopping_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_owner_id_id_unique" UNIQUE("owner_id","id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_owner_item_id_unique" UNIQUE("owner_id","inventory_item_id","id");--> statement-breakpoint
ALTER TABLE "cycle_inventory_counts" ADD CONSTRAINT "cycle_inventory_counts_owned_cycle_fk" FOREIGN KEY ("owner_id","bake_cycle_id") REFERENCES "public"."bake_cycles"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_counts" ADD CONSTRAINT "cycle_inventory_counts_owned_snapshot_fk" FOREIGN KEY ("owner_id","bake_cycle_id","planning_snapshot_id") REFERENCES "public"."cycle_planning_snapshots"("owner_id","bake_cycle_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_counts" ADD CONSTRAINT "cycle_inventory_counts_owned_price_snapshot_fk" FOREIGN KEY ("owner_id","planning_snapshot_id","inventory_item_id","price_snapshot_id") REFERENCES "public"."cycle_inventory_price_snapshots"("owner_id","planning_snapshot_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_counts" ADD CONSTRAINT "cycle_inventory_counts_owned_inventory_item_fk" FOREIGN KEY ("owner_id","inventory_item_id") REFERENCES "public"."inventory_items"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_inventory_counts" ADD CONSTRAINT "cycle_inventory_counts_owned_movement_fk" FOREIGN KEY ("owner_id","inventory_item_id","count_movement_id") REFERENCES "public"."inventory_movements"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_purchase_entries" ADD CONSTRAINT "cycle_purchase_entries_owned_shopping_item_fk" FOREIGN KEY ("owner_id","bake_cycle_id","planning_snapshot_id","inventory_item_id","shopping_item_id") REFERENCES "public"."cycle_shopping_items"("owner_id","bake_cycle_id","planning_snapshot_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_purchase_entries" ADD CONSTRAINT "cycle_purchase_entries_owned_movement_fk" FOREIGN KEY ("owner_id","inventory_item_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_purchase_entries" ADD CONSTRAINT "cycle_purchase_entries_owned_price_fk" FOREIGN KEY ("owner_id","inventory_item_id","inventory_price_id") REFERENCES "public"."inventory_prices"("owner_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_shopping_items" ADD CONSTRAINT "cycle_shopping_items_owned_count_fk" FOREIGN KEY ("owner_id","bake_cycle_id","planning_snapshot_id","inventory_item_id","inventory_count_id") REFERENCES "public"."cycle_inventory_counts"("owner_id","bake_cycle_id","planning_snapshot_id","inventory_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_inventory_counts_owner_cycle_snapshot_idx" ON "cycle_inventory_counts" USING btree ("owner_id","bake_cycle_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_purchase_entries_owner_cycle_snapshot_idx" ON "cycle_purchase_entries" USING btree ("owner_id","bake_cycle_id","planning_snapshot_id");--> statement-breakpoint
CREATE INDEX "cycle_purchase_entries_owner_shopping_occurred_idx" ON "cycle_purchase_entries" USING btree ("owner_id","shopping_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cycle_shopping_items_owner_cycle_snapshot_idx" ON "cycle_shopping_items" USING btree ("owner_id","bake_cycle_id","planning_snapshot_id");
