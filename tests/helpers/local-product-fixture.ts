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
