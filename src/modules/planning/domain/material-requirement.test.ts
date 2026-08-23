import { describe, expect, it } from "vitest";
import {
  calculateMaterialRequirement,
  resolveWasteAllowance,
} from "./material-requirement";

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

describe("material requirement", () => {
  it("uses recipe waste when present", () => {
    expect(resolveWasteAllowance("10", "3")).toEqual({
      percent: "10",
      source: "RECIPE",
    });
  });

  it("scales base plus waste quantities", () => {
    expect(
      calculateMaterialRequirement({
        quantityPerBatch: "1000",
        selectedBatchCount: "1.5",
        wasteAllowancePercent: "10",
      }),
    ).toEqual({
      baseRequirement: "1500",
      wasteQuantity: "150",
      plannedRequirement: "1650",
    });
  });

  it("falls back to shop waste", () => {
    expect(resolveWasteAllowance(null, "3")).toEqual({
      percent: "3",
      source: "SHOP_DEFAULT",
    });
  });

  it("rejects non-positive ingredient quantity", () => {
    expectExactError(
      () =>
        calculateMaterialRequirement({
          quantityPerBatch: "0",
          selectedBatchCount: "1",
          wasteAllowancePercent: "3",
        }),
      "Ingredient quantity must be greater than zero",
    );
  });

  it("keeps fractional material arithmetic exact and canonical", () => {
    expect(
      calculateMaterialRequirement({
        quantityPerBatch: "0.1",
        selectedBatchCount: "0.2",
        wasteAllowancePercent: "0.3",
      }),
    ).toEqual({
      baseRequirement: "0.02",
      wasteQuantity: "0.00006",
      plannedRequirement: "0.02006",
    });
  });

  it("canonicalizes the selected waste percentage", () => {
    expect(resolveWasteAllowance("10.0000", "3.0000")).toEqual({
      percent: "10",
      source: "RECIPE",
    });
    expect(resolveWasteAllowance(null, "0.0000")).toEqual({
      percent: "0",
      source: "SHOP_DEFAULT",
    });
  });

  it.each([
    [
      "exactly four decimal places",
      "12.3456",
      "3",
      { percent: "12.3456", source: "RECIPE" },
    ],
    [
      "the inclusive upper bound",
      null,
      "100",
      { percent: "100", source: "SHOP_DEFAULT" },
    ],
    [
      "an explicit zero recipe override",
      "0",
      "3",
      { percent: "0", source: "RECIPE" },
    ],
  ] as const)("accepts %s", (_case, recipePercent, shopPercent, expected) => {
    expect(resolveWasteAllowance(recipePercent, shopPercent)).toEqual(expected);
  });

  it.each(["-0.0001", "100.0001", "1.00001", "Infinity"])(
    "rejects invalid waste percentage %s",
    (wasteAllowancePercent) => {
      expectExactError(
        () =>
          calculateMaterialRequirement({
            quantityPerBatch: "1",
            selectedBatchCount: "1",
            wasteAllowancePercent,
          }),
        "Waste allowance must be between 0 and 100 with up to 4 decimal places",
      );
    },
  );

  it.each([
    [
      "ingredient quantity beyond six places",
      { quantityPerBatch: "1.0000001" },
      "Ingredient quantity must have at most 6 decimal places",
    ],
    [
      "non-positive selected batches",
      { selectedBatchCount: "0" },
      "Selected batch count must be greater than zero",
    ],
    [
      "selected batches beyond six places",
      { selectedBatchCount: "1.0000001" },
      "Selected batch count must have at most 6 decimal places",
    ],
  ] as const)("rejects %s", (_case, override, expectedError) => {
    expectExactError(
      () =>
        calculateMaterialRequirement({
          quantityPerBatch: "1",
          selectedBatchCount: "1",
          wasteAllowancePercent: "3",
          ...override,
        }),
      expectedError,
    );
  });
});
