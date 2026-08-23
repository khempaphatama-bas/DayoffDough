import { describe, expect, it } from "vitest";
import {
  calculateCycleCost,
  calculateLaborCost,
  calculateProductCost,
  calculateRequirementCost,
  calculateUtilityCost,
  roundAtomicSatang,
} from "./costing";
import type { CostSummaryInput, ProductCostInput } from "./types";

const INVENTORY_ITEM_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_INVENTORY_ITEM_ID = "33333333-3333-4333-8333-333333333333";

function expectExactError(action: () => unknown, expectedMessage: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) return;
    expect(error.message).toBe(expectedMessage);
    return;
  }
  throw new Error(`Expected error: ${expectedMessage}`);
}

function completeProductInput(
  override: Partial<ProductCostInput> = {},
): ProductCostInput {
  return {
    baseIngredientCosts: [8250],
    wasteCosts: [825],
    productPackagingCosts: [90],
    laborCosts: [9000],
    utilityCosts: [3000],
    missingInventoryItemIds: [],
    ...override,
  };
}

function completeCycleInput(
  override: Partial<CostSummaryInput> = {},
): CostSummaryInput {
  return {
    ...completeProductInput(),
    deliveryPackagingCosts: [300],
    ...override,
  };
}

describe("planning cost atoms", () => {
  it("rounds positive half-satang ties up exactly once", () => {
    expect(roundAtomicSatang("10.5")).toBe(11);
    expect(
      calculateRequirementCost("0.3", {
        packPriceSatang: 1,
        packBaseQuantity: "0.2",
      }),
    ).toBe(2);
    expect(calculateLaborCost(1, "1", 30)).toBe(1);
    expect(calculateUtilityCost(1, "0.5")).toBe(1);
  });

  it("calculates exact requirement, labor, and utility costs", () => {
    expect(
      calculateRequirementCost("1650", {
        packPriceSatang: 5500,
        packBaseQuantity: "1000",
      }),
    ).toBe(9075);
    expect(calculateLaborCost(30, "1.5", 12000)).toBe(9000);
    expect(calculateUtilityCost(2000, "1.5")).toBe(3000);
  });

  it("distinguishes a missing price from a recorded zero price", () => {
    expect(calculateRequirementCost("10", null)).toBeNull();
    expect(
      calculateRequirementCost("10", {
        packPriceSatang: 0,
        packBaseQuantity: "100",
      }),
    ).toBe(0);
  });

  it("accepts the rounded PostgreSQL maximum and rejects the next satang", () => {
    expect(roundAtomicSatang("2147483647.49")).toBe(2_147_483_647);
    expectExactError(
      () => roundAtomicSatang("2147483647.5"),
      "Atomic cost exceeds PostgreSQL integer range",
    );
  });

  it.each(["-0.1", "NaN", "Infinity"])(
    "rejects invalid atomic cost %s",
    (value) => {
      expectExactError(
        () => roundAtomicSatang(value),
        "Atomic cost must be a non-negative finite value",
      );
    },
  );

  it("rejects an atomic value outside the safe integer range", () => {
    expectExactError(
      () => roundAtomicSatang("9007199254740992"),
      "Atomic cost exceeds the safe integer range",
    );
  });

  it("guards requirement cost at the PostgreSQL boundary after rounding", () => {
    expect(
      calculateRequirementCost("2147483647.49", {
        packPriceSatang: 1,
        packBaseQuantity: "1",
      }),
    ).toBe(2_147_483_647);
    expectExactError(
      () =>
        calculateRequirementCost("2147483647.5", {
          packPriceSatang: 1,
          packBaseQuantity: "1",
        }),
      "Atomic cost exceeds PostgreSQL integer range",
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid labor minutes %s",
    (laborMinutesPerBatch) => {
      expectExactError(
        () => calculateLaborCost(laborMinutesPerBatch, "1", 12000),
        "Labor minutes per batch must be a non-negative safe integer",
      );
    },
  );

  it("rejects labor source values above the PostgreSQL integer range", () => {
    expectExactError(
      () => calculateLaborCost(2_147_483_648, "1", 0),
      "Labor minutes per batch exceeds PostgreSQL integer range",
    );
    expectExactError(
      () => calculateLaborCost(0, "1", 2_147_483_648),
      "Labor rate exceeds PostgreSQL integer range",
    );
  });

  it.each(["0", "-1", "Infinity"])(
    "rejects invalid selected batch count %s",
    (selectedBatchCount) => {
      expectExactError(
        () => calculateLaborCost(1, selectedBatchCount, 12000),
        "Selected batch count must be greater than zero",
      );
      expectExactError(
        () => calculateUtilityCost(1, selectedBatchCount),
        "Selected batch count must be greater than zero",
      );
    },
  );

  it("rejects invalid or PostgreSQL-overflow utility source values", () => {
    expectExactError(
      () => calculateUtilityCost(-1, "1"),
      "Utility cost per batch must be a non-negative safe integer",
    );
    expectExactError(
      () => calculateUtilityCost(2_147_483_648, "1"),
      "Utility cost per batch exceeds PostgreSQL integer range",
    );
  });

  it("rejects labor and utility atomic products above PostgreSQL range", () => {
    expectExactError(
      () => calculateLaborCost(60, "2", 2_147_483_647),
      "Atomic cost exceeds PostgreSQL integer range",
    );
    expectExactError(
      () => calculateUtilityCost(2_147_483_647, "2"),
      "Atomic cost exceeds PostgreSQL integer range",
    );
  });
});

describe("planning cost summaries", () => {
  it("returns a complete product summary from stored integer components", () => {
    expect(calculateProductCost(completeProductInput())).toEqual({
      knownBaseIngredientCostSatang: 8250,
      knownWasteCostSatang: 825,
      knownProductPackagingCostSatang: 90,
      laborCostSatang: 9000,
      utilityCostSatang: 3000,
      knownProductionCostSatang: 21165,
      completeProductionCostSatang: 21165,
      costComplete: true,
      missingPriceCount: 0,
    });
  });

  it("keeps a product known subtotal but nulls its complete total", () => {
    expect(
      calculateProductCost(
        completeProductInput({
          baseIngredientCosts: [8250, null],
          wasteCosts: [825, null],
          missingInventoryItemIds: [
            INVENTORY_ITEM_ID,
            INVENTORY_ITEM_ID,
            OTHER_INVENTORY_ITEM_ID,
          ],
        }),
      ),
    ).toEqual({
      knownBaseIngredientCostSatang: 8250,
      knownWasteCostSatang: 825,
      knownProductPackagingCostSatang: 90,
      laborCostSatang: 9000,
      utilityCostSatang: 3000,
      knownProductionCostSatang: 21165,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 2,
    });
  });

  it("returns a complete cycle summary including delivery packaging", () => {
    expect(calculateCycleCost(completeCycleInput())).toEqual({
      knownBaseIngredientCostSatang: 8250,
      knownWasteCostSatang: 825,
      knownProductPackagingCostSatang: 90,
      knownDeliveryPackagingCostSatang: 300,
      laborCostSatang: 9000,
      utilityCostSatang: 3000,
      knownProductionCostSatang: 21465,
      completeProductionCostSatang: 21465,
      costComplete: true,
      missingPriceCount: 0,
    });
  });

  it("keeps a cycle known subtotal and counts distinct missing item ids", () => {
    expect(
      calculateCycleCost(
        completeCycleInput({
          baseIngredientCosts: [8250, null],
          wasteCosts: [825, null],
          deliveryPackagingCosts: [],
          missingInventoryItemIds: [INVENTORY_ITEM_ID, INVENTORY_ITEM_ID],
        }),
      ),
    ).toEqual({
      knownBaseIngredientCostSatang: 8250,
      knownWasteCostSatang: 825,
      knownProductPackagingCostSatang: 90,
      knownDeliveryPackagingCostSatang: 0,
      laborCostSatang: 9000,
      utilityCostSatang: 3000,
      knownProductionCostSatang: 21165,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 1,
    });
  });

  it.each([
    ["base ingredient", { baseIngredientCosts: [null] }],
    ["waste", { wasteCosts: [null] }],
    ["product packaging", { productPackagingCosts: [null] }],
  ] as const)("marks a direct %s null incomplete", (_case, override) => {
    expect(
      calculateProductCost(
        completeProductInput({
          ...override,
          missingInventoryItemIds: [],
        }),
      ),
    ).toMatchObject({
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 0,
    });
  });

  it("marks a direct delivery packaging null incomplete", () => {
    expect(
      calculateCycleCost(
        completeCycleInput({
          deliveryPackagingCosts: [null],
          missingInventoryItemIds: [],
        }),
      ),
    ).toMatchObject({
      knownDeliveryPackagingCostSatang: 0,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 0,
    });
  });

  it("treats recorded zero direct costs and known labor and utility as complete", () => {
    expect(
      calculateCycleCost({
        baseIngredientCosts: [0],
        wasteCosts: [0],
        productPackagingCosts: [0],
        deliveryPackagingCosts: [0],
        laborCosts: [0],
        utilityCosts: [0],
        missingInventoryItemIds: [],
      }),
    ).toEqual({
      knownBaseIngredientCostSatang: 0,
      knownWasteCostSatang: 0,
      knownProductPackagingCostSatang: 0,
      knownDeliveryPackagingCostSatang: 0,
      laborCostSatang: 0,
      utilityCostSatang: 0,
      knownProductionCostSatang: 0,
      completeProductionCostSatang: 0,
      costComplete: true,
      missingPriceCount: 0,
    });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid stored component %s",
    (cost) => {
      expectExactError(
        () =>
          calculateProductCost(
            completeProductInput({ baseIngredientCosts: [cost] }),
          ),
        "Cost component must be a non-negative safe integer",
      );
    },
  );

  it("accepts a PostgreSQL-maximum component and rejects the next one", () => {
    expect(
      calculateProductCost({
        baseIngredientCosts: [2_147_483_647],
        wasteCosts: [],
        productPackagingCosts: [],
        laborCosts: [],
        utilityCosts: [],
        missingInventoryItemIds: [],
      }).knownProductionCostSatang,
    ).toBe(2_147_483_647);

    expectExactError(
      () =>
        calculateProductCost(
          completeProductInput({ baseIngredientCosts: [2_147_483_648] }),
        ),
      "Cost component exceeds PostgreSQL integer range",
    );
  });

  it("rejects category and production totals above PostgreSQL range", () => {
    expectExactError(
      () =>
        calculateProductCost({
          baseIngredientCosts: [2_147_483_647, 1],
          wasteCosts: [],
          productPackagingCosts: [],
          laborCosts: [],
          utilityCosts: [],
          missingInventoryItemIds: [],
        }),
      "Cost total exceeds PostgreSQL integer range",
    );

    expectExactError(
      () =>
        calculateCycleCost({
          baseIngredientCosts: [2_147_483_647],
          wasteCosts: [0],
          productPackagingCosts: [0],
          deliveryPackagingCosts: [0],
          laborCosts: [1],
          utilityCosts: [0],
          missingInventoryItemIds: [],
        }),
      "Cost total exceeds PostgreSQL integer range",
    );
  });
});
