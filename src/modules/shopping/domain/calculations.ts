import Decimal from "decimal.js";
import type {
  AggregateSnapshotRequirementsInput,
  ShoppingItemProgress,
  ShoppingRecommendation,
  ShoppingRecommendationInput,
  SnapshotRequirementInput,
  StockRequirement,
} from "./types";

function parseDecimal(
  value: string,
  label: string,
  accepts: (quantity: Decimal) => boolean,
): Decimal {
  let quantity: Decimal;
  try {
    quantity = new Decimal(value);
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
    const unitCostSatang = canonicalUnitCost(row.unitCostSatang);
    const existing = byInventoryItemId.get(row.inventoryItemId);
    if (existing) {
      if (!sameRequirementIdentity(existing, row, unitCostSatang)) {
        throw new Error("Planning requirement identity mismatch");
      }
      byInventoryItemId.set(row.inventoryItemId, {
        ...existing,
        requiredQuantity: new Decimal(existing.requiredQuantity)
          .plus(planned)
          .toString(),
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
  const unitCost =
    input.unitCostSatang === null
      ? null
      : exactNonNegative(input.unitCostSatang, "unit cost");
  const shortfall = Decimal.max(required.minus(counted), 0);

  if (shortfall.isZero()) {
    return {
      shortfallQuantity: "0",
      suggestedPackCount: 0,
      suggestedPurchaseQuantity: "0",
      estimatedCostSatang: unitCost === null ? null : 0,
    };
  }

  const packs = shortfall.div(pack).ceil();
  if (!packs.isInteger() || packs.gt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Suggested pack count is too large");
  }
  const purchaseQuantity = packs.mul(pack);
  const estimatedCostSatang =
    unitCost === null
      ? null
      : purchaseQuantity
          .mul(unitCost)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();

  return {
    shortfallQuantity: shortfall.toString(),
    suggestedPackCount: packs.toNumber(),
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
    new Decimal(0),
  );
  const remaining = Decimal.max(shortfall.minus(purchased), 0);
  const overage = Decimal.max(purchased.minus(shortfall), 0);

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
