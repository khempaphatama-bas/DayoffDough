import { describe, expect, it } from "vitest";
import type { UnitCode } from "@/modules/units/domain/units";
import {
  aggregateSnapshotRequirements,
  calculatePurchaseProgress,
  calculateShoppingRecommendation,
} from "./calculations";

type RequirementCategory = "INGREDIENT" | "PACKAGING";

function requirement(
  inventoryItemId: string,
  inventoryCategory: RequirementCategory,
  baseUnit: UnitCode,
  plannedRequirement: string,
  overrides: Readonly<{
    inventoryItemName?: string;
    priceSnapshotId?: string;
    unitCostSatang?: string | null;
  }> = {},
) {
  return {
    inventoryItemId,
    inventoryItemName: overrides.inventoryItemName ?? inventoryItemId,
    inventoryCategory,
    baseUnit,
    priceSnapshotId: overrides.priceSnapshotId ?? `price-${inventoryItemId}`,
    unitCostSatang:
      overrides.unitCostSatang === undefined
        ? "5.5"
        : overrides.unitCostSatang,
    plannedRequirement,
  };
}

describe("snapshot requirement aggregation", () => {
  it("aggregates material and packaging rows by inventory item exactly", () => {
    expect(
      aggregateSnapshotRequirements({
        materials: [
          requirement("flour", "INGREDIENT", "g", "1100.123456", {
            inventoryItemName: "Flour",
          }),
          requirement("flour", "INGREDIENT", "g", "0.876544", {
            inventoryItemName: "Flour",
          }),
        ],
        packaging: [
          requirement("box", "PACKAGING", "piece", "12.000000", {
            inventoryItemName: "Box",
            unitCostSatang: null,
          }),
        ],
      }),
    ).toEqual([
      {
        inventoryItemId: "box",
        inventoryItemName: "Box",
        inventoryCategory: "PACKAGING",
        baseUnit: "piece",
        priceSnapshotId: "price-box",
        unitCostSatang: null,
        requiredQuantity: "12",
      },
      {
        inventoryItemId: "flour",
        inventoryItemName: "Flour",
        inventoryCategory: "INGREDIENT",
        baseUnit: "g",
        priceSnapshotId: "price-flour",
        unitCostSatang: "5.5",
        requiredQuantity: "1101",
      },
    ]);
  });

  it("sorts equal copied names by inventory item id", () => {
    expect(
      aggregateSnapshotRequirements({
        materials: [
          requirement("item-b", "INGREDIENT", "g", "1", {
            inventoryItemName: "Same",
          }),
          requirement("item-a", "INGREDIENT", "g", "2", {
            inventoryItemName: "Same",
          }),
        ],
        packaging: [],
      }).map((row) => row.inventoryItemId),
    ).toEqual(["item-a", "item-b"]);
  });

  it.each([
    ["name", { inventoryItemName: "Other" }],
    ["category", { inventoryCategory: "PACKAGING" as const }],
    ["base unit", { baseUnit: "kg" as const }],
    ["price snapshot", { priceSnapshotId: "other-price" }],
    ["snapshotted unit cost", { unitCostSatang: "6" }],
  ])("rejects an inconsistent copied %s for the same item", (_case, change) => {
    const first = requirement("flour", "INGREDIENT", "g", "1000", {
      inventoryItemName: "Flour",
    });
    expect(() =>
      aggregateSnapshotRequirements({
        materials: [first, { ...first, ...change, plannedRequirement: "1" }],
        packaging: [],
      }),
    ).toThrow("Planning requirement identity mismatch");
  });

  it.each(["0", "-1", "not-a-number", "Infinity"])(
    "rejects invalid planned requirement %s",
    (plannedRequirement) => {
      expect(() =>
        aggregateSnapshotRequirements({
          materials: [
            requirement("flour", "INGREDIENT", "g", plannedRequirement),
          ],
          packaging: [],
        }),
      ).toThrow("Invalid planned requirement");
    },
  );
});

describe("shopping recommendation", () => {
  it("calculates exact shortfall and rounds suggested packs upward", () => {
    expect(
      calculateShoppingRecommendation({
        requiredQuantity: "2200",
        countedQuantity: "1000",
        packBaseQuantity: "1000",
        unitCostSatang: "5.5",
      }),
    ).toEqual({
      shortfallQuantity: "1200",
      suggestedPackCount: 2,
      suggestedPurchaseQuantity: "2000",
      estimatedCostSatang: 11000,
    });
  });

  it("keeps six-decimal quantity arithmetic exact and rounds money HALF_UP", () => {
    expect(
      calculateShoppingRecommendation({
        requiredQuantity: "1.000001",
        countedQuantity: "0.000001",
        packBaseQuantity: "0.333333",
        unitCostSatang: "0.5",
      }),
    ).toEqual({
      shortfallQuantity: "1",
      suggestedPackCount: 4,
      suggestedPurchaseQuantity: "1.333332",
      estimatedCostSatang: 1,
    });
  });

  it("does not add a minimum-stock term to the shortfall contract", () => {
    const input = {
      requiredQuantity: "100",
      countedQuantity: "40",
      packBaseQuantity: "25",
      unitCostSatang: "2",
      minimumStockQuantity: "1000",
    };

    expect(calculateShoppingRecommendation(input).shortfallQuantity).toBe(
      "60",
    );
  });

  it("returns zero quantities when counted stock covers the requirement", () => {
    expect(
      calculateShoppingRecommendation({
        requiredQuantity: "1",
        countedQuantity: "2",
        packBaseQuantity: "0.5",
        unitCostSatang: "0",
      }),
    ).toEqual({
      shortfallQuantity: "0",
      suggestedPackCount: 0,
      suggestedPurchaseQuantity: "0",
      estimatedCostSatang: 0,
    });
  });

  it("keeps a missing price distinct from a real zero price", () => {
    const base = {
      requiredQuantity: "1",
      countedQuantity: "0",
      packBaseQuantity: "1",
    };

    expect(
      calculateShoppingRecommendation({ ...base, unitCostSatang: null })
        .estimatedCostSatang,
    ).toBeNull();
    expect(
      calculateShoppingRecommendation({ ...base, unitCostSatang: "0" })
        .estimatedCostSatang,
    ).toBe(0);
    expect(
      calculateShoppingRecommendation({
        ...base,
        countedQuantity: "1",
        unitCostSatang: null,
      }).estimatedCostSatang,
    ).toBeNull();
  });

  it.each([
    ["negative required quantity", { requiredQuantity: "-1" }],
    ["negative counted quantity", { countedQuantity: "-1" }],
    ["zero pack quantity", { packBaseQuantity: "0" }],
    ["negative pack quantity", { packBaseQuantity: "-1" }],
    ["negative unit cost", { unitCostSatang: "-1" }],
    ["non-finite quantity", { requiredQuantity: "Infinity" }],
  ])("rejects %s", (_case, change) => {
    expect(() =>
      calculateShoppingRecommendation({
        requiredQuantity: "1",
        countedQuantity: "0",
        packBaseQuantity: "1",
        unitCostSatang: "1",
        ...change,
      }),
    ).toThrow();
  });

  it("rejects a suggested pack count beyond Number.MAX_SAFE_INTEGER", () => {
    expect(() =>
      calculateShoppingRecommendation({
        requiredQuantity: "9007199254740992",
        countedQuantity: "0",
        packBaseQuantity: "1",
        unitCostSatang: null,
      }),
    ).toThrow("Suggested pack count is too large");
  });
});

describe("purchase progress", () => {
  it("reports no purchases as TO_BUY", () => {
    expect(calculatePurchaseProgress("1200", [])).toEqual({
      status: "TO_BUY",
      purchasedQuantity: "0",
      remainingQuantity: "1200",
      overageQuantity: "0",
    });
  });

  it("reports a purchase below the shortfall as PARTIAL", () => {
    expect(calculatePurchaseProgress("1200", ["1000"])).toEqual({
      status: "PARTIAL",
      purchasedQuantity: "1000",
      remainingQuantity: "200",
      overageQuantity: "0",
    });
  });

  it("reports exact completion without overage", () => {
    expect(calculatePurchaseProgress("1200", ["200", "1000"])).toEqual({
      status: "COMPLETE",
      purchasedQuantity: "1200",
      remainingQuantity: "0",
      overageQuantity: "0",
    });
  });

  it("reports completion while preserving the full overage", () => {
    expect(calculatePurchaseProgress("1200", ["1000", "1000"])).toEqual({
      status: "COMPLETE",
      purchasedQuantity: "2000",
      remainingQuantity: "0",
      overageQuantity: "800",
    });
  });

  it("sums six-decimal purchase quantities exactly", () => {
    expect(
      calculatePurchaseProgress("1.000001", ["0.333333", "0.666668"]),
    ).toEqual({
      status: "COMPLETE",
      purchasedQuantity: "1.000001",
      remainingQuantity: "0",
      overageQuantity: "0",
    });
  });

  it.each([
    ["negative shortfall", "-1", []],
    ["negative purchase", "1", ["-1"]],
    ["invalid purchase", "1", ["not-a-number"]],
  ] as const)("rejects %s", (_case, shortfall, purchases) => {
    expect(() => calculatePurchaseProgress(shortfall, purchases)).toThrow();
  });
});
