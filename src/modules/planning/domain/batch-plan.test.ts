import { describe, expect, it } from "vitest";
import { calculateBatchPlan } from "./batch-plan";

describe("planning batch calculation", () => {
  it("rounds the suggestion up and preserves an intentional decimal override", () => {
    expect(
      calculateBatchPlan({
        orderedQuantity: "10",
        baseYieldQuantity: "6",
        yieldUnit: "piece",
        sellingUnit: "piece",
        selectedBatchCount: "1.5",
      }),
    ).toEqual({
      orderedQuantity: "10",
      yieldInSellingUnit: "6",
      suggestedBatchCount: 2,
      selectedBatchCount: "1.5",
      plannedOutput: "9",
      outputDifference: "-1",
    });
  });

  it("converts same-dimension yield before suggesting batches", () => {
    expect(
      calculateBatchPlan({
        orderedQuantity: "2",
        baseYieldQuantity: "1500",
        yieldUnit: "g",
        sellingUnit: "kg",
      }).suggestedBatchCount,
    ).toBe(2);
  });

  it("rejects cross-dimension yield", () => {
    expect(() =>
      calculateBatchPlan({
        orderedQuantity: "2",
        baseYieldQuantity: "1",
        yieldUnit: "kg",
        sellingUnit: "piece",
      }),
    ).toThrow("Incompatible yield unit");
  });

  it("defaults selected batches to the suggestion and canonicalizes quantities", () => {
    expect(
      calculateBatchPlan({
        orderedQuantity: "10.000000",
        baseYieldQuantity: "4.000000",
        yieldUnit: "piece",
        sellingUnit: "piece",
      }),
    ).toEqual({
      orderedQuantity: "10",
      yieldInSellingUnit: "4",
      suggestedBatchCount: 3,
      selectedBatchCount: "3",
      plannedOutput: "12",
      outputDifference: "2",
    });
  });

  it.each([
    [
      "zero ordered quantity",
      { orderedQuantity: "0" },
      "Ordered quantity must be greater than zero",
    ],
    [
      "non-finite base yield",
      { baseYieldQuantity: "Infinity" },
      "Base yield must be greater than zero",
    ],
    [
      "non-positive selected batches",
      { selectedBatchCount: "-1" },
      "Selected batch count must be greater than zero",
    ],
    [
      "ordered quantity beyond six places",
      { orderedQuantity: "1.0000001" },
      "Ordered quantity must have at most 6 decimal places",
    ],
  ] as const)("rejects %s", (_case, override, expectedError) => {
    expect(() =>
      calculateBatchPlan({
        orderedQuantity: "1",
        baseYieldQuantity: "1",
        yieldUnit: "piece",
        sellingUnit: "piece",
        ...override,
      }),
    ).toThrow(expectedError);
  });

  it("accepts the PostgreSQL integer maximum and rejects a larger suggestion", () => {
    expect(
      calculateBatchPlan({
        orderedQuantity: "2147483647",
        baseYieldQuantity: "1",
        yieldUnit: "piece",
        sellingUnit: "piece",
      }).suggestedBatchCount,
    ).toBe(2_147_483_647);

    expect(() =>
      calculateBatchPlan({
        orderedQuantity: "2147483648",
        baseYieldQuantity: "1",
        yieldUnit: "piece",
        sellingUnit: "piece",
      }),
    ).toThrow("Suggested batch count exceeds PostgreSQL integer range");
  });
});
