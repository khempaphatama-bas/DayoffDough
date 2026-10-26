import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { assertNoPendingConsumption, rethrowConsumptionLockError } from "@/modules/consumption/application/count-barrier";
import type { DatabaseClient } from "@/lib/db/types";
import { calculateUnitCostSatang } from "@/modules/inventory/domain/cost";
import {
  inventoryCategory,
  inventoryItems,
  inventoryMovements,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import type { UnitCode } from "@/modules/units/domain/units";

const unitCodes = ["mg", "g", "kg", "ml", "l", "piece"] as const satisfies ReadonlyArray<UnitCode>;

export type InventoryCategory = (typeof inventoryCategory)[number];

export type CreateInventoryItemInput = Readonly<{
  name: string;
  category: InventoryCategory;
  baseUnit: UnitCode;
  purchaseUnitLabel: string;
  baseQuantityPerPurchasePack: string;
  minimumStockQuantity: string;
  notes?: string;
}>;

export type AddInventoryPriceInput = Readonly<{
  packPriceSatang: number;
  packBaseQuantity: string;
  effectiveAt: Date;
  purchasedFrom?: string;
  notes?: string;
}>;

export type InventoryItem = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  category: InventoryCategory;
  baseUnit: UnitCode;
  purchaseUnitLabel: string;
  baseQuantityPerPurchasePack: string;
  minimumStockQuantity: string;
  active: boolean;
  notes: string | null;
}>;

export type InventoryPrice = Readonly<{
  id: string;
  packPriceSatang: number;
  packBaseQuantity: string;
  effectiveAt: Date;
  purchasedFrom: string | null;
  notes: string | null;
}>;

export type InventoryItemDetail = InventoryItem &
  Readonly<{
    stockBalance: string;
    latestPrice: InventoryPrice | null;
    latestUnitCostSatang: Decimal | null;
    priceHistory: ReadonlyArray<InventoryPrice>;
  }>;

const positiveDecimalSchema = z.string().refine(
  (value) => {
    try {
      const amount = new Decimal(value);
      return amount.gt(0) && amount.decimalPlaces() <= 6;
    } catch {
      return false;
    }
  },
  { message: "Expected a positive decimal with up to 6 places" },
);

const nonNegativeDecimalSchema = z.string().refine(
  (value) => {
    try {
      const amount = new Decimal(value);
      return amount.gte(0) && amount.decimalPlaces() <= 6;
    } catch {
      return false;
    }
  },
  { message: "Expected a non-negative decimal with up to 6 places" },
);

const itemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(inventoryCategory),
  baseUnit: z.enum(unitCodes),
  purchaseUnitLabel: z.string().trim().min(1).max(160),
  baseQuantityPerPurchasePack: positiveDecimalSchema,
  minimumStockQuantity: nonNegativeDecimalSchema,
  notes: z.string().trim().max(2000).optional(),
});

const priceSchema = z.object({
  packPriceSatang: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  packBaseQuantity: positiveDecimalSchema,
  effectiveAt: z.date(),
  purchasedFrom: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

function toItem(row: typeof inventoryItems.$inferSelect): InventoryItem {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    category: row.category,
    baseUnit: row.baseUnit as UnitCode,
    purchaseUnitLabel: row.purchaseUnitLabel,
    baseQuantityPerPurchasePack: new Decimal(
      row.baseQuantityPerPurchasePack,
    ).toString(),
    minimumStockQuantity: new Decimal(row.minimumStockQuantity).toString(),
    active: row.active,
    notes: row.notes,
  };
}

function toPrice(row: typeof inventoryPrices.$inferSelect): InventoryPrice {
  return {
    id: row.id,
    packPriceSatang: row.packPriceSatang,
    packBaseQuantity: new Decimal(row.packBaseQuantity).toString(),
    effectiveAt: row.effectiveAt,
    purchasedFrom: row.purchasedFrom,
    notes: row.notes,
  };
}

export function createInventoryService(db: DatabaseClient) {
  async function getItemDetail(
    ownerId: string,
    itemId: string,
    effectiveAt = new Date(),
  ): Promise<InventoryItemDetail> {
    const [itemRow] = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.ownerId, ownerId), eq(inventoryItems.id, itemId)))
      .limit(1);
    if (!itemRow) throw new Error("Inventory item not found");

    const [[balanceRow], priceRows] = await Promise.all([
      db
        .select({
          value: sql<string>`coalesce(sum(${inventoryMovements.quantityDeltaInBaseUnit}), 0)::text`,
        })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.ownerId, ownerId),
            eq(inventoryMovements.inventoryItemId, itemId),
          ),
        ),
      db
        .select()
        .from(inventoryPrices)
        .where(
          and(
            eq(inventoryPrices.ownerId, ownerId),
            eq(inventoryPrices.inventoryItemId, itemId),
          ),
        )
        .orderBy(
          desc(inventoryPrices.effectiveAt),
          desc(inventoryPrices.createdAt),
        ),
    ]);
    const latestPriceRow = priceRows.find(
      (price) => price.effectiveAt <= effectiveAt,
    );

    const latestPrice = latestPriceRow ? toPrice(latestPriceRow) : null;
    return {
      ...toItem(itemRow),
      stockBalance: new Decimal(balanceRow?.value ?? "0").toString(),
      latestPrice,
      latestUnitCostSatang: latestPrice
        ? calculateUnitCostSatang(
            latestPrice.packPriceSatang,
            latestPrice.packBaseQuantity,
          )
        : null,
      priceHistory: priceRows.map(toPrice),
    };
  }

  return {
    async listCatalogItems(
      ownerId: string,
    ): Promise<ReadonlyArray<InventoryItem>> {
      const rows = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.ownerId, ownerId))
        .orderBy(asc(inventoryItems.name));
      return rows.map(toItem);
    },

    async createItem(
      ownerId: string,
      input: CreateInventoryItemInput,
    ): Promise<InventoryItem> {
      const parsed = itemSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid inventory item");
      const [row] = await db
        .insert(inventoryItems)
        .values({
          ownerId,
          ...parsed.data,
          notes: parsed.data.notes ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to create inventory item");
      return toItem(row);
    },

    async addPrice(
      ownerId: string,
      itemId: string,
      input: AddInventoryPriceInput,
    ): Promise<InventoryPrice> {
      const parsed = priceSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid inventory price");
      const [item] = await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.ownerId, ownerId), eq(inventoryItems.id, itemId)))
        .limit(1);
      if (!item) throw new Error("Inventory item not found");
      const [row] = await db
        .insert(inventoryPrices)
        .values({
          ownerId,
          inventoryItemId: itemId,
          packPriceSatang: parsed.data.packPriceSatang,
          packBaseQuantity: parsed.data.packBaseQuantity,
          effectiveAt: parsed.data.effectiveAt,
          purchasedFrom: parsed.data.purchasedFrom ?? null,
          notes: parsed.data.notes ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to add inventory price");
      return toPrice(row);
    },

    async recordCount(
      ownerId: string,
      itemId: string,
      countedQuantity: string,
      occurredAt: Date,
    ) {
      const parsedQuantity = nonNegativeDecimalSchema.safeParse(countedQuantity);
      if (!parsedQuantity.success || Number.isNaN(occurredAt.getTime())) {
        throw new Error("Invalid physical count");
      }
      return db.transaction(async (tx) => {
        const [item] = await lockOwnedInventoryItems(tx, ownerId, [itemId]);
        if (!item) throw new Error("Inventory item not found");
        await assertNoPendingConsumption(tx, ownerId, [itemId]);
        const [balanceRow] = await tx
          .select({
            value: sql<string>`coalesce(sum(${inventoryMovements.quantityDeltaInBaseUnit}), 0)::text`,
          })
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.ownerId, ownerId),
              eq(inventoryMovements.inventoryItemId, itemId),
            ),
          );
        const balance = new Decimal(balanceRow?.value ?? "0");
        const counted = new Decimal(parsedQuantity.data);
        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            ownerId,
            inventoryItemId: itemId,
            type: "COUNT",
            quantityDeltaInBaseUnit: counted.minus(balance).toString(),
            countedQuantityInBaseUnit: counted.toString(),
            occurredAt,
          })
          .returning();
        if (!movement) throw new Error("Failed to record physical count");
        return movement;
      }).catch(rethrowConsumptionLockError);
    },

    async listItems(ownerId: string): Promise<ReadonlyArray<InventoryItemDetail>> {
      const rows = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.ownerId, ownerId))
        .orderBy(asc(inventoryItems.name));
      if (rows.length === 0) return [];

      const itemIds = rows.map((row) => row.id);
      const [balanceRows, priceRows] = await Promise.all([
        db
          .select({
            inventoryItemId: inventoryMovements.inventoryItemId,
            value: sql<string>`coalesce(sum(${inventoryMovements.quantityDeltaInBaseUnit}), 0)::text`,
          })
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.ownerId, ownerId),
              inArray(inventoryMovements.inventoryItemId, itemIds),
            ),
          )
          .groupBy(inventoryMovements.inventoryItemId),
        db
          .select()
          .from(inventoryPrices)
          .where(
            and(
              eq(inventoryPrices.ownerId, ownerId),
              inArray(inventoryPrices.inventoryItemId, itemIds),
            ),
          )
          .orderBy(
            desc(inventoryPrices.effectiveAt),
            desc(inventoryPrices.createdAt),
          ),
      ]);

      const balanceByItemId = new Map(
        balanceRows.map((row) => [row.inventoryItemId, row.value]),
      );
      const pricesByItemId = new Map<
        string,
        Array<typeof inventoryPrices.$inferSelect>
      >();
      for (const price of priceRows) {
        const itemPrices = pricesByItemId.get(price.inventoryItemId) ?? [];
        itemPrices.push(price);
        pricesByItemId.set(price.inventoryItemId, itemPrices);
      }
      const effectiveAt = new Date();

      return rows.map((row) => {
        const prices = pricesByItemId.get(row.id) ?? [];
        const latestPriceRow = prices.find(
          (price) => price.effectiveAt <= effectiveAt,
        );
        const latestPrice = latestPriceRow ? toPrice(latestPriceRow) : null;
        return {
          ...toItem(row),
          stockBalance: new Decimal(
            balanceByItemId.get(row.id) ?? "0",
          ).toString(),
          latestPrice,
          latestUnitCostSatang: latestPrice
            ? calculateUnitCostSatang(
                latestPrice.packPriceSatang,
                latestPrice.packBaseQuantity,
              )
            : null,
          priceHistory: prices.map(toPrice),
        };
      });
    },

    getItemDetail,
  };
}
