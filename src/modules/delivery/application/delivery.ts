import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedInventoryItems, lockOwnedProducts } from "@/lib/db/row-locks";
import type { DatabaseClient } from "@/lib/db/types";
import {
  deliveryMethods,
  packagingConsumptionBasis,
  packagingRuleScope,
  productPackagingRules,
} from "@/modules/delivery/db/schema";
import { inventoryItems } from "@/modules/inventory/db/schema";
import { assertStockableInventoryItem } from "@/modules/inventory/application/inventory";
import { products } from "@/modules/products/db/schema";

export const VALID_PACKAGING_COMBINATIONS = [
  ["PRODUCT", "PER_PRODUCT_UNIT"],
  ["PRODUCT", "PER_ORDER"],
  ["DELIVERY_METHOD", "PER_DELIVERY"],
] as const;

export type PackagingRuleScope = (typeof packagingRuleScope)[number];
export type PackagingConsumptionBasis =
  (typeof packagingConsumptionBasis)[number];

export type DeliveryMethodInput = Readonly<{
  name: string;
  defaultCustomerFeeSatang: number;
  defaultInternalCostSatang: number;
  requiresDeliveryLocation: boolean;
  notes?: string;
}>;

export type PackagingRuleInput = Readonly<{
  scope: PackagingRuleScope;
  productId: string | null;
  deliveryMethodId: string | null;
  inventoryItemId: string;
  consumptionBasis: PackagingConsumptionBasis;
  quantityInBaseUnit: string;
  notes?: string;
}>;

export type DeliveryMethod = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  defaultCustomerFeeSatang: number;
  defaultInternalCostSatang: number;
  requiresDeliveryLocation: boolean;
  active: boolean;
  notes: string | null;
}>;

export type PackagingRule = Readonly<{
  id: string;
  ownerId: string;
  scope: PackagingRuleScope;
  productId: string | null;
  deliveryMethodId: string | null;
  inventoryItemId: string;
  consumptionBasis: PackagingConsumptionBasis;
  quantityInBaseUnit: string;
  notes: string | null;
}>;

export type DeliveryConfiguration = Readonly<{
  methods: ReadonlyArray<DeliveryMethod>;
  rules: ReadonlyArray<
    PackagingRule &
      Readonly<{
        targetName: string;
        inventoryItemName: string;
        inventoryBaseUnit: string;
      }>
  >;
}>;

const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const methodSchema = z.object({
  name: z.string().trim().min(1).max(160),
  defaultCustomerFeeSatang: moneySchema,
  defaultInternalCostSatang: moneySchema,
  requiresDeliveryLocation: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
});

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

const ruleSchema = z.object({
  scope: z.enum(packagingRuleScope),
  productId: z.string().uuid().nullable(),
  deliveryMethodId: z.string().uuid().nullable(),
  inventoryItemId: z.string().uuid(),
  consumptionBasis: z.enum(packagingConsumptionBasis),
  quantityInBaseUnit: positiveDecimalSchema,
  notes: z.string().trim().max(2000).optional(),
});

function toMethod(row: typeof deliveryMethods.$inferSelect): DeliveryMethod {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    defaultCustomerFeeSatang: row.defaultCustomerFeeSatang,
    defaultInternalCostSatang: row.defaultInternalCostSatang,
    requiresDeliveryLocation: row.requiresDeliveryLocation,
    active: row.active,
    notes: row.notes,
  };
}

function toRule(row: typeof productPackagingRules.$inferSelect): PackagingRule {
  return {
    id: row.id,
    ownerId: row.ownerId,
    scope: row.scope,
    productId: row.productId,
    deliveryMethodId: row.deliveryMethodId,
    inventoryItemId: row.inventoryItemId,
    consumptionBasis: row.consumptionBasis,
    quantityInBaseUnit: new Decimal(row.quantityInBaseUnit).toString(),
    notes: row.notes,
  };
}

function isValidCombination(
  scope: PackagingRuleScope,
  basis: PackagingConsumptionBasis,
): boolean {
  return VALID_PACKAGING_COMBINATIONS.some(
    ([validScope, validBasis]) => validScope === scope && validBasis === basis,
  );
}

export function createDeliveryService(db: DatabaseClient) {
  return {
    async createMethod(
      ownerId: string,
      input: DeliveryMethodInput,
    ): Promise<DeliveryMethod> {
      const parsed = methodSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid delivery method");
      const [row] = await db
        .insert(deliveryMethods)
        .values({ ownerId, ...parsed.data, notes: parsed.data.notes ?? null })
        .returning();
      if (!row) throw new Error("Failed to create delivery method");
      return toMethod(row);
    },

    async updateMethod(
      ownerId: string,
      methodId: string,
      input: DeliveryMethodInput & Readonly<{ active: boolean }>,
    ): Promise<DeliveryMethod> {
      const parsed = methodSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid delivery method");
      const [row] = await db
        .update(deliveryMethods)
        .set({
          ...parsed.data,
          active: input.active,
          notes: parsed.data.notes ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(deliveryMethods.ownerId, ownerId), eq(deliveryMethods.id, methodId)),
        )
        .returning();
      if (!row) throw new Error("Delivery method not found");
      return toMethod(row);
    },

    async createPackagingRule(
      ownerId: string,
      input: PackagingRuleInput,
    ): Promise<PackagingRule> {
      if (
        !isValidCombination(input.scope, input.consumptionBasis) ||
        (input.scope === "PRODUCT" &&
          (input.productId === null || input.deliveryMethodId !== null)) ||
        (input.scope === "DELIVERY_METHOD" &&
          (input.productId !== null || input.deliveryMethodId === null))
      ) {
        throw new Error("Invalid packaging rule combination");
      }
      const parsed = ruleSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid packaging rule");

      return db.transaction(async (tx) => {
        // Validate/lock the parent first, in the same order as catalog and plan writers.
        if (parsed.data.scope === "PRODUCT") {
          const [product] = await lockOwnedProducts(tx, ownerId, [parsed.data.productId!]);
          if (!product) throw new Error("Product not found");
        } else {
          const [method] = await tx
            .select({ id: deliveryMethods.id })
            .from(deliveryMethods)
            .where(and(
              eq(deliveryMethods.ownerId, ownerId),
              eq(deliveryMethods.id, parsed.data.deliveryMethodId!),
            ))
            .limit(1)
            .for("key share");
          if (!method) throw new Error("Delivery method not found");
        }

        const [packagingItem] = await lockOwnedInventoryItems(tx, ownerId, [parsed.data.inventoryItemId]);
        assertStockableInventoryItem(packagingItem);
        if (packagingItem.category === "INGREDIENT") {
          throw new Error("Packaging item must be PACKAGING or CONSUMABLE");
        }

        const [row] = await tx
          .insert(productPackagingRules)
          .values({ ownerId, ...parsed.data, notes: parsed.data.notes ?? null })
          .returning();
        if (!row) throw new Error("Failed to create packaging rule");
        return toRule(row);
      }, { isolationLevel: "read committed" });
    },

    async listDeliveryConfiguration(ownerId: string): Promise<DeliveryConfiguration> {
      const [methodRows, ruleRows, productRows, itemRows] = await Promise.all([
        db
          .select()
          .from(deliveryMethods)
          .where(eq(deliveryMethods.ownerId, ownerId))
          .orderBy(asc(deliveryMethods.name)),
        db
          .select()
          .from(productPackagingRules)
          .where(eq(productPackagingRules.ownerId, ownerId))
          .orderBy(asc(productPackagingRules.createdAt)),
        db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.ownerId, ownerId)),
        db
          .select({
            id: inventoryItems.id,
            name: inventoryItems.name,
            baseUnit: inventoryItems.baseUnit,
          })
          .from(inventoryItems)
          .where(eq(inventoryItems.ownerId, ownerId)),
      ]);
      const productById = new Map(productRows.map((product) => [product.id, product.name]));
      const methodById = new Map(methodRows.map((method) => [method.id, method.name]));
      const itemById = new Map(itemRows.map((item) => [item.id, item]));
      return {
        methods: methodRows.map(toMethod),
        rules: ruleRows.map((row) => {
          const rule = toRule(row);
          const item = itemById.get(rule.inventoryItemId);
          return {
            ...rule,
            targetName:
              rule.scope === "PRODUCT"
                ? productById.get(rule.productId ?? "") ?? "Unknown product"
                : methodById.get(rule.deliveryMethodId ?? "") ??
                  "Unknown delivery method",
            inventoryItemName: item?.name ?? "Unknown packaging item",
            inventoryBaseUnit: item?.baseUnit ?? "piece",
          };
        }),
      };
    },
  };
}
