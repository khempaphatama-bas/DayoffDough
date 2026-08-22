import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createInventoryService } from "./inventory";

describe("inventory service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createInventoryService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createInventoryService(context.db);
  });

  afterEach(async () => {
    await context.close();
  });

  it("stores price history and returns the latest effective unit cost", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "NS Wonder",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "500",
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 5500,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-08-01T00:00:00+07:00"),
    });
    await service.addPrice(OWNER_ID, item.id, {
      packPriceSatang: 6000,
      packBaseQuantity: "1000",
      effectiveAt: new Date("2026-09-01T00:00:00+07:00"),
    });

    const detail = await service.getItemDetail(
      OWNER_ID,
      item.id,
      new Date("2026-08-22T00:00:00+07:00"),
    );
    expect(detail.latestUnitCostSatang?.toString()).toBe("5.5");
    expect(detail.priceHistory).toHaveLength(2);
  });

  it("reconciles repeated physical counts without leaking another owner's stock", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "Bread bag",
      category: "PACKAGING",
      baseUnit: "piece",
      purchaseUnitLabel: "แพ็ก 100 ใบ",
      baseQuantityPerPurchasePack: "100",
      minimumStockQuantity: "20",
    });
    await service.recordCount(OWNER_ID, item.id, "750", new Date("2026-08-21"));
    await service.recordCount(OWNER_ID, item.id, "700", new Date("2026-08-22"));

    expect((await service.getItemDetail(OWNER_ID, item.id)).stockBalance).toBe("700");
    await expect(service.getItemDetail(OTHER_OWNER_ID, item.id)).rejects.toThrow(
      "Inventory item not found",
    );
  });

  it("does not allow another owner to attach a price", async () => {
    const item = await service.createItem(OWNER_ID, {
      name: "Cream cheese",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ก้อน 250 g",
      baseQuantityPerPurchasePack: "250",
      minimumStockQuantity: "0",
    });

    await expect(
      service.addPrice(OTHER_OWNER_ID, item.id, {
        packPriceSatang: 12900,
        packBaseQuantity: "250",
        effectiveAt: new Date("2026-08-22"),
      }),
    ).rejects.toThrow("Inventory item not found");
  });

  it("rejects invalid pack and physical-count quantities", async () => {
    await expect(
      service.createItem(OWNER_ID, {
        name: "Invalid pack",
        category: "INGREDIENT",
        baseUnit: "g",
        purchaseUnitLabel: "ถุง",
        baseQuantityPerPurchasePack: "0",
        minimumStockQuantity: "0",
      }),
    ).rejects.toThrow("Invalid inventory item");

    const item = await service.createItem(OWNER_ID, {
      name: "Valid pack",
      category: "INGREDIENT",
      baseUnit: "g",
      purchaseUnitLabel: "ถุง 1 kg",
      baseQuantityPerPurchasePack: "1000",
      minimumStockQuantity: "0",
    });
    await expect(
      service.recordCount(OWNER_ID, item.id, "-1", new Date("2026-08-22")),
    ).rejects.toThrow("Invalid physical count");
  });
});
