import { describe, expect, it } from "vitest";
import { formatSatangAsBaht, parseBahtToSatang } from "./money";

describe("Thai baht money", () => {
  it.each([
    ["120", 12000],
    ["120.50", 12050],
    ["0.01", 1],
  ])("parses %s baht as %i satang exactly", (baht, satang) => {
    expect(parseBahtToSatang(baht)).toBe(satang);
  });

  it.each(["-1", "0.001", "90071992547409.92"])(
    "rejects invalid money amount %s",
    (baht) => {
      expect(() => parseBahtToSatang(baht)).toThrow("Invalid baht amount");
    },
  );

  it("formats satang with two baht decimals", () => {
    expect(formatSatangAsBaht(12050)).toBe("120.50");
    expect(formatSatangAsBaht(-100)).toBe("-1.00");
  });

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid satang amount %s",
    (satang) => {
      expect(() => formatSatangAsBaht(satang)).toThrow("Invalid satang amount");
    },
  );
});
