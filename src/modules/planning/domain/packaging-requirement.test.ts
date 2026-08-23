import { describe, expect, it } from "vitest";
import { calculatePackagingRequirement } from "./packaging-requirement";
import type { PackagingRequirementInput } from "./types";

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

describe("packaging requirements", () => {
  it.each([
    ["PER_PRODUCT_UNIT", "0.5", "9", 0, "9", "4.5"],
    ["PER_ORDER", "1", "0", 2, "2", "2"],
    ["PER_DELIVERY", "2", "0", 3, "3", "6"],
  ] as const)(
    "calculates %s from its required multiplier",
    (
      basis,
      ruleQuantity,
      plannedOutput,
      distinctOrderCount,
      expectedMultiplier,
      expectedRequirement,
    ) => {
      expect(
        calculatePackagingRequirement({
          basis,
          ruleQuantity,
          plannedOutput,
          distinctOrderCount,
        }),
      ).toEqual({
        multiplier: expectedMultiplier,
        plannedRequirement: expectedRequirement,
      });
    },
  );

  it("keeps decimal multiplication exact and returns canonical strings", () => {
    expect(
      calculatePackagingRequirement({
        basis: "PER_PRODUCT_UNIT",
        ruleQuantity: "0.100000",
        plannedOutput: "0.200000",
        distinctOrderCount: 0,
      }),
    ).toEqual({ multiplier: "0.2", plannedRequirement: "0.02" });
  });

  it.each(["0", "-0.000001", "Infinity", "not-a-number"])(
    "rejects invalid rule quantity %s with the exact contract message",
    (ruleQuantity) => {
      expectExactError(
        () =>
          calculatePackagingRequirement({
            basis: "PER_ORDER",
            ruleQuantity,
            plannedOutput: "1",
            distinctOrderCount: 1,
          }),
        "Rule quantity must be greater than zero",
      );
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid distinct order count %s",
    (distinctOrderCount) => {
      expectExactError(
        () =>
          calculatePackagingRequirement({
            basis: "PER_ORDER",
            ruleQuantity: "1",
            plannedOutput: "1",
            distinctOrderCount,
          }),
        "Distinct order count must be a non-negative safe integer",
      );
    },
  );

  it("accepts the PostgreSQL integer maximum and rejects the next order count", () => {
    expect(
      calculatePackagingRequirement({
        basis: "PER_DELIVERY",
        ruleQuantity: "0.000001",
        plannedOutput: "1",
        distinctOrderCount: 2_147_483_647,
      }),
    ).toEqual({ multiplier: "2147483647", plannedRequirement: "2147.483647" });

    expectExactError(
      () =>
        calculatePackagingRequirement({
          basis: "PER_DELIVERY",
          ruleQuantity: "1",
          plannedOutput: "1",
          distinctOrderCount: 2_147_483_648,
        }),
      "Distinct order count exceeds PostgreSQL integer range",
    );
  });

  it("rejects a basis outside the exact packaging contract", () => {
    expectExactError(
      () =>
        calculatePackagingRequirement({
          basis: "PER_BATCH" as PackagingRequirementInput["basis"],
          ruleQuantity: "1",
          plannedOutput: "1",
          distinctOrderCount: 1,
        }),
      "Unsupported packaging basis",
    );
  });
});
