import { describe, expect, it } from "vitest";
import { calculateBatchPlan } from "./batch-plan";

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
      }),
    ).toEqual({
      orderedQuantity: "2",
      yieldInSellingUnit: "1.5",
      suggestedBatchCount: 2,
      selectedBatchCount: "2",
      plannedOutput: "3",
      outputDifference: "1",
    });
  });

  it("rejects cross-dimension yield", () => {
    expectExactError(
      () =>
        calculateBatchPlan({
          orderedQuantity: "2",
          baseYieldQuantity: "1",
          yieldUnit: "kg",
          sellingUnit: "piece",
        }),
      "Incompatible yield unit",
    );
  });

  it("keeps fractional batch arithmetic exact and canonical", () => {
    expect(
      calculateBatchPlan({
        orderedQuantity: "0.3",
        baseYieldQuantity: "0.1",
        yieldUnit: "piece",
        sellingUnit: "piece",
        selectedBatchCount: "0.2",
      }),
    ).toEqual({
      orderedQuantity: "0.3",
      yieldInSellingUnit: "0.1",
      suggestedBatchCount: 3,
      selectedBatchCount: "0.2",
      plannedOutput: "0.02",
      outputDifference: "-0.28",
    });
  });

  it("accepts quantities and selected batches with exactly six decimal places", () => {
    expect(
      calculateBatchPlan({
        orderedQuantity: "0.123456",
        baseYieldQuantity: "0.000001",
        yieldUnit: "piece",
        sellingUnit: "piece",
        selectedBatchCount: "1.000001",
      }),
    ).toEqual({
      orderedQuantity: "0.123456",
      yieldInSellingUnit: "0.000001",
      suggestedBatchCount: 123_456,
      selectedBatchCount: "1.000001",
      plannedOutput: "0.000001000001",
      outputDifference: "-0.123454999999",
    });
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
    expectExactError(
      () =>
        calculateBatchPlan({
          orderedQuantity: "1",
          baseYieldQuantity: "1",
          yieldUnit: "piece",
          sellingUnit: "piece",
          ...override,
        }),
      expectedError,
    );
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

    expectExactError(
      () =>
        calculateBatchPlan({
          orderedQuantity: "2147483648",
          baseYieldQuantity: "1",
          yieldUnit: "piece",
          sellingUnit: "piece",
        }),
      "Suggested batch count exceeds PostgreSQL integer range",
    );
  });
});
