import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/types";
import { lockOwnedInventoryItems, lockOwnedProducts } from "@/lib/db/row-locks";
import { ingredientKinds, type IngredientKind } from "@/modules/inventory/domain/ingredient-kind";
import { inventoryItems } from "@/modules/inventory/db/schema";
import {
  products,
  recipeIngredients,
  recipes,
  recipeVersions,
} from "@/modules/products/db/schema";
import type { UnitCode } from "@/modules/units/domain/units";

const unitCodes = ["mg", "g", "kg", "ml", "l", "piece"] as const satisfies ReadonlyArray<UnitCode>;

const maintenanceMessages = {
  NOT_FOUND: "Recipe version not found",
  ACTIVE_VERSION: "Cannot archive the current recipe version",
  ARCHIVED_VERSION: "Cannot activate an archived recipe version",
  ITEM_UNAVAILABLE: "Recipe ingredient is unavailable",
  ITEM_CHANGED: "Recipe ingredient identity changed; refresh and try again",
  DUPLICATE_VERSION_CODE: "Recipe version code already exists",
} as const;

export class RecipeMaintenanceError extends Error {
  constructor(public readonly code: keyof typeof maintenanceMessages) {
    super(maintenanceMessages[code]);
    this.name = "RecipeMaintenanceError";
  }
}

export type RecipeVersionArchiveSummary = Readonly<{ id: string; versionCode: string }>;

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
    expectedIdentity?: { baseUnit: UnitCode; ingredientKind: IngredientKind };
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
  ingredientKind: IngredientKind;
  itemActive: boolean;
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
  archivedAt: Date | null;
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
        expectedIdentity: z.object({
          baseUnit: z.enum(unitCodes),
          ingredientKind: z.enum(ingredientKinds),
        }).optional(),
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
  async function findOwnedVersion(tx: DatabaseTransaction, ownerId: string, productId: string, versionId: string) {
    const [version] = await tx.select({ version: recipeVersions }).from(recipeVersions)
      .innerJoin(recipes, and(
        eq(recipes.ownerId, recipeVersions.ownerId),
        eq(recipes.id, recipeVersions.recipeId),
      ))
      .where(and(
        eq(recipeVersions.ownerId, ownerId),
        eq(recipeVersions.id, versionId),
        eq(recipes.productId, productId),
      )).limit(1);
    if (!version) throw new RecipeMaintenanceError("NOT_FOUND");
    return version.version;
  }

  async function getProductDetail(
    ownerId: string,
    productId: string,
  ): Promise<ProductDetail> {
    const [[productRow], [recipe]] = await Promise.all([
      db
        .select()
        .from(products)
        .where(and(eq(products.ownerId, ownerId), eq(products.id, productId)))
        .limit(1),
      db
        .select()
        .from(recipes)
        .where(
          and(eq(recipes.ownerId, ownerId), eq(recipes.productId, productId)),
        )
        .limit(1),
    ]);
    if (!productRow) throw new Error("Product not found");
    if (!recipe) throw new Error("Recipe not found");
    const versionRows = await db
      .select()
      .from(recipeVersions)
      .where(
        and(eq(recipeVersions.ownerId, ownerId), eq(recipeVersions.recipeId, recipe.id)),
      )
      .orderBy(desc(recipeVersions.createdAt));
    const versionIds = versionRows.map((version) => version.id);
    const ingredientRows =
      versionIds.length === 0
        ? []
        : await db
          .select({
            recipeVersionId: recipeIngredients.recipeVersionId,
            id: recipeIngredients.id,
            inventoryItemId: recipeIngredients.inventoryItemId,
            inventoryItemName: inventoryItems.name,
            baseUnit: inventoryItems.baseUnit,
            ingredientKind: inventoryItems.ingredientKind,
            itemActive: inventoryItems.active,
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
              inArray(recipeIngredients.recipeVersionId, versionIds),
            ),
          )
          .orderBy(asc(recipeIngredients.createdAt));
    const ingredientsByVersionId = new Map<string, Array<RecipeIngredient>>();
    for (const ingredient of ingredientRows) {
      const versionIngredients =
        ingredientsByVersionId.get(ingredient.recipeVersionId) ?? [];
      versionIngredients.push({
        id: ingredient.id,
        inventoryItemId: ingredient.inventoryItemId,
        inventoryItemName: ingredient.inventoryItemName,
        baseUnit: ingredient.baseUnit as UnitCode,
        ingredientKind: ingredient.ingredientKind,
        itemActive: ingredient.itemActive,
        quantityInBaseUnit: new Decimal(
          ingredient.quantityInBaseUnit,
        ).toString(),
      });
      ingredientsByVersionId.set(
        ingredient.recipeVersionId,
        versionIngredients,
      );
    }
    const versions = versionRows.map(
      (version): RecipeVersion => ({
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
          archivedAt: version.archivedAt,
          ingredients: ingredientsByVersionId.get(version.id) ?? [],
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
    ): Promise<RecipeVersion & { archivedVersions: readonly RecipeVersionArchiveSummary[] }> {
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
        // Serialize recipe maintenance for this product before reading versions.
        const [product] = await lockOwnedProducts(tx, ownerId, [productId]);
        if (!product) throw new RecipeMaintenanceError("NOT_FOUND");
        const [recipe] = await tx
          .select({ id: recipes.id })
          .from(recipes)
          .where(and(eq(recipes.ownerId, ownerId), eq(recipes.productId, productId)))
          .limit(1);
        if (!recipe) throw new RecipeMaintenanceError("NOT_FOUND");

        const uniqueIngredientIds = [
          ...new Set(parsed.data.ingredients.map((item) => item.inventoryItemId)),
        ];
        const ownedItems = await lockOwnedInventoryItems(tx, ownerId, uniqueIngredientIds);
        if (ownedItems.length !== uniqueIngredientIds.length ||
          ownedItems.some((item) => !item.active || item.category !== "INGREDIENT")) {
          throw new RecipeMaintenanceError("ITEM_UNAVAILABLE");
        }
        const itemById = new Map(ownedItems.map((item) => [item.id, item]));
        for (const ingredient of parsed.data.ingredients) {
          const item = itemById.get(ingredient.inventoryItemId)!;
          const expected = ingredient.expectedIdentity;
          if (expected && (expected.baseUnit !== item.baseUnit || expected.ingredientKind !== item.ingredientKind)) {
            throw new RecipeMaintenanceError("ITEM_CHANGED");
          }
        }

        const selectable = await tx.select().from(recipeVersions)
          .where(and(
            eq(recipeVersions.ownerId, ownerId),
            eq(recipeVersions.recipeId, recipe.id),
            isNull(recipeVersions.archivedAt),
          )).orderBy(asc(recipeVersions.createdAt), asc(recipeVersions.id));

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
          .onConflictDoNothing({ target: [recipeVersions.recipeId, recipeVersions.versionCode] })
          .returning();
        if (!version) throw new RecipeMaintenanceError("DUPLICATE_VERSION_CODE");
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
        // Only prior, non-current versions are candidates, even if the new
        // version's timestamp sorts before historical rows.
        const archivedVersions = selectable
          .filter((candidate) => candidate.id !== product.activeRecipeVersionId)
          .slice(0, Math.max(0, selectable.length - 4))
          .map(({ id, versionCode }) => ({ id, versionCode }));
        if (archivedVersions.length > 0) {
          await tx.update(recipeVersions).set({ archivedAt: new Date() })
            .where(and(
              eq(recipeVersions.ownerId, ownerId),
              inArray(recipeVersions.id, archivedVersions.map(({ id }) => id)),
            ));
        }
        const ingredients: RecipeIngredient[] = ingredientRows.map((ingredient) => ({
          id: ingredient.id,
          inventoryItemId: ingredient.inventoryItemId,
          inventoryItemName: itemById.get(ingredient.inventoryItemId)?.name ?? "",
          baseUnit: (itemById.get(ingredient.inventoryItemId)?.baseUnit ??
            "piece") as UnitCode,
          ingredientKind: itemById.get(ingredient.inventoryItemId)!.ingredientKind,
          itemActive: itemById.get(ingredient.inventoryItemId)!.active,
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
          archivedAt: version.archivedAt,
          ingredients,
          archivedVersions,
        };
      }, { isolationLevel: "read committed" });
    },

    async archiveRecipeVersion(
      ownerId: string,
      productId: string,
      versionId: string,
    ): Promise<RecipeVersionArchiveSummary> {
      return db.transaction(async (tx) => {
        const [product] = await lockOwnedProducts(tx, ownerId, [productId]);
        if (!product) throw new RecipeMaintenanceError("NOT_FOUND");
        const version = await findOwnedVersion(tx, ownerId, productId, versionId);
        if (product.activeRecipeVersionId === version.id) {
          throw new RecipeMaintenanceError("ACTIVE_VERSION");
        }
        if (version.archivedAt === null) {
          await tx.update(recipeVersions).set({ archivedAt: new Date() })
            .where(and(eq(recipeVersions.ownerId, ownerId), eq(recipeVersions.id, version.id)));
        }
        return { id: version.id, versionCode: version.versionCode };
      }, { isolationLevel: "read committed" });
    },

    async activateRecipeVersion(
      ownerId: string,
      productId: string,
      versionId: string,
    ): Promise<Product> {
      return db.transaction(async (tx) => {
        const [ownedProduct] = await lockOwnedProducts(tx, ownerId, [productId]);
        if (!ownedProduct) throw new RecipeMaintenanceError("NOT_FOUND");
        const version = await findOwnedVersion(tx, ownerId, productId, versionId);
        if (version.archivedAt !== null) throw new RecipeMaintenanceError("ARCHIVED_VERSION");
        const ingredients = await tx.select().from(recipeIngredients)
          .where(and(
            eq(recipeIngredients.ownerId, ownerId),
            eq(recipeIngredients.recipeVersionId, versionId),
          ));
        const itemIds = [...new Set(ingredients.map((ingredient) => ingredient.inventoryItemId))];
        const items = await lockOwnedInventoryItems(tx, ownerId, itemIds);
        if (items.length !== itemIds.length || items.length === 0 ||
          items.some((item) => !item.active || item.category !== "INGREDIENT")) {
          throw new RecipeMaintenanceError("ITEM_UNAVAILABLE");
        }
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
      }, { isolationLevel: "read committed" });
    },

    async listProducts(ownerId: string): Promise<ReadonlyArray<Product>> {
      const rows = await db
        .select()
        .from(products)
        .where(eq(products.ownerId, ownerId))
        .orderBy(asc(products.name));
      return rows.map(toProduct);
    },

    getProductDetail,
  };
}
