import { confirmUseInputSchema, correctUseInputSchema, settleUseInputSchema } from "./forms";
import type { ConfirmUseInput, CorrectUseInput, SettleUseInput } from "./types";

type JsonValue = null | boolean | string | JsonValue[] | { [key: string]: JsonValue };

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key]!)]));
}

function byInventoryId<T extends { inventoryItemId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => left.inventoryItemId.localeCompare(right.inventoryItemId));
}

export function canonicalizeUseRequest(
  kind: "CONFIRM" | "CORRECT" | "SETTLE",
  input: ConfirmUseInput | CorrectUseInput | SettleUseInput,
): string {
  if (kind === "SETTLE") {
    const parsed = settleUseInputSchema.parse(input);
    return JSON.stringify(sortedJson({
      kind, ...parsed,
      contexts: [...parsed.contexts]
        .sort((left, right) => left.cycleId.localeCompare(right.cycleId) || left.contextId.localeCompare(right.contextId))
        .map((row) => ({ ...row, items: byInventoryId(row.items) })),
      counts: byInventoryId(parsed.counts),
      expectedLedger: byInventoryId(parsed.expectedLedger),
    }));
  }
  const parsed = kind === "CONFIRM" ? confirmUseInputSchema.parse(input) : correctUseInputSchema.parse(input);
  return JSON.stringify(sortedJson({
    kind, ...parsed,
    items: byInventoryId(parsed.items),
    expectedLedger: byInventoryId(parsed.expectedLedger),
  }));
}
