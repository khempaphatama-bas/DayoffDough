import { describe, expect, it } from "vitest";
import { convertQuantity, UnitConversionError } from "./units";

describe("convertQuantity", () => {
  it("converts kilograms to grams exactly", () => {
    expect(convertQuantity("1.25", "kg", "g").toString()).toBe("1250");
  });

  it("converts litres to millilitres exactly", () => {
    expect(convertQuantity("0.75", "l", "ml").toString()).toBe("750");
  });

  it("rejects cross-dimension conversion", () => {
    expect(() => convertQuantity("1", "g", "ml")).toThrow(UnitConversionError);
  });
});
