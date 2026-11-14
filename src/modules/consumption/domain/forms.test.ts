import { describe, expect, it } from "vitest";
import { confirmUseInputSchema, correctUseInputSchema, settleUseInputSchema } from "./forms";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const item = { inventoryItemId: id(4), usedQuantity: "01.000000", basis: "PLANNED", reason: null };
const source = { cycleId: id(1), planningSnapshotId: id(2), contextId: id(3) };
const ledger = { inventoryItemId: id(4), ledgerRevision: "0001", countMovementId: null };
const confirm = { ...source, requestId: id(5), items: [item], expectedLedger: [ledger], confirmTakenOutOfUse: true, confirmEmpty: false, reason: null };
const correct = { ...source, requestId: id(5), items: [item], expectedLedger: [ledger], expectedRevisionId: id(6), reason: "  corrected amount  " };
const context = { ...source, items: [item], confirmTakenOutOfUse: true };
const settle = { requestId: id(5), contexts: [context], counts: [{ inventoryItemId: id(4), remainingQuantity: "02.000000" }], expectedLedger: [ledger], reason: "  counted again  " };

describe("consumption input boundaries", () => {
  it("rejects mixed-case UUID duplicates for use items and settlement counts and contexts", () => {
    const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const upper = lower.toUpperCase();
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, inventoryItemId: lower }, { ...item, inventoryItemId: upper }] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, counts: [{ inventoryItemId: lower, remainingQuantity: "1" }, { inventoryItemId: upper, remainingQuantity: "2" }] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, contexts: [{ ...context, contextId: lower }, { ...context, cycleId: id(9), contextId: upper }] }).success).toBe(false);
  });
  it("rejects client-supplied authority and stock-effect fields at every object boundary", () => {
    expect(confirmUseInputSchema.safeParse({ ...confirm, ownerId: id(9) }).success).toBe(false);
    expect(correctUseInputSchema.safeParse({ ...correct, mode: "DIRECT" }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, delta: "100" }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, policy: "LEGACY" }] }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...confirm, expectedLedger: [{ ...ledger, ownerId: id(9) }] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, contexts: [{ ...context, mode: "HISTORY_ONLY" }] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, counts: [{ ...settle.counts[0], delta: "100" }] }).success).toBe(false);
  });
  it("normalizes exact quantities and integer revisions without changing planned basis", () => {
    const parsed = confirmUseInputSchema.parse(confirm);
    expect(parsed.items).toEqual([{ ...item, usedQuantity: "1" }]);
    expect(parsed.expectedLedger).toEqual([{ ...ledger, ledgerRevision: "1" }]);
    expect(parsed.reason).toBeNull();
  });
  it("trims reasons while preserving explicit owner-reported basis", () => {
    const parsed = correctUseInputSchema.parse({ ...correct, items: [{ ...item, basis: "OWNER_REPORTED", reason: "  weighed leftovers  " }] });
    expect(parsed.reason).toBe("corrected amount");
    expect(parsed.items[0]).toEqual({ ...item, usedQuantity: "1", basis: "OWNER_REPORTED", reason: "weighed leftovers" });
    expect(settleUseInputSchema.parse(settle).counts[0]?.remainingQuantity).toBe("2");
  });
  it("accepts owner-reported nonzero quantities without an exception reason", () => {
    expect(confirmUseInputSchema.parse({ ...confirm, items: [{ ...item, basis: "OWNER_REPORTED" }] }).items[0]?.reason).toBeNull();
  });
  it.each(["", " ", "\n\t"])("rejects blank required reason %j", (reason) => {
    expect(correctUseInputSchema.safeParse({ ...correct, reason }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, reason }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, usedQuantity: "0", reason }] }).success).toBe(false);
  });
  it("requires a reason for zero use but permits an explained zero", () => {
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, usedQuantity: "0" }] }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, usedQuantity: "0", reason: "unused" }] }).success).toBe(true);
  });
  it.each([false, undefined, "true"])("requires explicit taken-out-of-use confirmation %s", (confirmation) => {
    expect(confirmUseInputSchema.safeParse({ ...confirm, confirmTakenOutOfUse: confirmation }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, contexts: [{ ...context, confirmTakenOutOfUse: confirmation }] }).success).toBe(false);
  });
  it("requires acknowledgement and reason for an empty confirmation", () => {
    const empty = { ...confirm, items: [], expectedLedger: [] };
    expect(confirmUseInputSchema.safeParse(empty).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...empty, confirmEmpty: true }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...empty, confirmEmpty: true, reason: "nothing required" }).success).toBe(true);
  });
  it.each(["-1", "1.5", "1.0", "1e2", "NaN", "", " 1 "])("rejects non-whole ledger revision %j", (ledgerRevision) => {
    expect(confirmUseInputSchema.safeParse({ ...confirm, expectedLedger: [{ ...ledger, ledgerRevision }] }).success).toBe(false);
  });
  it("preserves a revision beyond JavaScript's safe integer range exactly", () => {
    const parsed = confirmUseInputSchema.parse({ ...confirm, expectedLedger: [{ ...ledger, ledgerRevision: "009007199254740993" }] });
    expect(parsed.expectedLedger[0]?.ledgerRevision).toBe("9007199254740993");
  });
  it("rejects duplicate use and ledger item IDs in both use commands", () => {
    for (const [schema, input] of [[confirmUseInputSchema, confirm], [correctUseInputSchema, correct]] as const) {
      expect(schema.safeParse({ ...input, items: [item, { ...item, usedQuantity: "2" }] }).success).toBe(false);
      expect(schema.safeParse({ ...input, expectedLedger: [ledger, ledger] }).success).toBe(false);
    }
  });
  it("rejects duplicate settlement contexts, counts, ledger IDs and context items", () => {
    expect(settleUseInputSchema.safeParse({ ...settle, contexts: [context, context] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, contexts: [context, { ...context, contextId: id(9) }] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, counts: [settle.counts[0], settle.counts[0]] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, expectedLedger: [ledger, ledger] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, contexts: [{ ...context, items: [item, item] }] }).success).toBe(false);
  });
  it.each(["1000000000000", "0.0000001", "-1", "NaN", "Infinity", "1e2", ""])("rejects invalid use and count quantity %j", (quantity) => {
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, usedQuantity: quantity }] }).success).toBe(false);
    expect(settleUseInputSchema.safeParse({ ...settle, counts: [{ inventoryItemId: id(4), remainingQuantity: quantity }] }).success).toBe(false);
  });
  it.each(["cycleId", "planningSnapshotId", "contextId", "requestId"])("rejects malformed %s", (key) => {
    expect(confirmUseInputSchema.safeParse({ ...confirm, [key]: "not-an-id" }).success).toBe(false);
  });
  it("rejects invalid nested and correction IDs", () => {
    expect(correctUseInputSchema.safeParse({ ...correct, expectedRevisionId: "bad" }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...confirm, items: [{ ...item, inventoryItemId: "bad" }] }).success).toBe(false);
    expect(confirmUseInputSchema.safeParse({ ...confirm, expectedLedger: [{ ...ledger, countMovementId: "bad" }] }).success).toBe(false);
  });
});
