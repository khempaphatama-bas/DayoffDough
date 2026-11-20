import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { applicationModules, ordered, validatedAdminUrl, withDatabase } from "../helpers/recipe-inventory-postgres.mjs";

validatedAdminUrl(process.env.RECIPE_INVENTORY_LOCAL_PG_ADMIN_URL);
const planningPath = "src/modules/planning/application/planning-commands.ts";
const productPath = "src/modules/products/application/products.ts";
const control = process.env.RECIPE_INVENTORY_PG_CONTROL;
assert.ok(control === undefined || control === "omit-recipe-create-product-lock", "Unknown disposable negative control");
const modules = await applicationModules((source, code) => {
  if (!control || source !== productPath) return code;
  const guard = "const [product] = await lockOwnedProducts(tx, ownerId, [productId]);";
  assert.ok(code.includes(guard), "Negative control guard not found in compiled output");
  // The first occurrence is createRecipeVersion. Keep the owned product read
  // and all later writes, but remove its row lock in generated JS only.
  return code.replace(guard, "const [product] = await tx.select().from(products).where(and(eq(products.ownerId, ownerId), eq(products.id, productId))).limit(1);");
});
after(modules.close);
const { createInventoryService: inventory } = await modules.load("src/modules/inventory/application/inventory.ts");
const { createProductService: products } = await modules.load(productPath);
const { createPlanningCommandService: planning } = await modules.load(planningPath);
const { createPlanningQueryService: queries } = await modules.load("src/modules/planning/application/planning-queries.ts");
const { OWNER_ID: owner } = await modules.load("tests/fixtures/owner.ts");
const { seedPlanningScenario } = await modules.load("tests/fixtures/planning.ts");
const clock = { now: () => new Date("2026-08-23T03:00:00.000Z") };

const itemForm = (name, baseUnit = "g", baseQuantityPerPurchasePack = "1000") => ({
  name, category: "INGREDIENT", baseUnit, purchaseUnitLabel: "bag", baseQuantityPerPurchasePack, minimumStockQuantity: "0",
});
const date = new Date("2026-08-24T00:00:00Z");
const createItem = (db, name) => inventory(db).createItem(owner, itemForm(name));
const createProduct = db => products(db).createProduct(owner, { name: "Race loaf", sellingUnit: "piece", defaultUnitPriceSatang: 10000 });
const version = (db, productId, code, itemId) => products(db).createRecipeVersion(owner, productId, {
  versionCode: code, baseYieldQuantity: "6", yieldUnit: "piece", laborMinutesPerBatch: 2,
  utilityCostSatangPerBatch: 25, wasteAllowancePercent: "0", instructions: "Mix and bake",
  ingredients: [{ inventoryItemId: itemId, quantityInBaseUnit: "20", expectedIdentity: { baseUnit: "g", ingredientKind: "STANDARD" } }],
});
const activate = (db, productId, versionId) => products(db).activateRecipeVersion(owner, productId, versionId);
const archive = (db, itemId) => inventory(db).archiveItem(owner, itemId);
const archiveVersion = (db, productId, versionId) => products(db).archiveRecipeVersion(owner, productId, versionId);
const detail = (h, productId) => products(h.db).getProductDetail(owner, productId);
const race = (name, run) => test(name, { timeout: 60_000 }, () => withDatabase(run));

function activeVersion(product) {
  const active = product.versions.find(row => row.id === product.activeRecipeVersionId);
  assert.ok(active);
  assert.equal(active.archivedAt, null);
  return active;
}

race("concurrent_create_6_7_and_archive_vs_activate: sixth and seventh writes retain five selectable", async h => {
  const product = await createProduct(h.db);
  const [shared, sixth, seventh] = await Promise.all(["Flour", "Rye", "Oats"].map(name => createItem(h.db, name)));
  for (let n = 1; n <= 5; n++) {
    const v = await version(h.db, product.id, `v${n}`, shared.id);
    // Set deterministic fixture chronology without generation sleeps.
    await h.setup`UPDATE recipe_versions SET created_at = ${`2026-08-0${n}T00:00:00Z`}::timestamptz WHERE id = ${v.id}`;
    if (n === 1) await activate(h.db, product.id, v.id);
  }
  const [a, b] = await ordered(h, "create6->create7",
    db => version(db, product.id, "v6", sixth.id), db => version(db, product.id, "v7", seventh.id), async () => {
      assert.equal((await detail(h, product.id)).versions.length, 5);
    });
  assert.ifError(b.error);
  const saved = await detail(h, product.id);
  const selectable = saved.versions.filter(row => row.archivedAt === null);
  assert.equal(selectable.length, 5);
  assert.deepEqual(a.archivedVersions.map(row => row.versionCode), ["v2"]);
  assert.deepEqual(b.value.archivedVersions.map(row => row.versionCode), ["v3"]);
  assert.equal(activeVersion(saved).versionCode, "v1");
  assert.deepEqual(selectable.map(row => row.versionCode).sort(), ["v1", "v4", "v5", "v6", "v7"]);
  assert.deepEqual(saved.versions.filter(row => row.archivedAt).map(row => row.versionCode).sort(), ["v2", "v3"]);
});

for (const archiveFirst of [true, false]) race(`concurrent_create_6_7_and_archive_vs_activate: version ${archiveFirst ? "archive" : "activate"} wins`, async h => {
  const product = await createProduct(h.db);
  const item = await createItem(h.db, "Flour");
  const current = await version(h.db, product.id, "current", item.id);
  const next = await version(h.db, product.id, "next", item.id);
  await activate(h.db, product.id, current.id);
  const remove = db => archiveVersion(db, product.id, next.id);
  const choose = db => activate(db, product.id, next.id);
  const [, loser] = await ordered(h, archiveFirst ? "archive-version->activate" : "activate->archive-version",
    archiveFirst ? remove : choose, archiveFirst ? choose : remove);
  assert.equal(loser.error?.code, archiveFirst ? "ARCHIVED_VERSION" : "ACTIVE_VERSION");
  const saved = await detail(h, product.id);
  assert.equal(activeVersion(saved).id, archiveFirst ? current.id : next.id);
  assert.equal(Boolean(saved.versions.find(row => row.id === next.id).archivedAt), archiveFirst);
});

async function planningRace(h) {
  const fixture = await seedPlanningScenario(h.db);
  const preview = await queries(h.db, clock).preview(owner, fixture.cycleId);
  assert.deepEqual(preview.blockers, []);
  const lock = db => planning(db, clock).lock(owner, {
    cycleId: fixture.cycleId, inputFingerprint: preview.inputFingerprint, lockRequestId: randomUUID(), overrides: [],
  });
  const cycle = async () => {
    const [row] = await h.observe`SELECT status, active_planning_snapshot_id AS snapshot,
      (SELECT count(*)::int FROM cycle_planning_snapshots WHERE bake_cycle_id = ${fixture.cycleId}) AS generations
      FROM bake_cycles WHERE id = ${fixture.cycleId}`;
    return row;
  };
  return { ...fixture, lock, cycle };
}

for (const packFirst of [true, false]) race(`master_data_writes_vs_planning_lock: ${packFirst ? "pack edit" : "planning lock"} wins`, async h => {
  const { ingredientItemId, lock, cycle } = await planningRace(h);
  const pack = db => inventory(db).updateItem(owner, ingredientItemId, itemForm("แป้งขนมปัง", "g", "1500"));
  const [winner, loser] = await ordered(h, packFirst ? "pack->planning" : "planning->pack",
    packFirst ? pack : lock, packFirst ? lock : pack, async () => {
      assert.deepEqual(await cycle(), { status: "OPEN", snapshot: null, generations: 0 });
    });
  const item = await inventory(h.db).getItemDetail(owner, ingredientItemId);
  if (packFirst) {
    assert.equal(loser.error?.name, "PlanningStaleError");
    assert.deepEqual(await cycle(), { status: "OPEN", snapshot: null, generations: 0 });
    assert.equal(item.baseQuantityPerPurchasePack, "1500");
  } else {
    assert.equal(loser.error?.code, "PACK_IN_USE");
    assert.deepEqual(await cycle(), { status: "LOCKED", snapshot: winner.id, generations: 1 });
    assert.equal(item.baseQuantityPerPurchasePack, "1000");
  }
});

for (const archiveFirst of [true, false]) race(`master_data_writes_vs_planning_lock: ${archiveFirst ? "swap and disable" : "planning lock before swap and disable"} wins`, async h => {
  const { productId, ingredientItemId, lock, cycle } = await planningRace(h);
  const replacement = await createItem(h.db, "Replacement flour");
  const candidate = await version(h.db, productId, "replacement", replacement.id);
  const swap = db => activate(db, productId, candidate.id);
  if (archiveFirst) {
    // Both real commands commit together while planning's repeatable-read
    // snapshot still sees the old assignment. The planner blocks on product.
    const [, loser] = await ordered(h, "swap+disable->planning", db => db.transaction(async tx => {
      await swap(tx);
      await archive(tx, ingredientItemId);
    }), lock);
    assert.equal(loser.error?.name, "PlanningStaleError");
    assert.deepEqual(await cycle(), { status: "OPEN", snapshot: null, generations: 0 });
  } else {
    const [snapshot, swapped] = await ordered(h, "planning->swap", lock, swap);
    assert.ifError(swapped.error);
    await assert.rejects(archive(h.secondDb, ingredientItemId), { code: "ACTIVE_PLAN" });
    assert.deepEqual(await cycle(), { status: "LOCKED", snapshot: snapshot.id, generations: 1 });
    const [{ n }] = await h.observe`SELECT count(*)::int AS n FROM cycle_material_requirements
      WHERE planning_snapshot_id = ${snapshot.id} AND inventory_item_id = ${ingredientItemId}`;
    assert.equal(n, 1);
  }
  assert.equal(activeVersion(await detail(h, productId)).id, candidate.id);
  assert.equal((await inventory(h.db).getItemDetail(owner, ingredientItemId)).active, !archiveFirst);
});

for (const archiveFirst of [true, false]) race(`archive_vs_activate_and_unit_change_vs_first_reference: item ${archiveFirst ? "disable" : "activate referencing recipe"} wins`, async h => {
  const item = await createItem(h.db, "Flour");
  const product = await createProduct(h.db);
  const v = await version(h.db, product.id, "untested", item.id);
  const remove = db => archive(db, item.id);
  const choose = db => activate(db, product.id, v.id);
  const [, loser] = await ordered(h, archiveFirst ? "disable-item->activate" : "activate->disable-item",
    archiveFirst ? remove : choose, archiveFirst ? choose : remove);
  assert.equal(loser.error?.code, archiveFirst ? "ITEM_UNAVAILABLE" : "ACTIVE_RECIPE");
  const saved = await detail(h, product.id);
  assert.equal(saved.activeRecipeVersionId, archiveFirst ? null : v.id);
  assert.equal(saved.versions.find(row => row.id === v.id).ingredients[0].itemActive, !archiveFirst);
});

for (const reference of ["price", "count", "recipe"]) for (const editFirst of [true, false]) {
  race(`archive_vs_activate_and_unit_change_vs_first_reference: ${editFirst ? "unit edit" : `first ${reference}`} wins against ${editFirst ? `stale ${reference} form` : "unit edit"}`, async h => {
    const item = await createItem(h.db, "Flour");
    const product = await createProduct(h.db);
    const edit = db => inventory(db).updateItem(owner, item.id, itemForm(item.name, "kg", "1"));
    const use = {
      price: db => inventory(db).addPrice(owner, item.id, { packPriceSatang: 5000, packBaseQuantity: "1000", effectiveAt: date, expectedBaseUnit: "g" }),
      count: db => inventory(db).recordCount(owner, item.id, "20", date, "g"),
      recipe: db => version(db, product.id, "first", item.id),
    }[reference];
    const [, loser] = await ordered(h, editFirst ? `unit->${reference}` : `${reference}->unit`,
      editFirst ? edit : use, editFirst ? use : edit);
    assert.equal(loser.error?.code, editFirst ? "ITEM_CHANGED" : "IDENTITY_IN_USE");
    const saved = await inventory(h.db).getItemDetail(owner, item.id, date);
    assert.equal(saved.baseUnit, editFirst ? "kg" : "g");
    assert.equal(saved.baseQuantityPerPurchasePack, editFirst ? "1" : "1000");
    assert.equal(saved.stockBalance, reference === "count" && !editFirst ? "20" : "0");
    assert.deepEqual(saved.priceHistory.map(row => [row.packPriceSatang, row.packBaseQuantity]),
      reference === "price" && !editFirst ? [[5000, "1000"]] : []);
    const recipe = await detail(h, product.id);
    assert.deepEqual(recipe.versions.map(row => [row.versionCode, row.ingredients[0].quantityInBaseUnit]),
      reference === "recipe" && !editFirst ? [["first", "20"]] : []);
  });
}
