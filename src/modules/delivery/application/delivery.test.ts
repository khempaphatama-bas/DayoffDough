import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { createProductService } from "@/modules/products/application/products";
import { createDeliveryService } from "./delivery";

describe("delivery and packaging configuration", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createDeliveryService>;
  let focaccia: { id: string };
  let focacciaBag: { id: string };
  let shippingBox: { id: string };
  let flour: { id: string };
  let kex: { id: string };

  beforeEach(async () => {
    context = await createTestDatabase();
    const inventory = createInventoryService(context.db);
    const products = createProductService(context.db);
    service = createDeliveryService(context.db);
    focaccia = await products.createProduct(OWNER_ID, {
      name: "Focaccia",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 22000,
    });
    focacciaBag = await inventory.createItem(OWNER_ID, {
      name: "Focaccia bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 50 ใบ",
      baseQuantityPerPurchasePack: "50",
      minimumStockQuantity: "10",
    });
    shippingBox = await inventory.createItem(OWNER_ID, {
      name: "Shipping box",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 20 ใบ",
      baseQuantityPerPurchasePack: "20",
      minimumStockQuantity: "5",
    });
    flour = await inventory.createItem(OWNER_ID, {
      name: "Flour",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    kex = await service.createMethod(OWNER_ID, {
      name: "KEX Same Day",
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
    });
  });

  afterEach(async () => context.close());

  it("accepts every supported packaging rule combination", async () => {
    const perUnit = await service.createPackagingRule(OWNER_ID, {
      scope: "PRODUCT",
      productId: focaccia.id,
      deliveryMethodId: null,
      inventoryItemId: focacciaBag.id,
      consumptionBasis: "PER_PRODUCT_UNIT",
      quantityInBaseUnit: "1",
    });
    const perOrder = await service.createPackagingRule(OWNER_ID, {
      scope: "PRODUCT",
      productId: focaccia.id,
      deliveryMethodId: null,
      inventoryItemId: focacciaBag.id,
      consumptionBasis: "PER_ORDER",
      quantityInBaseUnit: "1",
    });
    const perDelivery = await service.createPackagingRule(OWNER_ID, {
      scope: "DELIVERY_METHOD",
      productId: null,
      deliveryMethodId: kex.id,
      inventoryItemId: shippingBox.id,
      consumptionBasis: "PER_DELIVERY",
      quantityInBaseUnit: "1",
    });

    expect([
      perUnit.consumptionBasis,
      perOrder.consumptionBasis,
      perDelivery.consumptionBasis,
    ]).toEqual(["PER_PRODUCT_UNIT", "PER_ORDER", "PER_DELIVERY"]);
  });

  it("rejects a delivery rule with a product-only basis", async () => {
    await expect(
      service.createPackagingRule(OWNER_ID, {
        scope: "DELIVERY_METHOD",
        productId: null,
        deliveryMethodId: kex.id,
        inventoryItemId: shippingBox.id,
        consumptionBasis: "PER_PRODUCT_UNIT",
        quantityInBaseUnit: "1",
      }),
    ).rejects.toThrow("Invalid packaging rule combination");
  });

  it("rejects ingredient inventory as packaging", async () => {
    await expect(
      service.createPackagingRule(OWNER_ID, {
        scope: "PRODUCT",
        productId: focaccia.id,
        deliveryMethodId: null,
        inventoryItemId: flour.id,
        consumptionBasis: "PER_PRODUCT_UNIT",
        quantityInBaseUnit: "1",
      }),
    ).rejects.toThrow("Packaging item must be PACKAGING or CONSUMABLE");
  });
});
