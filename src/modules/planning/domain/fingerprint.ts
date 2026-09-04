import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { PlanningSourceData } from "./types";

const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const DECIMAL_STRING_KEYS: ReadonlySet<string> = new Set([
  "defaultWasteAllowancePercent",
  "baseYieldQuantity",
  "wasteAllowancePercent",
  "quantityInBaseUnit",
  "packBaseQuantity",
]);
const STABLE_ID_KEYS = [
  "id",
  "recipeIngredientId",
  "recipeVersionId",
  "recipeId",
  "packagingRuleId",
  "inventoryItemId",
  "productId",
  "deliveryMethodId",
] as const;

type JsonScalar = string | number | boolean | null;
type CanonicalValue =
  | JsonScalar
  | CanonicalValue[]
  | CanonicalObject;

interface CanonicalObject {
  [key: string]: CanonicalValue;
}

function stableId(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of STABLE_ID_KEYS) {
    if (typeof record[key] === "string") return record[key];
  }
  return null;
}

function canonicalize(value: unknown, key?: string): CanonicalValue {
  if (value === null || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Planning fingerprint cannot serialize non-finite numbers");
    }
    return value;
  }
  if (typeof value === "string") {
    if (!key || !DECIMAL_STRING_KEYS.has(key) || !NUMERIC_STRING.test(value)) {
      return value;
    }
    const numeric = new Decimal(value);
    return numeric.isFinite() ? numeric.toString() : value;
  }
  if (Array.isArray(value)) {
    const ordered = [...value];
    if (ordered.every((item) => stableId(item) !== null)) {
      ordered.sort((left, right) =>
        stableId(left)!.localeCompare(stableId(right)!),
      );
    }
    return ordered.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const result: Record<string, CanonicalValue> = {};
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      if (key === "calculatedAt" || source[key] === undefined) continue;
      result[key] = canonicalize(source[key], key);
    }
    return result;
  }
  throw new Error("Planning fingerprint encountered an unsupported value");
}

function relevantSource(source: PlanningSourceData): Omit<PlanningSourceData, "calculatedAt"> {
  const orders = source.orders.filter(
    (order) => order.fulfillmentStatus !== "CANCELLED",
  );
  const orderedProductIds = new Set(
    orders.flatMap((order) => order.items.map((item) => item.productId)),
  );
  const deliveryMethodIds = new Set(
    orders.flatMap((order) =>
      order.deliveryMethodId === null ? [] : [order.deliveryMethodId],
    ),
  );
  const products = source.products.filter((product) =>
    orderedProductIds.has(product.id),
  );
  const packagingRules = source.packagingRules.filter((rule) =>
    rule.scope === "PRODUCT"
      ? rule.productId !== null && orderedProductIds.has(rule.productId)
      : rule.deliveryMethodId !== null &&
        deliveryMethodIds.has(rule.deliveryMethodId),
  );
  const requiredInventoryItemIds = new Set<string>();
  for (const product of products) {
    for (const ingredient of product.activeRecipe?.ingredients ?? []) {
      requiredInventoryItemIds.add(ingredient.inventoryItemId);
    }
  }
  for (const rule of packagingRules) {
    requiredInventoryItemIds.add(rule.inventoryItemId);
  }

  return {
    cycle: source.cycle,
    settings: source.settings,
    orders,
    products,
    packagingRules,
    inventoryItems: source.inventoryItems.filter((item) =>
      requiredInventoryItemIds.has(item.id),
    ),
  };
}

export function createPlanningFingerprint(source: PlanningSourceData): string {
  const json = JSON.stringify(canonicalize(relevantSource(source)));
  return createHash("sha256").update(json, "utf8").digest("hex");
}
