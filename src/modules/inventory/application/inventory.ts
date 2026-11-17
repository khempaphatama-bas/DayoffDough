import Decimal from "decimal.js";
import { and, asc, desc, eq, exists, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedInventoryItems } from "@/lib/db/row-locks";
import { assertNoPendingConsumption, rethrowConsumptionLockError } from "@/modules/consumption/application/count-barrier";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { productPackagingRules } from "@/modules/delivery/db/schema";
import { calculateUnitCostSatang } from "@/modules/inventory/domain/cost";
import { ingredientKinds, isPrepOnly, type IngredientKind } from "@/modules/inventory/domain/ingredient-kind";
import {
  inventoryCategory,
  inventoryItems,
  inventoryMovements,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import {
  cycleInventoryPriceSnapshots,
  cycleMaterialRequirements,
  cyclePackagingRequirements,
  cyclePlanningSnapshots,
  cycleRecipePlans,
} from "@/modules/planning/db/schema";
import { products, recipeIngredients, recipes, recipeVersions } from "@/modules/products/db/schema";
import type { UnitCode } from "@/modules/units/domain/units";

const unitCodes = ["mg", "g", "kg", "ml", "l", "piece"] as const satisfies ReadonlyArray<UnitCode>;

export type InventoryCategory = (typeof inventoryCategory)[number];

const maintenanceMessages = {
  NOT_FOUND: "Inventory item not found",
  IDENTITY_IN_USE: "Inventory item identity is already in use",
  PACK_IN_USE: "Inventory purchase pack is in use by an active plan",
  ACTIVE_RECIPE: "Inventory item is in an active recipe",
  PACKAGING_RULE: "Inventory item is in a packaging rule",
  ACTIVE_PLAN: "Inventory item is in an active plan",
  INACTIVE: "Inventory item is inactive",
  PREP_ONLY: "Inventory item is for preparation only",
  ITEM_CHANGED: "Inventory item unit changed; refresh and try again",
} as const;

export class InventoryMaintenanceError extends Error {
  constructor(public readonly code: keyof typeof maintenanceMessages) {
    super(maintenanceMessages[code]);
    this.name = "InventoryMaintenanceError";
  }
}

export type CreateInventoryItemInput = Readonly<{
  name: string;
  category: InventoryCategory;
  ingredientKind?: IngredientKind;
  baseUnit: UnitCode;
  purchaseUnitLabel?: string;
  baseQuantityPerPurchasePack?: string;
  minimumStockQuantity?: string;
  notes?: string;
}>;

export type AddInventoryPriceInput = Readonly<{
  packPriceSatang: number;
  packBaseQuantity: string;
  effectiveAt: Date;
  expectedBaseUnit?: UnitCode;
  purchasedFrom?: string;
  notes?: string;
}>;

export type InventoryItem = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  category: InventoryCategory;
  ingredientKind: IngredientKind;
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

const itemIdentitySchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(inventoryCategory),
  ingredientKind: z.enum(ingredientKinds).default("STANDARD"),
  baseUnit: z.enum(unitCodes),
  notes: z.string().trim().max(2000).optional(),
});

const itemPackSchema = z.object({
  purchaseUnitLabel: z.string().trim().min(1).max(160),
  baseQuantityPerPurchasePack: positiveDecimalSchema,
  minimumStockQuantity: nonNegativeDecimalSchema,
});

function parseItem(input: CreateInventoryItemInput) {
  const identity = itemIdentitySchema.safeParse(input);
  if (!identity.success) throw new Error("Invalid inventory item");
  const { ingredientKind, category, baseUnit, notes } = identity.data;
  const fields = { ...identity.data, notes: notes ?? null };
  if (isPrepOnly(ingredientKind)) {
    const validUnit = ingredientKind === "WATER"
      ? baseUnit === "ml" || baseUnit === "l"
      : baseUnit === "g" || baseUnit === "kg";
    if (category !== "INGREDIENT" || !validUnit) throw new Error("Invalid inventory item");
    return {
      ...fields,
      purchaseUnitLabel: "ไม่ต้องซื้อ",
      baseQuantityPerPurchasePack: "1",
      minimumStockQuantity: "0",
    };
  }
  const pack = itemPackSchema.safeParse(input);
  if (!pack.success) throw new Error("Invalid inventory item");
  return { ...fields, ...pack.data };
}

const priceSchema = z.object({
  packPriceSatang: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  packBaseQuantity: positiveDecimalSchema,
  effectiveAt: z.date(),
  expectedBaseUnit: z.enum(unitCodes).optional(),
  purchasedFrom: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

function assertActiveOwnedItem(item: typeof inventoryItems.$inferSelect | undefined):
  asserts item is typeof inventoryItems.$inferSelect {
  if (!item) throw new InventoryMaintenanceError("NOT_FOUND");
  if (!item.active) throw new InventoryMaintenanceError("INACTIVE");
}

export function assertStockableInventoryItem(
  item: typeof inventoryItems.$inferSelect | undefined,
  expectedBaseUnit?: UnitCode,
): asserts item is typeof inventoryItems.$inferSelect {
  assertActiveOwnedItem(item);
  if (isPrepOnly(item.ingredientKind)) throw new InventoryMaintenanceError("PREP_ONLY");
  if (expectedBaseUnit !== undefined && item.baseUnit !== expectedBaseUnit) {
    throw new InventoryMaintenanceError("ITEM_CHANGED");
  }
}

function ownedItem(ownerId: string, itemId: string) {
  return and(eq(inventoryItems.ownerId, ownerId), eq(inventoryItems.id, itemId));
}

async function readItemReferences(reader: Pick<DatabaseClient, "select">, ownerId: string, itemId: string) {
  const recipeLineForItem = and(
    eq(recipeIngredients.ownerId, ownerId),
    eq(recipeIngredients.inventoryItemId, itemId),
  );
  const currentSnapshots = reader.select({ id: cyclePlanningSnapshots.id })
    .from(cyclePlanningSnapshots)
    .innerJoin(bakeCycles, and(
      eq(bakeCycles.ownerId, cyclePlanningSnapshots.ownerId),
      eq(bakeCycles.id, cyclePlanningSnapshots.bakeCycleId),
      eq(bakeCycles.activePlanningSnapshotId, cyclePlanningSnapshots.id),
    ))
    .where(and(
      eq(cyclePlanningSnapshots.ownerId, ownerId),
      eq(cyclePlanningSnapshots.status, "ACTIVE"),
      inArray(bakeCycles.status, ["LOCKED", "IN_PRODUCTION"]),
    ));

  // A single read sees one committed view of all reference types. Maintenance
  // callers already hold the item lock; none of these reads lock parent rows.
  const [refs] = await reader.select({
    active: inventoryItems.active,
    recipe: exists(reader.select({ id: recipeIngredients.id }).from(recipeIngredients).where(recipeLineForItem)),
    activeRecipe: exists(reader.select({ id: recipeIngredients.id }).from(recipeIngredients)
      .innerJoin(recipeVersions, and(
        eq(recipeVersions.ownerId, recipeIngredients.ownerId),
        eq(recipeVersions.id, recipeIngredients.recipeVersionId),
      ))
      .innerJoin(recipes, and(eq(recipes.ownerId, recipeVersions.ownerId), eq(recipes.id, recipeVersions.recipeId)))
      .innerJoin(products, and(
        eq(products.ownerId, recipes.ownerId),
        eq(products.id, recipes.productId),
        eq(products.activeRecipeVersionId, recipeVersions.id),
      ))
      .where(recipeLineForItem)),
    packagingRule: exists(reader.select({ id: productPackagingRules.id }).from(productPackagingRules)
      .where(and(eq(productPackagingRules.ownerId, ownerId), eq(productPackagingRules.inventoryItemId, itemId)))),
    price: exists(reader.select({ id: inventoryPrices.id }).from(inventoryPrices)
      .where(and(eq(inventoryPrices.ownerId, ownerId), eq(inventoryPrices.inventoryItemId, itemId)))),
    movement: exists(reader.select({ id: inventoryMovements.id }).from(inventoryMovements)
      .where(and(eq(inventoryMovements.ownerId, ownerId), eq(inventoryMovements.inventoryItemId, itemId)))),
    // Every material and packaging requirement has an owned price snapshot,
    // even when there was no price to copy.
    plan: exists(reader.select({ id: cycleInventoryPriceSnapshots.id }).from(cycleInventoryPriceSnapshots)
      .where(and(eq(cycleInventoryPriceSnapshots.ownerId, ownerId), eq(cycleInventoryPriceSnapshots.inventoryItemId, itemId)))),
    currentMaterial: exists(reader.select({ id: cycleMaterialRequirements.id }).from(cycleMaterialRequirements)
      .where(and(
        eq(cycleMaterialRequirements.ownerId, ownerId),
        eq(cycleMaterialRequirements.inventoryItemId, itemId),
        inArray(cycleMaterialRequirements.planningSnapshotId, currentSnapshots),
      ))),
    currentPackaging: exists(reader.select({ id: cyclePackagingRequirements.id }).from(cyclePackagingRequirements)
      .where(and(
        eq(cyclePackagingRequirements.ownerId, ownerId),
        eq(cyclePackagingRequirements.inventoryItemId, itemId),
        inArray(cyclePackagingRequirements.planningSnapshotId, currentSnapshots),
      ))),
    currentRecipe: exists(reader.select({ id: cycleRecipePlans.id }).from(cycleRecipePlans)
      .innerJoin(recipeIngredients, and(
        eq(recipeIngredients.ownerId, cycleRecipePlans.ownerId),
        eq(recipeIngredients.recipeVersionId, cycleRecipePlans.sourceRecipeVersionId),
      ))
      .where(and(
        eq(cycleRecipePlans.ownerId, ownerId),
        recipeLineForItem,
        inArray(cycleRecipePlans.planningSnapshotId, currentSnapshots),
      ))),
  }).from(inventoryItems).where(ownedItem(ownerId, itemId)).limit(1);

  if (!refs) return null;
  return {
    active: refs.active,
    identityInUse: refs.recipe || refs.packagingRule || refs.price || refs.movement || refs.plan,
    packInUse: refs.currentMaterial || refs.currentPackaging,
    activeRecipe: refs.activeRecipe,
    packagingRule: refs.packagingRule,
    activePlan: refs.currentMaterial || refs.currentPackaging || refs.currentRecipe,
  };
}

function toItem(row: typeof inventoryItems.$inferSelect): InventoryItem {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    category: row.category,
    ingredientKind: row.ingredientKind,
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
      .where(ownedItem(ownerId, itemId))
      .limit(1);
    if (!itemRow) throw new InventoryMaintenanceError("NOT_FOUND");

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
      const values = parseItem(input);
      const [row] = await db
        .insert(inventoryItems)
        .values({ ownerId, ...values })
        .returning();
      if (!row) throw new Error("Failed to create inventory item");
      return toItem(row);
    },

    async getItemEditPolicy(
      ownerId: string,
      itemId: string,
    ): Promise<{ canChangeIdentity: boolean; canChangePack: boolean } | null> {
      const refs = await readItemReferences(db, ownerId, itemId);
      return refs && {
        canChangeIdentity: refs.active && !refs.identityInUse,
        canChangePack: refs.active && !refs.packInUse,
      };
    },

    async updateItem(
      ownerId: string,
      itemId: string,
      input: CreateInventoryItemInput,
    ): Promise<InventoryItem> {
      return db.transaction(async (tx) => {
        const [item] = await lockOwnedInventoryItems(tx, ownerId, [itemId]);
        assertActiveOwnedItem(item);
        const values = parseItem(input);
        const identityChanged = item.baseUnit !== values.baseUnit ||
          item.category !== values.category || item.ingredientKind !== values.ingredientKind;
        const packChanged = item.purchaseUnitLabel !== values.purchaseUnitLabel ||
          !new Decimal(item.baseQuantityPerPurchasePack).eq(values.baseQuantityPerPurchasePack);

        if (identityChanged || packChanged) {
          const refs = await readItemReferences(tx, ownerId, itemId);
          if (!refs) throw new InventoryMaintenanceError("NOT_FOUND");
          if (identityChanged && refs.identityInUse) throw new InventoryMaintenanceError("IDENTITY_IN_USE");
          if (packChanged && refs.packInUse) throw new InventoryMaintenanceError("PACK_IN_USE");
        }

        const [row] = await tx.update(inventoryItems).set({ ...values, updatedAt: new Date() })
          .where(ownedItem(ownerId, itemId)).returning();
        if (!row) throw new InventoryMaintenanceError("NOT_FOUND");
        return toItem(row);
      }, { isolationLevel: "read committed" });
    },

    async archiveItem(ownerId: string, itemId: string): Promise<InventoryItem> {
      return db.transaction(async (tx) => {
        const [item] = await lockOwnedInventoryItems(tx, ownerId, [itemId]);
        assertActiveOwnedItem(item);
        const refs = await readItemReferences(tx, ownerId, itemId);
        if (!refs) throw new InventoryMaintenanceError("NOT_FOUND");
        if (refs.activeRecipe) throw new InventoryMaintenanceError("ACTIVE_RECIPE");
        if (refs.packagingRule) throw new InventoryMaintenanceError("PACKAGING_RULE");
        if (refs.activePlan) throw new InventoryMaintenanceError("ACTIVE_PLAN");

        const [row] = await tx.update(inventoryItems).set({ active: false, updatedAt: new Date() })
          .where(ownedItem(ownerId, itemId)).returning();
        if (!row) throw new InventoryMaintenanceError("NOT_FOUND");
        return toItem(row);
      }, { isolationLevel: "read committed" });
    },

    async addPrice(
      ownerId: string,
      itemId: string,
      input: AddInventoryPriceInput,
    ): Promise<InventoryPrice> {
      const parsed = priceSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid inventory price");
      return db.transaction(async (tx) => {
        const [item] = await lockOwnedInventoryItems(tx, ownerId, [itemId]);
        assertStockableInventoryItem(item, parsed.data.expectedBaseUnit);
        const [row] = await tx
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
      }, { isolationLevel: "read committed" });
    },

    async recordCount(
      ownerId: string,
      itemId: string,
      countedQuantity: string,
      occurredAt: Date,
      expectedBaseUnit?: UnitCode,
    ) {
      const parsedQuantity = nonNegativeDecimalSchema.safeParse(countedQuantity);
      if (!parsedQuantity.success || Number.isNaN(occurredAt.getTime())) {
        throw new Error("Invalid physical count");
      }
      return db.transaction(async (tx) => {
        const [item] = await lockOwnedInventoryItems(tx, ownerId, [itemId]);
        assertStockableInventoryItem(item, expectedBaseUnit);
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
      }, { isolationLevel: "read committed" }).catch(rethrowConsumptionLockError);
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
