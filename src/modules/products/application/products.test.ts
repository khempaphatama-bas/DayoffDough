import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "drizzle-orm/logger";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { cycleMaterialRequirements, cycleRecipePlans } from "@/modules/planning/db/schema";
import { recipeVersions } from "@/modules/products/db/schema";
import {
  createProductService,
  type CreateRecipeVersionInput,
} from "./products";

describe("product and recipe service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let inventoryService: ReturnType<typeof createInventoryService>;
  let productService: ReturnType<typeof createProductService>;
  let flour: { id: string };
  let product: { id: string };

  beforeEach(async () => {
    context = await createTestDatabase();
    inventoryService = createInventoryService(context.db);
    productService = createProductService(context.db);
    flour = await inventoryService.createItem(OWNER_ID, {
      name: "NS Wonder",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    product = await productService.createProduct(OWNER_ID, {
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    });
  });

  afterEach(async () => context.close());

  function validInput(): CreateRecipeVersionInput {
    return {
      versionCode: "DOD-FOC-001",
      baseYieldQuantity: "1",
      yieldUnit: "piece",
      laborMinutesPerBatch: 45,
      utilityCostSatangPerBatch: 3500,
      wasteAllowancePercent: "3",
      ingredients: [{ inventoryItemId: flour.id, quantityInBaseUnit: "390" }],
      instructions: "Mix, ferment, bake, cool",
    };
  }

  function save(versionCode: string) {
    return productService.createRecipeVersion(OWNER_ID, product.id, {
      ...validInput(),
      versionCode,
    });
  }

  function detail() {
    return productService.getProductDetail(OWNER_ID, product.id);
  }

  it("creates and activates an immutable recipe version with positive sellable yield", async () => {
    const version = await productService.createRecipeVersion(
      OWNER_ID,
      product.id,
      validInput(),
    );
    expect(version.versionCode).toBe("DOD-FOC-001");
    expect(version.ingredients).toEqual([
      expect.objectContaining({
        inventoryItemId: flour.id,
        inventoryItemName: "NS Wonder",
        baseUnit: "g",
        quantityInBaseUnit: "390",
      }),
    ]);

    await productService.activateRecipeVersion(OWNER_ID, product.id, version.id);
    const detail = await productService.getProductDetail(OWNER_ID, product.id);
    expect(detail.activeRecipeVersionId).toBe(version.id);
    expect(detail.versions).toHaveLength(1);
  });

  it("rejects a zero base yield", async () => {
    await expect(
      productService.createRecipeVersion(OWNER_ID, product.id, {
        ...validInput(),
        baseYieldQuantity: "0",
      }),
    ).rejects.toThrow("Base yield must be greater than zero");
  });

  it("does not allow an ingredient owned by another account", async () => {
    const foreignFlour = await inventoryService.createItem(OTHER_OWNER_ID, {
      name: "Foreign flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await expect(
      productService.createRecipeVersion(OWNER_ID, product.id, {
        ...validInput(),
        ingredients: [
          { inventoryItemId: foreignFlour.id, quantityInBaseUnit: "390" },
        ],
      }),
    ).rejects.toMatchObject({ code: "ITEM_UNAVAILABLE" });
  });

  it("rejects packaging inventory as a recipe ingredient", async () => {
    const bag = await inventoryService.createItem(OWNER_ID, {
      name: "Bread bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 100 ใบ",
      baseQuantityPerPurchasePack: "100",
      minimumStockQuantity: "0",
    });
    await expect(
      productService.createRecipeVersion(OWNER_ID, product.id, {
        ...validInput(),
        ingredients: [{ inventoryItemId: bag.id, quantityInBaseUnit: "1" }],
      }),
    ).rejects.toMatchObject({ code: "ITEM_UNAVAILABLE" });
  });

  it("keeps five selectable versions and archives the oldest non-current one on the sixth save", async () => {
    const v1 = await save("v1");
    await productService.activateRecipeVersion(OWNER_ID, product.id, v1.id);
    await context.db.update(recipeVersions).set({ createdAt: new Date(-1000) })
      .where(eq(recipeVersions.id, v1.id));
    const v2 = await save("v2");
    await context.db.update(recipeVersions).set({ createdAt: new Date(0) })
      .where(eq(recipeVersions.id, v2.id));
    await save("v3");
    await save("v4");
    const fifth = await save("v5");
    expect(fifth.archivedVersions).toEqual([]);

    const sixth = await save("v6");
    expect(sixth.archivedVersions).toEqual([{ id: v2.id, versionCode: "v2" }]);
    expect(sixth.archivedAt).toBeNull();
    const after = await detail();
    expect(after.versions.filter((version) => version.archivedAt === null)).toHaveLength(5);
    expect(after.activeRecipeVersionId).toBe(v1.id);
  });

  it("breaks equal creation timestamps by ascending ID and keeps the new version selectable", async () => {
    const v1 = await save("v1");
    await productService.activateRecipeVersion(OWNER_ID, product.id, v1.id);
    const v2 = await save("v2");
    const v3 = await save("v3");
    await save("v4");
    await save("v5");
    await context.db.update(recipeVersions).set({ createdAt: new Date("2100-01-01") })
      .where(inArray(recipeVersions.versionCode, ["v2", "v3"]));
    await context.db.update(recipeVersions).set({ createdAt: new Date("2101-01-01") })
      .where(inArray(recipeVersions.versionCode, ["v4", "v5"]));

    const expected = v2.id < v3.id ? v2 : v3;
    const sixth = await save("v6");
    expect(sixth.archivedVersions).toEqual([{ id: expected.id, versionCode: expected.versionCode }]);
    expect((await detail()).versions.find((version) => version.id === sixth.id)?.archivedAt).toBeNull();
  });

  it("archives only a non-current version and leaves the original recipe and locked production quantities intact", async () => {
    const locked = await seedLockedPlanningScenario(context.db);
    const lockedDetail = () => productService.getProductDetail(OWNER_ID, locked.productId);
    const originalId = (await lockedDetail()).activeRecipeVersionId!;
    const archive = () => productService.archiveRecipeVersion(OWNER_ID, locked.productId, originalId);
    const readSnapshot = () => Promise.all([
      context.db.select().from(cycleRecipePlans)
        .where(eq(cycleRecipePlans.planningSnapshotId, locked.planningSnapshotId)),
      context.db.select().from(cycleMaterialRequirements)
        .where(eq(cycleMaterialRequirements.planningSnapshotId, locked.planningSnapshotId)),
    ]);
    const snapshot = await readSnapshot();
    expect(snapshot[0]).toHaveLength(1);
    expect(snapshot[1].length).toBeGreaterThan(0);
    const original = (await lockedDetail()).versions.find((version) => version.id === originalId)!;
    expect(original).toMatchObject({
      versionCode: "v1",
      baseYieldQuantity: "6",
      instructions: "ผสม พัก และอบ",
      ingredients: [expect.objectContaining({ quantityInBaseUnit: "1000" })],
    });
    await expect(archive()).rejects.toMatchObject({ code: "ACTIVE_VERSION" });
    const replacement = await productService.createRecipeVersion(OWNER_ID, locked.productId, {
      ...validInput(),
      versionCode: "v2",
    });
    expect((await lockedDetail()).activeRecipeVersionId).toBe(originalId);
    await productService.activateRecipeVersion(OWNER_ID, locked.productId, replacement.id);

    const summary = { id: originalId, versionCode: "v1" };
    await expect(archive()).resolves.toEqual(summary);
    const archived = (await lockedDetail()).versions.find((version) => version.id === originalId);
    expect(archived).toEqual({ ...original, archivedAt: expect.any(Date) });
    await expect(archive()).resolves.toEqual(summary);
    await expect(productService.activateRecipeVersion(OWNER_ID, locked.productId, originalId))
      .rejects.toMatchObject({ code: "ARCHIVED_VERSION" });
    const after = await lockedDetail();
    expect(after.activeRecipeVersionId).toBe(replacement.id);
    expect(after.versions.find((version) => version.id === originalId)).toEqual(archived);
    expect(await readSnapshot()).toEqual(snapshot);
  });

  it("does not disclose a version through a wrong product or owner", async () => {
    const version = await save("v1");
    const foreignProduct = await productService.createProduct(OTHER_OWNER_ID, {
      name: "Foreign product", sellingUnit: "piece", defaultUnitPriceSatang: 20000,
    });
    const differentProduct = await productService.createProduct(OWNER_ID, {
      name: "Different product", sellingUnit: "piece", defaultUnitPriceSatang: 20000,
    });
    const foreignMissing = "00110000-0000-4000-8000-000000000010";
    for (const change of [
      () => productService.archiveRecipeVersion(OWNER_ID, product.id, foreignMissing),
      () => productService.archiveRecipeVersion(OWNER_ID, differentProduct.id, version.id),
      () => productService.archiveRecipeVersion(OTHER_OWNER_ID, foreignProduct.id, version.id),
      () => productService.archiveRecipeVersion(OTHER_OWNER_ID, product.id, version.id),
      () => productService.activateRecipeVersion(OWNER_ID, product.id, foreignMissing),
      () => productService.activateRecipeVersion(OWNER_ID, differentProduct.id, version.id),
      () => productService.activateRecipeVersion(OTHER_OWNER_ID, foreignProduct.id, version.id),
      () => productService.activateRecipeVersion(OTHER_OWNER_ID, product.id, version.id),
    ]) {
      await expect(change()).rejects.toMatchObject({
        name: "RecipeMaintenanceError", code: "NOT_FOUND", message: "Recipe version not found",
      });
    }
    await expect(productService.createRecipeVersion(OTHER_OWNER_ID, product.id, validInput()))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await detail()).versions[0]?.archivedAt).toBeNull();
  });

  it("rejects duplicate codes including archived ones without archiving a prior version", async () => {
    const prior = await save("v0");
    await productService.archiveRecipeVersion(OWNER_ID, product.id, prior.id);
    for (const code of ["v1", "v2", "v3", "v4", "v5"]) await save(code);
    for (const code of ["v0", "v1"]) {
      await expect(save(code)).rejects.toMatchObject({ code: "DUPLICATE_VERSION_CODE" });
    }
    await expect(productService.createRecipeVersion(OWNER_ID, product.id, {
      ...validInput(), ingredients: [],
    })).rejects.toThrow("Invalid recipe version");
    const unavailable = "00110000-0000-4000-8000-000000000010";
    await expect(productService.createRecipeVersion(OWNER_ID, product.id, {
      ...validInput(), ingredients: [{ inventoryItemId: unavailable, quantityInBaseUnit: "1" }],
    })).rejects.toMatchObject({ code: "ITEM_UNAVAILABLE" });
    const after = await detail();
    expect(after.versions).toHaveLength(6);
    expect(after.versions.filter((version) => version.archivedAt !== null).map((version) => version.id))
      .toEqual([prior.id]);
    expect(after.activeRecipeVersionId).toBeNull();
  });

  it("saves WATER and ICE as ingredients and includes their identity in both read models", async () => {
    const water = await inventoryService.createItem(OWNER_ID, {
      name: "Water", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "ml",
    });
    const ice = await inventoryService.createItem(OWNER_ID, {
      name: "Ice", category: "INGREDIENT", ingredientKind: "ICE", baseUnit: "g",
    });
    const version = await productService.createRecipeVersion(OWNER_ID, product.id, {
      ...validInput(),
      ingredients: [
        { inventoryItemId: water.id, quantityInBaseUnit: "25", expectedIdentity: { baseUnit: "ml", ingredientKind: "WATER" } },
        { inventoryItemId: ice.id, quantityInBaseUnit: "10", expectedIdentity: { baseUnit: "g", ingredientKind: "ICE" } },
      ],
    });
    const projections = [
      expect.objectContaining({ inventoryItemName: "Water", baseUnit: "ml", ingredientKind: "WATER", itemActive: true, quantityInBaseUnit: "25" }),
      expect.objectContaining({ inventoryItemName: "Ice", baseUnit: "g", ingredientKind: "ICE", itemActive: true, quantityInBaseUnit: "10" }),
    ];
    expect(version.ingredients).toEqual(expect.arrayContaining(projections));
    expect((await detail()).versions[0]?.ingredients).toEqual(expect.arrayContaining(projections));
    await expect(productService.activateRecipeVersion(OWNER_ID, product.id, version.id))
      .resolves.toMatchObject({ activeRecipeVersionId: version.id });
  });

  it.each([
    { initialUnit: "g", nextUnit: "kg", nextKind: "STANDARD" },
    { initialUnit: "ml", nextUnit: "ml", nextKind: "WATER" },
  ] as const)("rejects stale draft identity $initialUnit -> $nextUnit/$nextKind", async ({
    initialUnit, nextUnit, nextKind,
  }) => {
    const initial = {
      name: "Draft item", category: "INGREDIENT" as const, baseUnit: initialUnit,
      purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000", minimumStockQuantity: "0",
    };
    const item = await inventoryService.createItem(OWNER_ID, initial);
    await inventoryService.updateItem(OWNER_ID, item.id, nextKind === "WATER" ? {
      name: initial.name, category: "INGREDIENT", baseUnit: nextUnit, ingredientKind: nextKind,
    } : { ...initial, baseUnit: nextUnit, ingredientKind: nextKind });
    await expect(productService.createRecipeVersion(OWNER_ID, product.id, {
      ...validInput(),
      ingredients: [{
        inventoryItemId: item.id,
        quantityInBaseUnit: "20",
        expectedIdentity: { baseUnit: initialUnit, ingredientKind: "STANDARD" },
      }],
    })).rejects.toMatchObject({ code: "ITEM_CHANGED" });
    expect((await detail()).versions).toEqual([]);
  });

  it("keeps inactive ingredients readable but rejects both saving and activating recipes that use them", async () => {
    const version = await save("v1");
    await inventoryService.archiveItem(OWNER_ID, flour.id);
    expect((await detail()).versions[0]?.ingredients[0]).toMatchObject({
      itemActive: false, quantityInBaseUnit: "390",
    });
    await expect(save("v2")).rejects.toMatchObject({ code: "ITEM_UNAVAILABLE" });
    await expect(productService.activateRecipeVersion(OWNER_ID, product.id, version.id))
      .rejects.toMatchObject({ code: "ITEM_UNAVAILABLE" });
    expect((await detail()).activeRecipeVersionId).toBeNull();
  });

  it("loads the product list with one select regardless of recipe count", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query.toLowerCase());
        },
      } satisfies Logger,
    });
    inventoryService = createInventoryService(context.db);
    productService = createProductService(context.db);

    flour = await inventoryService.createItem(OWNER_ID, {
      name: "NS Wonder",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    const focaccia = await productService.createProduct(OWNER_ID, {
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    });
    const ciabatta = await productService.createProduct(OWNER_ID, {
      name: "Ciabatta",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 18000,
    });
    const focacciaVersion = await productService.createRecipeVersion(
      OWNER_ID,
      focaccia.id,
      validInput(),
    );
    await productService.createRecipeVersion(OWNER_ID, ciabatta.id, {
      ...validInput(),
      versionCode: "DOD-CIA-001",
      ingredients: [
        { inventoryItemId: flour.id, quantityInBaseUnit: "300" },
      ],
    });
    await productService.activateRecipeVersion(
      OWNER_ID,
      focaccia.id,
      focacciaVersion.id,
    );

    queries.length = 0;
    const listed = await productService.listProducts(OWNER_ID);

    expect(listed.map((item) => item.name)).toEqual(["Ciabatta", "Focaccia"]);
    expect(listed.find((item) => item.id === focaccia.id)).toMatchObject({
      activeRecipeVersionId: focacciaVersion.id,
    });

    const selects = queries.filter((query) => query.startsWith("select"));
    expect(selects).toHaveLength(1);
    expect(selects.filter((query) => query.includes('from "products"'))).toHaveLength(1);
  });
});
