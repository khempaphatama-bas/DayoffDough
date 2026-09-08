import Decimal from "decimal.js";

export const StorageDecimal = Decimal.clone({ precision: 80 });
export const NUMERIC_18_6_UPPER_BOUND = new StorageDecimal("1000000000000");
export const POSTGRESQL_INTEGER_MAX = 2_147_483_647;

export class ShoppingStorageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingStorageLimitError";
  }
}

function parse(value: string, label: string): Decimal {
  let quantity: Decimal;
  try {
    quantity = new StorageDecimal(value);
  } catch {
    throw new ShoppingStorageLimitError(`${label} is not a finite decimal`);
  }
  if (!quantity.isFinite()) {
    throw new ShoppingStorageLimitError(`${label} is not a finite decimal`);
  }
  return quantity;
}

export function assertNumeric18_6(value: string, label: string): string {
  const quantity = parse(value, label);
  if (
    quantity.decimalPlaces() > 6 ||
    quantity.abs().gte(NUMERIC_18_6_UPPER_BOUND)
  ) {
    throw new ShoppingStorageLimitError(
      `${label} exceeds numeric(18,6) storage`,
    );
  }
  return quantity.toString();
}

export function isNonNegativeNumeric18_6(value: string): boolean {
  try {
    return new StorageDecimal(assertNumeric18_6(value, "quantity")).gte(0);
  } catch {
    return false;
  }
}

export function assertPostgreSqlInteger(
  value: string,
  label: string,
): number {
  const quantity = parse(value, label);
  if (
    !quantity.isInteger() ||
    quantity.lt(-POSTGRESQL_INTEGER_MAX - 1) ||
    quantity.gt(POSTGRESQL_INTEGER_MAX)
  ) {
    throw new ShoppingStorageLimitError(
      `${label} exceeds PostgreSQL integer range`,
    );
  }
  return quantity.toNumber();
}
