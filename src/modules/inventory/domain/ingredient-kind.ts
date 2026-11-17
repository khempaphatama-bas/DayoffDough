export const ingredientKinds = ["STANDARD", "WATER", "ICE"] as const;

export type IngredientKind = (typeof ingredientKinds)[number];

export function isPrepOnly(kind: IngredientKind): boolean {
  return kind !== "STANDARD";
}
