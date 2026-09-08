import Decimal from "decimal.js";
import {
  assertNumeric18_6,
  assertPostgreSqlInteger,
  POSTGRESQL_INTEGER_MAX,
} from "./storage";
import type {
  AggregateSnapshotRequirementsInput,
  ShoppingItemProgress,
  ShoppingRecommendation,
  ShoppingRecommendationInput,
  SnapshotRequirementInput,
  StockRequirement,
} from "./types";

const ShoppingDecimal = Decimal.clone({ precision: 64 });
const SAFE_INTEGER_MAX = new ShoppingDecimal(Number.MAX_SAFE_INTEGER);

function parseDecimal(
  value: string,
  label: string,
  accepts: (quantity: Decimal) => boolean,
): Decimal {
  let quantity: Decimal;
  try {
    quantity = new ShoppingDecimal(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (!quantity.isFinite() || !accepts(quantity)) {
    throw new Error(`Invalid ${label}`);
  }
  return quantity;
}

function exactNonNegative(value: string, label: string): Decimal {
  return parseDecimal(value, label, (quantity) => quantity.gte(0));
}

function exactPositive(value: string, label: string): Decimal {
  return parseDecimal(value, label, (quantity) => quantity.gt(0));
}

function canonicalUnitCost(value: string | null): string | null {
  return value === null
    ? null
    : exactNonNegative(value, "unit cost").toString();
}

function sameRequirementIdentity(
  left: StockRequirement,
  right: SnapshotRequirementInput,
  canonicalRightCost: string | null,
): boolean {
  return (
    left.inventoryItemName === right.inventoryItemName &&
    left.inventoryCategory === right.inventoryCategory &&
    left.baseUnit === right.baseUnit &&
    left.priceSnapshotId === right.priceSnapshotId &&
    left.unitCostSatang === canonicalRightCost
  );
}

export function aggregateSnapshotRequirements(
  input: AggregateSnapshotRequirementsInput,
): ReadonlyArray<StockRequirement> {
  const byInventoryItemId = new Map<string, StockRequirement>();

  for (const row of [...input.materials, ...input.packaging]) {
    const planned = exactPositive(
      row.plannedRequirement,
      "planned requirement",
    );
    assertNumeric18_6(planned.toString(), "planned requirement");
    const unitCostSatang = canonicalUnitCost(row.unitCostSatang);
    const existing = byInventoryItemId.get(row.inventoryItemId);
    if (existing) {
      if (!sameRequirementIdentity(existing, row, unitCostSatang)) {
        throw new Error("Planning requirement identity mismatch");
      }
      const requiredQuantity = new ShoppingDecimal(existing.requiredQuantity)
        .plus(planned)
        .toString();
      assertNumeric18_6(requiredQuantity, "planned requirement");
      byInventoryItemId.set(row.inventoryItemId, {
        ...existing,
        requiredQuantity,
      });
      continue;
    }

    byInventoryItemId.set(row.inventoryItemId, {
      inventoryItemId: row.inventoryItemId,
      inventoryItemName: row.inventoryItemName,
      inventoryCategory: row.inventoryCategory,
      baseUnit: row.baseUnit,
      priceSnapshotId: row.priceSnapshotId,
      unitCostSatang,
      requiredQuantity: planned.toString(),
    });
  }

  return [...byInventoryItemId.values()].sort(
    (left, right) =>
      left.inventoryItemName.localeCompare(right.inventoryItemName) ||
      left.inventoryItemId.localeCompare(right.inventoryItemId),
  );
}

export function calculateShoppingRecommendation(
  input: ShoppingRecommendationInput,
): ShoppingRecommendation {
  const required = exactNonNegative(
    input.requiredQuantity,
    "required quantity",
  );
  const counted = exactNonNegative(input.countedQuantity, "counted quantity");
  const pack = exactPositive(input.packBaseQuantity, "pack quantity");
  assertNumeric18_6(required.toString(), "required quantity");
  assertNumeric18_6(counted.toString(), "counted quantity");
  assertNumeric18_6(pack.toString(), "pack quantity");
  const unitCost =
    input.unitCostSatang === null
      ? null
      : exactNonNegative(input.unitCostSatang, "unit cost");
  const shortfall = ShoppingDecimal.max(required.minus(counted), 0);

  if (shortfall.isZero()) {
    return {
      shortfallQuantity: "0",
      suggestedPackCount: 0,
      suggestedPurchaseQuantity: "0",
      estimatedCostSatang: unitCost === null ? null : 0,
    };
  }

  const packs = shortfall.div(pack).ceil();
  const suggestedPackCount = assertPostgreSqlInteger(
    packs.toString(),
    "Suggested pack count",
  );
  if (suggestedPackCount <= 0) throw new Error("Suggested pack count is too large");
  const purchaseQuantity = packs.mul(pack);
  assertNumeric18_6(
    purchaseQuantity.toString(),
    "Suggested purchase quantity",
  );
  let estimatedCostSatang: number | null = null;
  if (unitCost !== null) {
    const roundedEstimate = purchaseQuantity
      .mul(unitCost)
      .toDecimalPlaces(0, ShoppingDecimal.ROUND_HALF_UP);
    if (roundedEstimate.gt(SAFE_INTEGER_MAX)) {
      throw new Error("Estimated cost exceeds safe integer range");
    }
    if (roundedEstimate.gt(POSTGRESQL_INTEGER_MAX)) {
      throw new Error("Estimated cost exceeds PostgreSQL integer range");
    }
    estimatedCostSatang = roundedEstimate.toNumber();
  }

  return {
    shortfallQuantity: shortfall.toString(),
    suggestedPackCount,
    suggestedPurchaseQuantity: purchaseQuantity.toString(),
    estimatedCostSatang,
  };
}

export function calculatePurchaseProgress(
  shortfallQuantity: string,
  purchasedQuantities: ReadonlyArray<string>,
): ShoppingItemProgress {
  const shortfall = exactNonNegative(shortfallQuantity, "shortfall quantity");
  const purchased = purchasedQuantities.reduce(
    (total, quantity) =>
      total.plus(exactNonNegative(quantity, "purchased quantity")),
    new ShoppingDecimal(0),
  );
  const remaining = ShoppingDecimal.max(shortfall.minus(purchased), 0);
  const overage = ShoppingDecimal.max(purchased.minus(shortfall), 0);

  return {
    status: remaining.isZero()
      ? "COMPLETE"
      : purchased.isZero()
        ? "TO_BUY"
        : "PARTIAL",
    purchasedQuantity: purchased.toString(),
    remainingQuantity: remaining.toString(),
    overageQuantity: overage.toString(),
  };
}
