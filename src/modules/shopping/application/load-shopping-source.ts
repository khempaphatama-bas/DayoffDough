import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import {
  cycleInventoryPriceSnapshots,
  cycleMaterialRequirements,
  cyclePackagingRequirements,
} from "@/modules/planning/db/schema";
import { aggregateSnapshotRequirements } from "@/modules/shopping/domain/calculations";
import type {
  SnapshotRequirementInput,
  StockCountCandidate,
  StockRequirementCategory,
  StockRequirement,
} from "@/modules/shopping/domain/types";
import type { UnitCode } from "@/modules/units/domain/units";

type ShoppingSourceReader = Pick<DatabaseClient, "select">;
type PriceSnapshot = typeof cycleInventoryPriceSnapshots.$inferSelect;

function canonicalQuantity(value: string): string {
  return new Decimal(value).toString();
}

function toRequirementInput(
  row: Pick<
    typeof cycleMaterialRequirements.$inferSelect,
    | "inventoryItemId"
    | "inventoryItemName"
    | "baseUnit"
    | "priceSnapshotId"
    | "plannedRequirement"
  >,
  priceByItemId: ReadonlyMap<string, PriceSnapshot>,
): SnapshotRequirementInput {
  const price = priceByItemId.get(row.inventoryItemId);
  if (!price || price.id !== row.priceSnapshotId) {
    throw new Error("Shopping price snapshot missing");
  }
  return {
    inventoryItemId: row.inventoryItemId,
    inventoryItemName: row.inventoryItemName,
    inventoryCategory: price.inventoryCategory as StockRequirementCategory,
    baseUnit: row.baseUnit as UnitCode,
    priceSnapshotId: row.priceSnapshotId,
    unitCostSatang:
      price.unitCostSatang === null
        ? null
        : canonicalQuantity(price.unitCostSatang.toString()),
    plannedRequirement: canonicalQuantity(row.plannedRequirement.toString()),
  };
}

export async function loadSnapshotStockRequirements(
  reader: ShoppingSourceReader,
  ownerId: string,
  planningSnapshotId: string,
): Promise<readonly StockRequirement[]> {
  const [materialRows, packagingRows, priceRows] = await Promise.all([
    reader
      .select()
      .from(cycleMaterialRequirements)
      .where(
        and(
          eq(cycleMaterialRequirements.ownerId, ownerId),
          eq(cycleMaterialRequirements.planningSnapshotId, planningSnapshotId),
        ),
      ),
    reader
      .select()
      .from(cyclePackagingRequirements)
      .where(
        and(
          eq(cyclePackagingRequirements.ownerId, ownerId),
          eq(cyclePackagingRequirements.planningSnapshotId, planningSnapshotId),
        ),
      ),
    reader
      .select()
      .from(cycleInventoryPriceSnapshots)
      .where(
        and(
          eq(cycleInventoryPriceSnapshots.ownerId, ownerId),
          eq(cycleInventoryPriceSnapshots.planningSnapshotId, planningSnapshotId),
        ),
      ),
  ]);

  const priceByItemId = new Map(
    priceRows.map((price) => [price.inventoryItemId, price]),
  );
  return aggregateSnapshotRequirements({
    materials: materialRows.map((row) =>
      toRequirementInput(row, priceByItemId),
    ),
    packaging: packagingRows.map((row) =>
      toRequirementInput(row, priceByItemId),
    ),
  });
}

export async function loadShoppingSource(
  reader: ShoppingSourceReader,
  ownerId: string,
  planningSnapshotId: string,
): Promise<ReadonlyArray<StockCountCandidate>> {
  const requirements = await loadSnapshotStockRequirements(reader, ownerId, planningSnapshotId);
  if (requirements.length === 0) return [];

  const itemIds = requirements.map((row) => row.inventoryItemId);
  const [itemRows, balanceRows] = await Promise.all([
    reader
      .select({
        id: inventoryItems.id,
        purchaseUnitLabel: inventoryItems.purchaseUnitLabel,
        baseQuantityPerPurchasePack: inventoryItems.baseQuantityPerPurchasePack,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.ownerId, ownerId),
          inArray(inventoryItems.id, itemIds),
        ),
      ),
    reader
      .select({
        inventoryItemId: inventoryMovements.inventoryItemId,
        balance: sql<string>`coalesce(sum(${inventoryMovements.quantityDeltaInBaseUnit}), 0)::text`,
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.ownerId, ownerId),
          inArray(inventoryMovements.inventoryItemId, itemIds),
        ),
      )
      .groupBy(inventoryMovements.inventoryItemId),
  ]);
  const itemById = new Map(itemRows.map((item) => [item.id, item]));
  const balanceByItemId = new Map(
    balanceRows.map((row) => [
      row.inventoryItemId,
      canonicalQuantity(row.balance.toString()),
    ]),
  );

  return requirements.map((requirement) => {
    const item = itemById.get(requirement.inventoryItemId);
    if (!item) throw new Error("Shopping inventory profile missing");
    return {
      ...requirement,
      purchaseUnitLabel: item.purchaseUnitLabel,
      baseQuantityPerPurchasePack: canonicalQuantity(
        item.baseQuantityPerPurchasePack.toString(),
      ),
      systemBalance: balanceByItemId.get(requirement.inventoryItemId) ?? "0",
    };
  });
}
