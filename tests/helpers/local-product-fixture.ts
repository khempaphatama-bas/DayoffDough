import postgres from "postgres";
import { z } from "zod";

const identity = z.object({
  ownerId: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string().regex(/^Focaccia rosemary and olive oil with roasted garlic and cherry tomatoes family size operations-(phone|desktop)-\d+$/),
});

export function isolatedLocalFixtureTarget(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // Test-only, explicit local opt-in. Validate BEFORE constructing any client;
  // never infer a target from Auth configuration or fall back to a shop DB.
  if (environment.E2E_ISOLATED_LOCAL_DATABASE !== "1") throw new Error("Local fixture cleanup requires explicit isolated-local opt-in");
  const url = new URL(environment.SUPABASE_DATABASE_URL ?? "");
  const statedPort = environment.E2E_LOCAL_DATABASE_PORT;
  if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1"
    || !statedPort || !/^\d+$/.test(statedPort) || Number(statedPort) < 1
    || Number(statedPort) > 65535 || url.port !== statedPort || url.search || url.hash
    || url.pathname === "/") throw new Error("Unsafe local fixture cleanup target");
  return url.toString();
}

export async function deactivateLocalUnusedProduct(
  fixture: Readonly<{ ownerId: string; productId: string; name: string }>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const target = isolatedLocalFixtureTarget(environment);
  const { ownerId, productId, name } = identity.parse(fixture);
  const sql = postgres(target, { max: 1, connect_timeout: 5 });
  try {
    await sql.begin(async transaction => {
      const rows = await transaction`SELECT active, active_recipe_version_id FROM products
        WHERE owner_id = ${ownerId} AND id = ${productId} AND name = ${name} FOR UPDATE`;
      if (rows.length !== 1 || rows[0]!.active !== true || rows[0]!.active_recipe_version_id !== null) {
        throw new Error("Exact unused active fixture Product not found");
      }
      // UI Product creation always adds this one empty recipe container. It is
      // not a configured recipe: require its exact name and zero versions.
      const scaffolds = await transaction`SELECT name FROM recipes
        WHERE owner_id = ${ownerId} AND product_id = ${productId}`;
      if (scaffolds.length !== 1 || scaffolds[0]!.name !== `${name} recipe`) throw new Error("Unexpected fixture recipe scaffold");
      const [references] = await transaction`SELECT
        EXISTS (SELECT 1 FROM order_items WHERE owner_id = ${ownerId} AND product_id = ${productId})
        OR EXISTS (SELECT 1 FROM recipe_versions version JOIN recipes recipe
          ON recipe.owner_id = version.owner_id AND recipe.id = version.recipe_id
          WHERE recipe.owner_id = ${ownerId} AND recipe.product_id = ${productId})
        OR EXISTS (SELECT 1 FROM production_templates WHERE owner_id = ${ownerId} AND product_id = ${productId})
        OR EXISTS (SELECT 1 FROM cycle_tasks WHERE owner_id = ${ownerId} AND product_id = ${productId}) AS used`;
      if (references!.used) throw new Error("Fixture Product is referenced; cleanup refused");
      const changed = await transaction`UPDATE products SET active = false
        WHERE owner_id = ${ownerId} AND id = ${productId} AND name = ${name} AND active = true RETURNING id`;
      if (changed.length !== 1) throw new Error("Exact fixture Product deactivation failed");
    });
  } finally {
    await sql.end();
  }
}

const emptyIdentity = z.object({
  ownerId: z.string().uuid(), productId: z.string().uuid(),
  name: z.string().regex(/^consumption-empty-(phone|desktop)-\d+$/),
  versionCode: z.string(),
}).refine(value => value.name === value.versionCode, "Exact empty fixture version required");

// Sole R45 precondition exception: the UI cannot create an ingredient-free recipe.
// The caller obtains ownerId through verifiedOwnerId(Auth), after UI creation and
// before any Order/plan. Never edit snapshots, ledger, triggers or other masters.
export async function prepareLocalEmptyRecipe(
  fixture: Readonly<{ ownerId: string; productId: string; name: string; versionCode: string }>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const target = isolatedLocalFixtureTarget(environment);
  const { ownerId, productId, name, versionCode } = emptyIdentity.parse(fixture);
  const sql = postgres(target, { max: 1, connect_timeout: 5 });
  try {
    await sql.begin(async transaction => {
      const product = await transaction`SELECT active, active_recipe_version_id FROM products
        WHERE owner_id = ${ownerId} AND id = ${productId} AND name = ${name} FOR UPDATE`;
      if (product.length !== 1 || product[0]!.active !== true || !product[0]!.active_recipe_version_id) throw new Error("Exact active empty fixture Product not found");
      const recipe = await transaction`SELECT id, name FROM recipes
        WHERE owner_id = ${ownerId} AND product_id = ${productId} FOR UPDATE`;
      if (recipe.length !== 1 || recipe[0]!.name !== `${name} recipe`) throw new Error("Unexpected empty fixture recipe");
      const versions = await transaction`SELECT id, version_code FROM recipe_versions
        WHERE owner_id = ${ownerId} AND recipe_id = ${recipe[0]!.id} FOR UPDATE`;
      if (versions.length !== 1 || versions[0]!.version_code !== versionCode
        || versions[0]!.id !== product[0]!.active_recipe_version_id) throw new Error("Unexpected empty fixture version");
      const versionId = versions[0]!.id;
      const [references] = await transaction`SELECT
        EXISTS (SELECT 1 FROM order_items WHERE owner_id = ${ownerId} AND product_id = ${productId})
        OR EXISTS (SELECT 1 FROM cycle_recipe_plans WHERE owner_id = ${ownerId} AND source_recipe_version_id = ${versionId})
        OR EXISTS (SELECT 1 FROM cycle_product_plans WHERE owner_id = ${ownerId} AND source_product_id = ${productId})
        OR EXISTS (SELECT 1 FROM cycle_order_item_snapshots WHERE owner_id = ${ownerId} AND source_product_id = ${productId})
        OR EXISTS (SELECT 1 FROM cycle_material_requirements WHERE owner_id = ${ownerId} AND source_recipe_version_id = ${versionId})
        OR EXISTS (SELECT 1 FROM cycle_consumption_contexts context JOIN cycle_recipe_plans plan
          ON plan.owner_id = context.owner_id AND plan.planning_snapshot_id = context.planning_snapshot_id
          WHERE context.owner_id = ${ownerId} AND plan.source_recipe_version_id = ${versionId}) AS used,
        EXISTS (SELECT 1 FROM product_packaging_rules WHERE owner_id = ${ownerId}
          AND (product_id = ${productId} OR scope = 'DELIVERY_METHOD')) AS packaging`;
      if (!references || references.used || references.packaging) throw new Error("Empty fixture is referenced or has shared packaging");
      const ingredients = await transaction`SELECT id FROM recipe_ingredients
        WHERE owner_id = ${ownerId} AND recipe_version_id = ${versionId} FOR UPDATE`;
      if (ingredients.length !== 1) throw new Error("Unexpected empty fixture ingredient set");
      const removed = await transaction`DELETE FROM recipe_ingredients
        WHERE owner_id = ${ownerId} AND recipe_version_id = ${versionId} AND id = ${ingredients[0]!.id} RETURNING id`;
      if (removed.length !== 1) throw new Error("Exact empty fixture ingredient removal failed");
    });
  } finally { await sql.end(); }
}
