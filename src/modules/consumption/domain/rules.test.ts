import { describe, expect, it } from "vitest";
import { calculateUseEffect, canonicalQuantity } from "./rules";

describe("canonical consumption quantities", () => {
  it("canonicalizes equivalent persisted and entered quantities", () => {
    expect(canonicalQuantity("01.000000")).toBe("1");
    expect(canonicalQuantity("1")).toBe("1");
  });
  it.each([
    ["0", "0"], ["000.000000", "0"], [".5", "0.5"],
    ["0.000001", "0.000001"], ["999999999999.999999", "999999999999.999999"],
  ])("accepts exact storage quantity %s", (input, expected) => {
    expect(canonicalQuantity(input)).toBe(expected);
  });
  it.each([
    "1000000000000", "1.0000000", "0.0000001", "-1", "-0", "+1",
    "NaN", "Infinity", "1e2", "", " ", " 1 ", "1.", ".",
  ])("rejects nonrepresentable or non-decimal input %j", (value) => {
    expect(() => canonicalQuantity(value)).toThrow();
  });
});

function effect(previousUsed: string | null, newUsed: string, initialCountMovementId: string | null, currentCountMovementId: string | null, countSettled: boolean) {
  return calculateUseEffect({ previousUsed, newUsed, initialCountMovementId, currentCountMovementId, countSettled });
}

describe("consumption stock effect", () => {
  it.each([
    [null, "100", null, null, false, { mode: "DIRECT", delta: "-100" }],
    [null, "100", null, "count-existing", false, { mode: "DIRECT", delta: "-100" }],
    ["100", "90", "count-a", "count-a", false, { mode: "DIRECT", delta: "10" }],
    ["90", "100", null, null, false, { mode: "DIRECT", delta: "-10" }],
    ["100", "90", "count-a", "count-b", false, { mode: "HISTORY_ONLY", delta: "0" }],
    [null, "100", null, null, true, { mode: "COUNT_SETTLED", delta: "0" }],
    ["100", "90", "count-a", "count-b", true, { mode: "COUNT_SETTLED", delta: "0" }],
    ["0", "0", null, null, false, { mode: "DIRECT", delta: "0" }],
    ["999999999999.999999", "999999999999.999998", null, null, false, { mode: "DIRECT", delta: "0.000001" }],
    ["0", "1", null, "count-a", false, { mode: "HISTORY_ONLY", delta: "0" }],
    ["1", "0", "count-a", null, false, { mode: "HISTORY_ONLY", delta: "0" }],
  ] as const)("derives effect for previous %s, new %s and fences %s/%s (settled %s)",
    (previous, next, initial, current, settled, expected) => {
      expect(effect(previous, next, initial, current, settled)).toEqual(expected);
    });
  it("rejects invalid quantities even for history-only effects", () => {
    expect(() => effect("-1", "2", "a", "b", false)).toThrow();
    expect(() => effect(null, "NaN", null, null, true)).toThrow();
  });
});
