import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { inventoryItems } from "@/modules/inventory/db/schema";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import type { UnitCode } from "@/modules/units/domain/units";

const unitCodes = ["mg", "g", "kg", "ml", "l", "piece"] as const satisfies ReadonlyArray<UnitCode>;

export type CreateProductInput = Readonly<{
  name: string;
  sellingUnit: UnitCode;
  defaultUnitPriceSatang: number;
  notes?: string;
}>;

export type CreateRecipeVersionInput = Readonly<{
  versionCode: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string | null;
  ingredients: ReadonlyArray<{
    inventoryItemId: string;
    quantityInBaseUnit: string;
  }>;
  instructions: string;
}>;

export type Product = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  sellingUnit: UnitCode;
  defaultUnitPriceSatang: number;
  activeRecipeVersionId: string | null;
  active: boolean;
  notes: string | null;
}>;

export type RecipeIngredient = Readonly<{
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  baseUnit: UnitCode;
  quantityInBaseUnit: string;
}>;

export type RecipeVersion = Readonly<{
  id: string;
  versionCode: string;
  baseYieldQuantity: string;
  yieldUnit: UnitCode;
  laborMinutesPerBatch: number;
  utilityCostSatangPerBatch: number;
  wasteAllowancePercent: string | null;
  instructions: string;
  activeFrom: Date | null;
  ingredients: ReadonlyArray<RecipeIngredient>;
}>;

export type ProductDetail = Product &
  Readonly<{
    recipeId: string;
    versions: ReadonlyArray<RecipeVersion>;
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

const percentageSchema = z.string().refine(
  (value) => {
    try {
      const amount = new Decimal(value);
      return amount.gte(0) && amount.lte(100) && amount.decimalPlaces() <= 4;
    } catch {
      return false;
    }
  },
  { message: "Expected a percentage from 0 to 100" },
);

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sellingUnit: z.enum(unitCodes),
  defaultUnitPriceSatang: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER),
  notes: z.string().trim().max(2000).optional(),
});

const recipeVersionSchema = z.object({
  versionCode: z.string().trim().min(1).max(80),
  baseYieldQuantity: positiveDecimalSchema,
  yieldUnit: z.enum(unitCodes),
  laborMinutesPerBatch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  utilityCostSatangPerBatch: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER),
  wasteAllowancePercent: z.union([percentageSchema, z.null()]),
  ingredients: z
    .array(
      z.object({
        inventoryItemId: z.string().uuid(),
        quantityInBaseUnit: positiveDecimalSchema,
      }),
    )
    .min(1),
  instructions: z.string().trim().max(20000),
});

function toProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    sellingUnit: row.sellingUnit as UnitCode,
    defaultUnitPriceSatang: row.defaultUnitPriceSatang,
    activeRecipeVersionId: row.activeRecipeVersionId,
    active: row.active,
    notes: row.notes,
  };
}

export function createProductService(db: DatabaseClient) {
  async function getProductDetail(
    ownerId: string,
    productId: string,
  ): Promise<ProductDetail> {
    const [productRow] = await db
      .select()
      .from(products)
      .where(and(eq(products.ownerId, ownerId), eq(products.id, productId)))
      .limit(1);
    if (!productRow) throw new Error("Product not found");
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.ownerId, ownerId), eq(recipes.productId, productId)))
      .limit(1);
    if (!recipe) throw new Error("Recipe not found");
    const versionRows = await db
      .select()
      .from(recipeVersions)
      .where(
        and(eq(recipeVersions.ownerId, ownerId), eq(recipeVersions.recipeId, recipe.id)),
      )
      .orderBy(desc(recipeVersions.createdAt));
    const versions = await Promise.all(
      versionRows.map(async (version): Promise<RecipeVersion> => {
        const ingredientRows = await db
          .select({
            id: recipeIngredients.id,
            inventoryItemId: recipeIngredients.inventoryItemId,
            inventoryItemName: inventoryItems.name,
            baseUnit: inventoryItems.baseUnit,
            quantityInBaseUnit: recipeIngredients.quantityInBaseUnit,
          })
          .from(recipeIngredients)
          .innerJoin(
            inventoryItems,
            and(
              eq(inventoryItems.ownerId, recipeIngredients.ownerId),
              eq(inventoryItems.id, recipeIngredients.inventoryItemId),
            ),
          )
          .where(
            and(
              eq(recipeIngredients.ownerId, ownerId),
              eq(recipeIngredients.recipeVersionId, version.id),
            ),
          )
          .orderBy(asc(recipeIngredients.createdAt));
        return {
          id: version.id,
          versionCode: version.versionCode,
          baseYieldQuantity: new Decimal(version.baseYieldQuantity).toString(),
          yieldUnit: version.yieldUnit as UnitCode,
          laborMinutesPerBatch: version.laborMinutesPerBatch,
          utilityCostSatangPerBatch: version.utilityCostSatangPerBatch,
          wasteAllowancePercent: version.wasteAllowancePercent
            ? new Decimal(version.wasteAllowancePercent).toString()
            : null,
          instructions: version.instructions,
          activeFrom: version.activeFrom,
          ingredients: ingredientRows.map((ingredient) => ({
            id: ingredient.id,
            inventoryItemId: ingredient.inventoryItemId,
            inventoryItemName: ingredient.inventoryItemName,
            baseUnit: ingredient.baseUnit as UnitCode,
            quantityInBaseUnit: new Decimal(
              ingredient.quantityInBaseUnit,
            ).toString(),
          })),
        };
      }),
    );
    return { ...toProduct(productRow), recipeId: recipe.id, versions };
  }

  return {
    async createProduct(ownerId: string, input: CreateProductInput): Promise<Product> {
      const parsed = productSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid product");
      return db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            ownerId,
            ...parsed.data,
            notes: parsed.data.notes ?? null,
          })
          .returning();
        if (!product) throw new Error("Failed to create product");
        await tx.insert(recipes).values({
          ownerId,
          productId: product.id,
          name: `${product.name} recipe`,
        });
        return toProduct(product);
      });
    },

    async createRecipeVersion(
      ownerId: string,
      productId: string,
      input: CreateRecipeVersionInput,
    ): Promise<RecipeVersion> {
      try {
        if (new Decimal(input.baseYieldQuantity).lte(0)) {
          throw new Error("Base yield must be greater than zero");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "Base yield must be greater than zero") {
          throw error;
        }
        throw new Error("Base yield must be greater than zero");
      }
      const parsed = recipeVersionSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid recipe version");

      return db.transaction(async (tx) => {
        const [recipe] = await tx
          .select({ id: recipes.id })
          .from(recipes)
          .where(and(eq(recipes.ownerId, ownerId), eq(recipes.productId, productId)))
          .limit(1);
        if (!recipe) throw new Error("Product not found");

        const uniqueIngredientIds = [
          ...new Set(parsed.data.ingredients.map((item) => item.inventoryItemId)),
        ];
        const ownedItems = await tx
          .select({
            id: inventoryItems.id,
            category: inventoryItems.category,
            name: inventoryItems.name,
            baseUnit: inventoryItems.baseUnit,
          })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.ownerId, ownerId),
              inArray(inventoryItems.id, uniqueIngredientIds),
            ),
          );
        if (ownedItems.length !== uniqueIngredientIds.length) {
          throw new Error("Ingredient not found");
        }
        if (ownedItems.some((item) => item.category !== "INGREDIENT")) {
          throw new Error("Ingredient must be INGREDIENT");
        }

        const [version] = await tx
          .insert(recipeVersions)
          .values({
            ownerId,
            recipeId: recipe.id,
            versionCode: parsed.data.versionCode,
            baseYieldQuantity: parsed.data.baseYieldQuantity,
            yieldUnit: parsed.data.yieldUnit,
            laborMinutesPerBatch: parsed.data.laborMinutesPerBatch,
            utilityCostSatangPerBatch: parsed.data.utilityCostSatangPerBatch,
            wasteAllowancePercent: parsed.data.wasteAllowancePercent,
            instructions: parsed.data.instructions,
          })
          .returning();
        if (!version) throw new Error("Failed to create recipe version");
        const ingredientRows = await tx
          .insert(recipeIngredients)
          .values(
            parsed.data.ingredients.map((ingredient) => ({
              ownerId,
              recipeVersionId: version.id,
              inventoryItemId: ingredient.inventoryItemId,
              quantityInBaseUnit: ingredient.quantityInBaseUnit,
            })),
          )
          .returning();
        const itemById = new Map(ownedItems.map((item) => [item.id, item]));
        const ingredients: RecipeIngredient[] = ingredientRows.map((ingredient) => ({
          id: ingredient.id,
          inventoryItemId: ingredient.inventoryItemId,
          inventoryItemName: itemById.get(ingredient.inventoryItemId)?.name ?? "",
          baseUnit: (itemById.get(ingredient.inventoryItemId)?.baseUnit ??
            "piece") as UnitCode,
          quantityInBaseUnit: new Decimal(ingredient.quantityInBaseUnit).toString(),
        }));
        return {
          id: version.id,
          versionCode: version.versionCode,
          baseYieldQuantity: new Decimal(version.baseYieldQuantity).toString(),
          yieldUnit: version.yieldUnit as UnitCode,
          laborMinutesPerBatch: version.laborMinutesPerBatch,
          utilityCostSatangPerBatch: version.utilityCostSatangPerBatch,
          wasteAllowancePercent: version.wasteAllowancePercent
            ? new Decimal(version.wasteAllowancePercent).toString()
            : null,
          instructions: version.instructions,
          activeFrom: version.activeFrom,
          ingredients,
        };
      });
    },

    async activateRecipeVersion(
      ownerId: string,
      productId: string,
      versionId: string,
    ): Promise<Product> {
      return db.transaction(async (tx) => {
        const [version] = await tx
          .select({ id: recipeVersions.id })
          .from(recipeVersions)
          .innerJoin(
            recipes,
            and(
              eq(recipes.ownerId, recipeVersions.ownerId),
              eq(recipes.id, recipeVersions.recipeId),
            ),
          )
          .where(
            and(
              eq(recipeVersions.ownerId, ownerId),
              eq(recipeVersions.id, versionId),
              eq(recipes.productId, productId),
            ),
          )
          .limit(1);
        if (!version) throw new Error("Recipe version not found");
        const now = new Date();
        await tx
          .update(recipeVersions)
          .set({ activeFrom: now })
          .where(
            and(
              eq(recipeVersions.ownerId, ownerId),
              eq(recipeVersions.id, versionId),
            ),
          );
        const [product] = await tx
          .update(products)
          .set({ activeRecipeVersionId: versionId, updatedAt: now })
          .where(and(eq(products.ownerId, ownerId), eq(products.id, productId)))
          .returning();
        if (!product) throw new Error("Product not found");
        return toProduct(product);
      });
    },

    async listProducts(ownerId: string): Promise<ReadonlyArray<ProductDetail>> {
      const rows = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.ownerId, ownerId))
        .orderBy(asc(products.name));
      return Promise.all(rows.map((row) => getProductDetail(ownerId, row.id)));
    },

    getProductDetail,
  };
}
