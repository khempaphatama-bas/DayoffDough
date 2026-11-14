import { describe, expect, it } from "vitest";
import { canonicalizeUseRequest } from "./request-manifest";
import type { ConfirmUseInput, CorrectUseInput, SettleUseInput } from "./types";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const source = { cycleId: id(1), planningSnapshotId: id(2), contextId: id(3) };
const items = [4, 5].map((n) => ({ inventoryItemId: id(n), usedQuantity: "1", basis: "PLANNED" as const, reason: null }));
const expectedLedger = [4, 5].map((n) => ({ inventoryItemId: id(n), ledgerRevision: "1", countMovementId: null }));
const confirm: ConfirmUseInput = { ...source, requestId: id(6), items, expectedLedger, confirmTakenOutOfUse: true, confirmEmpty: false, reason: null };
const correct: CorrectUseInput = { ...source, requestId: id(6), items, expectedLedger, expectedRevisionId: id(7), reason: "corrected" };
const context = { ...source, items, confirmTakenOutOfUse: true as const };
const settle: SettleUseInput = { requestId: id(6), contexts: [context, { ...context, cycleId: id(8), contextId: id(9), planningSnapshotId: id(10) }], counts: [4, 5].map((n) => ({ inventoryItemId: id(n), remainingQuantity: "2" })), expectedLedger, reason: "counted" };

describe("canonical use request manifests", () => {
  it.each([
    ["CONFIRM", confirm], ["CORRECT", correct], ["SETTLE", settle],
  ] as const)("canonicalizes equivalent mixed-case UUIDs in %s requests", (kind, input) => {
    const withFence = { ...input, expectedLedger: input.expectedLedger.map((row) => ({ ...row, countMovementId: id(12) })) };
    const lower = JSON.parse(JSON.stringify(withFence).replaceAll("111111111111", "abcdefabcdef"));
    const upper = JSON.parse(JSON.stringify(lower).replaceAll("abcdefabcdef", "ABCDEFABCDEF"));
    expect(canonicalizeUseRequest(kind, upper)).toBe(canonicalizeUseRequest(kind, lower));
  });
  it("does not case-fold free-text reasons", () => {
    expect(canonicalizeUseRequest("CORRECT", { ...correct, reason: "Weighed" })).not.toBe(canonicalizeUseRequest("CORRECT", { ...correct, reason: "weighed" }));
  });
  it("ignores item and ledger permutations and equivalent numeric spelling", () => {
    const entered = { ...confirm, items: [...items].reverse().map((item) => ({ ...item, usedQuantity: "01.000000" })), expectedLedger: [...expectedLedger].reverse().map((row) => ({ ...row, ledgerRevision: "0001" })) };
    expect(canonicalizeUseRequest("CONFIRM", entered)).toBe(canonicalizeUseRequest("CONFIRM", confirm));
  });
  it("ignores settlement permutations without mutating input", () => {
    const entered = { ...settle, contexts: [...settle.contexts].reverse().map((row) => ({ ...row, items: [...row.items].reverse() })), counts: [...settle.counts].reverse().map((row) => ({ ...row, remainingQuantity: "02.000000" })), expectedLedger: [...expectedLedger].reverse(), reason: " counted " };
    expect(canonicalizeUseRequest("SETTLE", entered)).toBe(canonicalizeUseRequest("SETTLE", settle));
    expect(entered.contexts[0]?.cycleId).toBe(id(8));
    expect(entered.counts[0]?.inventoryItemId).toBe(id(5));
  });
  it.each([
    ["basis", { items: [{ ...items[0]!, basis: "OWNER_REPORTED" as const }, items[1]!] }],
    ["item reason", { items: [{ ...items[0]!, reason: "used as planned" }, items[1]!] }],
    ["quantity", { items: [{ ...items[0]!, usedQuantity: "2" }, items[1]!] }],
    ["command reason", { reason: "explained" }],
    ["ledger revision", { expectedLedger: [{ ...expectedLedger[0]!, ledgerRevision: "2" }, expectedLedger[1]!] }],
    ["count fence", { expectedLedger: [{ ...expectedLedger[0]!, countMovementId: id(11) }, expectedLedger[1]!] }],
    ["cycle", { cycleId: id(11) }], ["snapshot", { planningSnapshotId: id(11) }],
    ["context", { contextId: id(11) }], ["request", { requestId: id(11) }],
    ["empty acknowledgement", { confirmEmpty: true }],
  ])("binds %s to confirmation identity", (_name, change) => {
    expect(canonicalizeUseRequest("CONFIRM", { ...confirm, ...change })).not.toBe(canonicalizeUseRequest("CONFIRM", confirm));
  });
  it("binds correction reason, revision and operation kind", () => {
    const manifest = canonicalizeUseRequest("CORRECT", correct);
    expect(canonicalizeUseRequest("CORRECT", { ...correct, expectedRevisionId: id(11) })).not.toBe(manifest);
    expect(canonicalizeUseRequest("CORRECT", { ...correct, reason: "different" })).not.toBe(manifest);
    expect(JSON.parse(manifest).kind).toBe("CORRECT");
    expect(canonicalizeUseRequest("CONFIRM", confirm)).not.toBe(manifest);
  });
  it("binds settlement counts, source and reason", () => {
    const manifest = canonicalizeUseRequest("SETTLE", settle);
    expect(canonicalizeUseRequest("SETTLE", { ...settle, counts: [{ ...settle.counts[0]!, remainingQuantity: "3" }, settle.counts[1]!] })).not.toBe(manifest);
    expect(canonicalizeUseRequest("SETTLE", { ...settle, contexts: [{ ...context, planningSnapshotId: id(11) }, settle.contexts[1]!] })).not.toBe(manifest);
    expect(canonicalizeUseRequest("SETTLE", { ...settle, reason: "different" })).not.toBe(manifest);
  });
  it("rejects duplicate IDs instead of silently dropping them", () => {
    expect(() => canonicalizeUseRequest("CONFIRM", { ...confirm, items: [items[0]!, items[0]!] })).toThrow();
    expect(() => canonicalizeUseRequest("SETTLE", { ...settle, counts: [settle.counts[0]!, settle.counts[0]!] })).toThrow();
  });
});
