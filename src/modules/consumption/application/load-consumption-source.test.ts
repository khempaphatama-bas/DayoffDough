import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID, OTHER_OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { inventoryItems, inventoryPrices } from "@/modules/inventory/db/schema";
import { recipeIngredients } from "@/modules/products/db/schema";
import { cycleTasks } from "@/modules/production/db/schema";
import { cycleInventoryPriceSnapshots, cycleMaterialRequirements, cyclePackagingRequirements } from "@/modules/planning/db/schema";
import { loadSnapshotStockRequirements } from "@/modules/shopping/application/load-shopping-source";
import { loadConsumptionSource } from "./load-consumption-source";

describe("consumption snapshot source", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { context = await createTestDatabase(); });
  afterEach(async () => context.close());
  it("copies already-buffered plan quantities once and ignores live recipe, labels, pack, price and task batch", async () => {
    const s = await seedLockedPlanningScenario(context.db);
    await context.db.update(inventoryItems).set({ active: false, name: "Changed", baseUnit: "kg", category: "PACKAGING", baseQuantityPerPurchasePack: "999" }).where(eq(inventoryItems.id, s.ingredientItemId));
    await context.db.update(recipeIngredients).set({ quantityInBaseUnit: "999" });
    await context.db.update(cycleTasks).set({ batchCount: "99" });
    await context.db.insert(inventoryPrices).values({ ownerId: OWNER_ID, inventoryItemId: s.ingredientItemId, packPriceSatang: 1, packBaseQuantity: "999", effectiveAt: new Date() });
    expect(await loadConsumptionSource(context.db, OWNER_ID, s.planningSnapshotId)).toEqual([
      { inventoryItemId: s.ingredientItemId, inventoryItemName: "แป้งขนมปัง", inventoryCategory: "INGREDIENT", baseUnit: "g", priceSnapshotId: expect.any(String), plannedQuantity: "2200" },
      { inventoryItemId: s.packagingItemId, inventoryItemName: "ถุงขนม", inventoryCategory: "PACKAGING", baseUnit: "piece", priceSnapshotId: expect.any(String), plannedQuantity: "14" },
    ]);
  });
  it("retains null unit cost and still exposes an unpriced owned requirement", async () => {
    const s = await seedLockedPlanningScenario(context.db, { includeIngredientPrice: false });
    expect((await loadSnapshotStockRequirements(context.db, OWNER_ID, s.planningSnapshotId)).find((row) => row.inventoryItemId === s.ingredientItemId))
      .toMatchObject({ unitCostSatang: null, requiredQuantity: "2200" });
    expect(await loadConsumptionSource(context.db, OWNER_ID, s.planningSnapshotId)).toHaveLength(2);
  });
  it("does not turn an unknown or cross-owner snapshot into an empty source", async () => {
    const s = await seedLockedPlanningScenario(context.db);
    for (const [ownerId, snapshotId] of [[OTHER_OWNER_ID, s.planningSnapshotId], [OWNER_ID, "ffffffff-ffff-4fff-bfff-ffffffffffff"]]) {
      await expect(loadConsumptionSource(context.db, ownerId!, snapshotId!)).rejects.toMatchObject({ kind: "NOT_FOUND", message: "Consumption record not found" });
    }
  });
  it("rejects missing and mismatched owned item/price references instead of manufacturing a source", async () => {
    const s = await seedLockedPlanningScenario(context.db);
    const [packPrice] = await context.db.select().from(cycleInventoryPriceSnapshots).where(eq(cycleInventoryPriceSnapshots.inventoryItemId, s.packagingItemId));
    await expect(context.db.delete(inventoryItems).where(eq(inventoryItems.id, s.ingredientItemId))).rejects.toThrow();
    await expect(context.db.update(cycleMaterialRequirements).set({ priceSnapshotId: packPrice!.id }).where(eq(cycleMaterialRequirements.inventoryItemId, s.ingredientItemId)))
      .rejects.toMatchObject({ cause: { constraint: "cycle_material_requirements_owned_price_snapshot_fk" } });
    const [packaging] = await context.db.select().from(cyclePackagingRequirements).where(eq(cyclePackagingRequirements.planningSnapshotId, s.planningSnapshotId));
    await context.db.update(cyclePackagingRequirements).set({ inventoryItemName: "Inconsistent snapshot label" }).where(eq(cyclePackagingRequirements.id, packaging!.id));
    await expect(loadConsumptionSource(context.db, OWNER_ID, s.planningSnapshotId)).rejects.toThrow("Planning requirement identity mismatch");
  });
});
