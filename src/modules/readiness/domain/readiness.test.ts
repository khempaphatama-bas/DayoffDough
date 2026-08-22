import { describe, expect, it } from "vitest";
import { evaluateMasterDataReadiness } from "./readiness";

describe("master-data readiness", () => {
  it("is ready when every Phase 1 dependency has a usable record", () => {
    const result = evaluateMasterDataReadiness({
      settingsConfigured: true,
      inventoryItemCount: 1,
      inventoryPricedCount: 1,
      productCount: 1,
      activeRecipeCount: 1,
      deliveryMethodCount: 1,
    });

    expect(result.ready).toBe(true);
    expect(result.message).toBe("ข้อมูลตั้งต้นพร้อมใช้งาน");
  });

  it("reports specific missing counts without treating prices as zero", () => {
    const result = evaluateMasterDataReadiness({
      settingsConfigured: false,
      inventoryItemCount: 2,
      inventoryPricedCount: 1,
      productCount: 2,
      activeRecipeCount: 1,
      deliveryMethodCount: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "inventory", status: "1 รายการยังไม่มีราคา" }),
        expect.objectContaining({ key: "recipes", status: "1 สินค้ายังไม่มีสูตรที่เปิดใช้" }),
        expect.objectContaining({ key: "delivery", status: "ยังไม่มีวิธีส่ง" }),
      ]),
    );
  });
});
