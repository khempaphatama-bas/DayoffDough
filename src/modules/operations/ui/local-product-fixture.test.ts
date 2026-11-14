// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import postgres from "postgres";
import { deactivateLocalUnusedProduct, prepareLocalEmptyRecipe } from "@tests/helpers/local-product-fixture";

vi.mock("postgres", () => ({ default: vi.fn(() => ({ end: vi.fn() })) }));
afterEach(() => vi.clearAllMocks());

const fixture = {
  ownerId: "91000000-0000-4000-8000-000000000001",
  productId: "92000000-0000-4000-8000-000000000001",
  name: "Focaccia rosemary and olive oil with roasted garlic and cherry tomatoes family size operations-phone-1790000000000",
};
const safe = {
  E2E_ISOLATED_LOCAL_DATABASE: "1",
  E2E_LOCAL_DATABASE_PORT: "62289",
  SUPABASE_DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:62289/postgres",
};

it.each([
  { label: "missing opt-in", environment: { ...safe, E2E_ISOLATED_LOCAL_DATABASE: "" } },
  { label: "missing URL", environment: { ...safe, SUPABASE_DATABASE_URL: "" } },
  { label: "remote host", environment: { ...safe, SUPABASE_DATABASE_URL: "postgres://fixture:fixture@shop.example:62289/postgres" } },
  { label: "ambiguous localhost", environment: { ...safe, SUPABASE_DATABASE_URL: "postgres://fixture:fixture@localhost:62289/postgres" } },
  { label: "missing port", environment: { ...safe, SUPABASE_DATABASE_URL: "postgres://fixture:fixture@127.0.0.1/postgres" } },
  { label: "unstated port", environment: { ...safe, E2E_LOCAL_DATABASE_PORT: "" } },
  { label: "mismatched port", environment: { ...safe, E2E_LOCAL_DATABASE_PORT: "5433" } },
  { label: "wrong protocol", environment: { ...safe, SUPABASE_DATABASE_URL: "https://127.0.0.1:62289/postgres" } },
  { label: "URL query overrides", environment: { ...safe, SUPABASE_DATABASE_URL: `${safe.SUPABASE_DATABASE_URL}?host=shop.example` } },
])("refuses $label before opening any database connection", async ({ environment }) => {
  await expect(deactivateLocalUnusedProduct(fixture, environment)).rejects.toThrow();
  expect(postgres).not.toHaveBeenCalled();
});

const emptyFixture = { ownerId: fixture.ownerId, productId: fixture.productId,
  name: "consumption-empty-phone-1790000000000", versionCode: "consumption-empty-phone-1790000000000" };

it.each([
  { ...safe, E2E_ISOLATED_LOCAL_DATABASE: "" },
  { ...safe, E2E_LOCAL_DATABASE_PORT: "" },
  { ...safe, E2E_LOCAL_DATABASE_PORT: "5432" },
  { ...safe, SUPABASE_DATABASE_URL: "postgres://fixture@shop.example:62289/postgres" },
  { ...safe, SUPABASE_DATABASE_URL: `${safe.SUPABASE_DATABASE_URL}?host=shop.example` },
])("refuses empty-master preparation on unsafe target before connecting: %j", async environment => {
  await expect(prepareLocalEmptyRecipe(emptyFixture, environment)).rejects.toThrow();
  expect(postgres).not.toHaveBeenCalled();
});

it.each([
  { ...emptyFixture, ownerId: "unverified" },
  { ...emptyFixture, name: "another-product" },
  { ...emptyFixture, versionCode: "different-version" },
])("refuses non-exact empty fixture identity before connecting: %j", async invalid => {
  await expect(prepareLocalEmptyRecipe(invalid, safe)).rejects.toThrow();
  expect(postgres).not.toHaveBeenCalled();
});

function emptyConnection(change: "safe" | "foreign" | "inactive" | "version" | "references" | "packaging" | "ingredients") {
  const statements: string[] = [];
  const transaction = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("FROM products")) return change === "foreign" ? [] : [{ active: change !== "inactive", active_recipe_version_id: "93000000-0000-4000-8000-000000000001" }];
    if (statement.includes("FROM recipes")) return [{ id: "94000000-0000-4000-8000-000000000001", name: `${emptyFixture.name} recipe` }];
    if (statement.includes("FROM recipe_versions")) return [{ id: "93000000-0000-4000-8000-000000000001", version_code: change === "version" ? "unexpected" : emptyFixture.versionCode }];
    if (statement.includes("AS used")) return [{ used: change === "references", packaging: change === "packaging" }];
    if (statement.includes("SELECT id FROM recipe_ingredients")) return change === "ingredients" ? [] : [{ id: "95000000-0000-4000-8000-000000000001" }];
    if (statement.includes("DELETE FROM recipe_ingredients")) {
      expect(values).toEqual([emptyFixture.ownerId, "93000000-0000-4000-8000-000000000001", "95000000-0000-4000-8000-000000000001"]);
      return [{ id: "95000000-0000-4000-8000-000000000001" }];
    }
    throw new Error("Unexpected empty-fixture SQL");
  };
  const connection = { begin: async (callback: (query: typeof transaction) => Promise<void>) => callback(transaction), end: vi.fn() };
  vi.mocked(postgres).mockReturnValue(connection as unknown as ReturnType<typeof postgres>);
  return { statements, connection };
}

it.each(["foreign", "inactive", "version", "references", "packaging", "ingredients"] as const)(
  "refuses %s empty-master preconditions before deleting any ingredient", async change => {
    const { statements, connection } = emptyConnection(change);
    await expect(prepareLocalEmptyRecipe(emptyFixture, safe)).rejects.toThrow();
    expect(statements.some(statement => statement.includes("DELETE"))).toBe(false);
    expect(connection.end).toHaveBeenCalledOnce();
  },
);

it("removes only the exact new owned recipe ingredient before any references exist", async () => {
  const { statements, connection } = emptyConnection("safe");
  await expect(prepareLocalEmptyRecipe(emptyFixture, safe)).resolves.toBeUndefined();
  expect(statements.filter(statement => statement.includes("DELETE"))).toHaveLength(1);
  expect(connection.end).toHaveBeenCalledOnce();
});

function fixtureConnection(versioned: boolean) {
  const statements: string[] = [];
  const transaction = async (strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("SELECT active")) return [{ active: true, active_recipe_version_id: null }];
    if (statement.includes("SELECT name FROM recipes")) return [{ name: `${fixture.name} recipe` }];
    if (statement.includes("AS used")) return [{ used: versioned && statement.includes("recipe_versions") }];
    if (statement.includes("UPDATE products")) return [{ id: fixture.productId }];
    throw new Error("Unexpected fixture SQL");
  };
  const connection = { begin: async (callback: (query: typeof transaction) => Promise<void>) => callback(transaction), end: vi.fn() };
  vi.mocked(postgres).mockReturnValue(connection as unknown as ReturnType<typeof postgres>);
  return { statements, connection };
}

it("allows only the exact unused UI-created empty recipe scaffold", async () => {
  const { statements, connection } = fixtureConnection(false);

  await deactivateLocalUnusedProduct(fixture, safe);

  expect(statements.filter(statement => statement.includes("UPDATE products"))).toHaveLength(1);
  expect(connection.end).toHaveBeenCalledOnce();
});

it("refuses a versioned recipe before deactivating the Product", async () => {
  const { statements, connection } = fixtureConnection(true);

  await expect(deactivateLocalUnusedProduct(fixture, safe)).rejects.toThrow("referenced");

  expect(statements.some(statement => statement.includes("UPDATE products"))).toBe(false);
  expect(connection.end).toHaveBeenCalledOnce();
});

it.each([
  { ...fixture, ownerId: "not-verified-uuid" },
  { ...fixture, productId: "not-a-uuid" },
  { ...fixture, name: "not-the-exact-e2e-fixture" },
])("refuses unsafe fixture identity before connecting: %j", async (invalid) => {
  await expect(deactivateLocalUnusedProduct(invalid, safe)).rejects.toThrow();
  expect(postgres).not.toHaveBeenCalled();
});
