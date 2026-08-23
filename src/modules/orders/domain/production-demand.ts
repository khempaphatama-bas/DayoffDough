import type { UnitCode } from "@/modules/units/domain/units";

export type ProductionDemandLine = Readonly<{
  productId: string;
  productName: string;
  sellingUnit: UnitCode;
  quantity: number;
  fulfillmentStatus:
    | "NEW"
    | "CONFIRMED"
    | "IN_PRODUCTION"
    | "PACKED"
    | "DELIVERED"
    | "CANCELLED";
}>;

export type ProductDemand = Readonly<{
  productId: string;
  productName: string;
  sellingUnit: UnitCode;
  quantity: number;
}>;

type MutableProductDemand = {
  productId: string;
  productName: string;
  sellingUnit: UnitCode;
  quantity: number;
};

function requirePositiveQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive safe integer");
  }
}

export function aggregateProductionDemand(
  lines: ReadonlyArray<ProductionDemandLine>,
): ReadonlyArray<ProductDemand> {
  const demandByProduct = new Map<string, MutableProductDemand>();

  for (const line of lines) {
    requirePositiveQuantity(line.quantity);
    if (line.fulfillmentStatus === "CANCELLED") {
      continue;
    }

    const existing = demandByProduct.get(line.productId);
    if (existing) {
      const quantity = existing.quantity + line.quantity;
      if (!Number.isSafeInteger(quantity)) {
        throw new Error("Production demand exceeds the safe integer range");
      }
      existing.quantity = quantity;
      continue;
    }

    demandByProduct.set(line.productId, {
      productId: line.productId,
      productName: line.productName,
      sellingUnit: line.sellingUnit,
      quantity: line.quantity,
    });
  }

  return Array.from(demandByProduct.values()).sort((left, right) =>
    left.productName.localeCompare(right.productName, "th"),
  );
}
