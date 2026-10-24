import Decimal from "decimal.js";
import { assertNumeric18_6 } from "@/modules/shopping/domain/storage";
import { ConsumptionStateError, type StockEffectMode } from "./types";

const ConsumptionDecimal = Decimal.clone({ precision: 64 });
const QUANTITY = /^(?:\d+|\d*\.\d{1,6})$/;

export function canonicalQuantity(value: string): string {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new ConsumptionStateError("INVALID_INPUT", "Invalid consumption quantity");
  }
  try {
    return new ConsumptionDecimal(assertNumeric18_6(value, "Consumption quantity")).toFixed();
  } catch {
    throw new ConsumptionStateError("INVALID_INPUT", "Invalid consumption quantity");
  }
}

export function calculateUseEffect(input: Readonly<{
  previousUsed: string | null;
  newUsed: string;
  initialCountMovementId: string | null;
  currentCountMovementId: string | null;
  countSettled: boolean;
}>): Readonly<{ mode: StockEffectMode; delta: string }> {
  const previous = new ConsumptionDecimal(canonicalQuantity(input.previousUsed ?? "0"));
  const next = new ConsumptionDecimal(canonicalQuantity(input.newUsed));
  if (input.countSettled) return { mode: "COUNT_SETTLED", delta: "0" };
  if (input.previousUsed !== null && input.initialCountMovementId !== input.currentCountMovementId) {
    return { mode: "HISTORY_ONLY", delta: "0" };
  }
  return { mode: "DIRECT", delta: previous.minus(next).toFixed() };
}
