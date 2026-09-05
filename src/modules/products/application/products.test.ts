import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "drizzle-orm/logger";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createInventoryService } from "@/modules/inventory/application/inventory";
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
    ).rejects.toThrow("Ingredient not found");
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
    ).rejects.toThrow("Ingredient must be INGREDIENT");
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
