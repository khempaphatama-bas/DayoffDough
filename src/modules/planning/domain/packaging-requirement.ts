import Decimal from "decimal.js";
import type {
  PackagingRequirementCalculation,
  PackagingRequirementInput,
} from "./types";

const POSTGRESQL_INTEGER_MAX = 2_147_483_647;

function parseRuleQuantity(value: string): Decimal {
  let quantity: Decimal;
  try {
    quantity = new Decimal(value);
  } catch {
    throw new Error("Rule quantity must be greater than zero");
  }

  if (!quantity.isFinite() || !quantity.gt(0)) {
    throw new Error("Rule quantity must be greater than zero");
  }
  return quantity;
}

function requireDistinctOrderCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "Distinct order count must be a non-negative safe integer",
    );
  }
  if (value > POSTGRESQL_INTEGER_MAX) {
    throw new Error("Distinct order count exceeds PostgreSQL integer range");
  }
}

export function calculatePackagingRequirement(
  input: PackagingRequirementInput,
): PackagingRequirementCalculation {
  const ruleQuantity = parseRuleQuantity(input.ruleQuantity);
  requireDistinctOrderCount(input.distinctOrderCount);

  let multiplier: Decimal;
  switch (input.basis) {
    case "PER_PRODUCT_UNIT":
      multiplier = new Decimal(input.plannedOutput);
      break;
    case "PER_ORDER":
    case "PER_DELIVERY":
      multiplier = new Decimal(input.distinctOrderCount);
      break;
    default:
      throw new Error("Unsupported packaging basis");
  }

  return {
    multiplier: multiplier.toString(),
    plannedRequirement: ruleQuantity.mul(multiplier).toString(),
  };
}
