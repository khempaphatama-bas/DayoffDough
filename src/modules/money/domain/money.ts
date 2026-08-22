import Decimal from "decimal.js";

export function parseBahtToSatang(value: Decimal.Value): number {
  try {
    const baht = new Decimal(value);
    const satang = baht.mul(100);
    if (
      baht.isNegative() ||
      baht.decimalPlaces() > 2 ||
      !satang.isInteger() ||
      satang.gt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error("Invalid baht amount");
    }
    return satang.toNumber();
  } catch {
    throw new Error("Invalid baht amount");
  }
}

export function formatSatangAsBaht(satang: number): string {
  if (!Number.isSafeInteger(satang)) {
    throw new Error("Invalid satang amount");
  }
  return new Decimal(satang).div(100).toFixed(2);
}
