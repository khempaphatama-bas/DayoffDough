import { describe, expect, it } from "vitest";
import { calculateUnitCostSatang } from "./cost";

describe("calculateUnitCostSatang", () => {
  it("calculates satang per gram without binary floating-point drift", () => {
    expect(calculateUnitCostSatang(5500, "1000").toString()).toBe("5.5");
  });

  it("rejects an empty purchase pack", () => {
    expect(() => calculateUnitCostSatang(5500, "0")).toThrow(
      "Pack base quantity must be greater than zero",
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid integer pack price %s",
    (packPriceSatang) => {
      expect(() => calculateUnitCostSatang(packPriceSatang, "1000")).toThrow(
        "Pack price must be a non-negative safe integer",
      );
    },
  );
});
