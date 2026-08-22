CREATE TABLE "shop_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"labor_rate_satang_per_hour" integer NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Bangkok' NOT NULL,
	"currency" varchar(3) DEFAULT 'THB' NOT NULL,
	"default_waste_allowance_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_settings_labor_rate_non_negative" CHECK ("shop_settings"."labor_rate_satang_per_hour" >= 0),
	CONSTRAINT "shop_settings_waste_percent_range" CHECK ("shop_settings"."default_waste_allowance_percent" >= 0 AND "shop_settings"."default_waste_allowance_percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "shop_settings" ENABLE ROW LEVEL SECURITY;
