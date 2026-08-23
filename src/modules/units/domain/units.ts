import Decimal from "decimal.js";

export type UnitDimension = "mass" | "volume" | "count";
export type UnitCode = "mg" | "g" | "kg" | "ml" | "l" | "piece";

type UnitDefinition = Readonly<{
  dimension: UnitDimension;
  toBaseFactor: Decimal.Value;
}>;

const UNITS: Record<UnitCode, UnitDefinition> = {
  mg: { dimension: "mass", toBaseFactor: "0.001" },
  g: { dimension: "mass", toBaseFactor: "1" },
  kg: { dimension: "mass", toBaseFactor: "1000" },
  ml: { dimension: "volume", toBaseFactor: "1" },
  l: { dimension: "volume", toBaseFactor: "1000" },
  piece: { dimension: "count", toBaseFactor: "1" },
};

const UNIT_LABELS: Readonly<Record<UnitCode, string>> = {
  mg: "mg",
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "l",
  piece: "ชิ้น",
};

export class UnitConversionError extends Error {}

export function formatUnitLabel(unit: UnitCode): string {
  return UNIT_LABELS[unit];
}

export function convertQuantity(
  value: Decimal.Value,
  from: UnitCode,
  to: UnitCode,
): Decimal {
  const source = UNITS[from];
  const target = UNITS[to];
  if (source.dimension !== target.dimension) {
    throw new UnitConversionError(`Cannot convert ${from} to ${to}`);
  }
  return new Decimal(value).mul(source.toBaseFactor).div(target.toBaseFactor);
}
