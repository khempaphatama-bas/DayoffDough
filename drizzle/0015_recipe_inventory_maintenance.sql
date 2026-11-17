ALTER TABLE "inventory_items" ADD COLUMN "ingredient_kind" varchar(16) DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_prep_only_values" CHECK ("inventory_items"."ingredient_kind" = 'STANDARD' OR (
        "inventory_items"."category" = 'INGREDIENT'
        AND (("inventory_items"."ingredient_kind" = 'WATER' AND "inventory_items"."base_unit" IN ('ml', 'l'))
          OR ("inventory_items"."ingredient_kind" = 'ICE' AND "inventory_items"."base_unit" IN ('g', 'kg')))
        AND "inventory_items"."purchase_unit_label" = 'ไม่ต้องซื้อ'
        AND "inventory_items"."base_quantity_per_purchase_pack" = 1
        AND "inventory_items"."minimum_stock_quantity" = 0
      ));--> statement-breakpoint
-- Keep the active version and the newest remaining versions selectable.
-- Archive only: locked plans and recipe ingredient lineage keep their IDs.
WITH ranked_versions AS (
  SELECT rv.owner_id, rv.recipe_id, rv.id,
    row_number() OVER (
      PARTITION BY rv.owner_id, rv.recipe_id
      ORDER BY (rv.id IS NOT DISTINCT FROM p.active_recipe_version_id) DESC,
        rv.created_at DESC, rv.id DESC
    ) AS selectable_rank
  FROM recipe_versions rv
  JOIN recipes r ON r.owner_id = rv.owner_id AND r.id = rv.recipe_id
  JOIN products p ON p.owner_id = r.owner_id AND p.id = r.product_id
)
UPDATE recipe_versions rv
SET archived_at = statement_timestamp()
FROM ranked_versions ranked
WHERE rv.owner_id = ranked.owner_id AND rv.recipe_id = ranked.recipe_id AND rv.id = ranked.id
  AND ranked.selectable_rank > 5;
