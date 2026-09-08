import { describe, expect, it } from "vitest";
import {
  confirmStockInputSchema,
  recordPurchaseInputSchema,
} from "./forms";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const SHOPPING_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-05T03:00:00Z");

function confirmInput(countedQuantity: unknown = "0") {
  return {
    cycleId: CYCLE_ID,
    planningSnapshotId: SNAPSHOT_ID,
    confirmationRequestId: REQUEST_ID,
    countedAt: NOW,
    counts: [{ inventoryItemId: ITEM_ID, countedQuantity }],
  };
}

function purchaseInput() {
  return {
    cycleId: CYCLE_ID,
    planningSnapshotId: SNAPSHOT_ID,
    shoppingItemId: SHOPPING_ID,
    purchaseRequestId: REQUEST_ID,
    packCount: 1,
    totalPriceSatang: 5_500,
    occurredAt: NOW,
  };
}

describe("confirm stock input schema", () => {
  it("accepts the canonical confirmation payload", () => {
    expect(confirmStockInputSchema.safeParse(confirmInput()).success).toBe(true);
  });

  it.each(["0", "0.000000", "1", "1.5", ".5", "0001.250000"])(
    "accepts non-negative count %s with at most six decimal places",
    (countedQuantity) => {
      expect(
        confirmStockInputSchema.safeParse(confirmInput(countedQuantity)).success,
      ).toBe(true);
    },
  );

  it.each([
    ["999999999999.999999", true],
    ["1000000000000", false],
  ])("accepts numeric(18,6) count boundary %s: %s", (countedQuantity, expected) => {
    expect(
      confirmStockInputSchema.safeParse(confirmInput(countedQuantity)).success,
    ).toBe(expected);
  });

  it.each([
    "-1",
    "+1",
    "1.0000001",
    "1.",
    ".",
    "1e2",
    " 1 ",
    "Infinity",
    "not-a-number",
    1,
  ])("rejects invalid count %s", (countedQuantity) => {
    expect(
      confirmStockInputSchema.safeParse(confirmInput(countedQuantity)).success,
    ).toBe(false);
  });

  it.each([
    ["cycle", { cycleId: "not-a-uuid" }],
    ["planning snapshot", { planningSnapshotId: "not-a-uuid" }],
    ["confirmation request", { confirmationRequestId: "not-a-uuid" }],
    [
      "inventory item",
      {
        counts: [
          { inventoryItemId: "not-a-uuid", countedQuantity: "0" },
        ],
      },
    ],
  ])("rejects an invalid %s UUID", (_case, change) => {
    expect(
      confirmStockInputSchema.safeParse({ ...confirmInput(), ...change }).success,
    ).toBe(false);
  });

  it.each([new Date("invalid"), "2026-09-05T03:00:00Z", null])(
    "rejects invalid countedAt %s",
    (countedAt) => {
      expect(
        confirmStockInputSchema.safeParse({ ...confirmInput(), countedAt })
          .success,
      ).toBe(false);
    },
  );
});

describe("record purchase input schema", () => {
  it("accepts a zero actual price and trims optional text", () => {
    const parsed = recordPurchaseInputSchema.safeParse({
      ...purchaseInput(),
      totalPriceSatang: 0,
      purchasedFrom: "  ร้านวัตถุดิบ  ",
      notes: "  ส่งทางประตูหลัง  ",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.purchasedFrom).toBe("ร้านวัตถุดิบ");
    expect(parsed.data.notes).toBe("ส่งทางประตูหลัง");
  });

  it.each([1, Number.MAX_SAFE_INTEGER])(
    "accepts safe positive integer pack count %s",
    (packCount) => {
      expect(
        recordPurchaseInputSchema.safeParse({ ...purchaseInput(), packCount })
          .success,
      ).toBe(true);
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    "rejects invalid pack count %s",
    (packCount) => {
      expect(
        recordPurchaseInputSchema.safeParse({ ...purchaseInput(), packCount })
          .success,
      ).toBe(false);
    },
  );

  it.each([0, 5_500, Number.MAX_SAFE_INTEGER])(
    "accepts safe non-negative integer satang %s",
    (totalPriceSatang) => {
      expect(
        recordPurchaseInputSchema.safeParse({
          ...purchaseInput(),
          totalPriceSatang,
        }).success,
      ).toBe(true);
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    "rejects invalid total satang %s",
    (totalPriceSatang) => {
      expect(
        recordPurchaseInputSchema.safeParse({
          ...purchaseInput(),
          totalPriceSatang,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["cycle", { cycleId: "not-a-uuid" }],
    ["planning snapshot", { planningSnapshotId: "not-a-uuid" }],
    ["shopping item", { shoppingItemId: "not-a-uuid" }],
    ["purchase request", { purchaseRequestId: "not-a-uuid" }],
  ])("rejects an invalid %s UUID", (_case, change) => {
    expect(
      recordPurchaseInputSchema.safeParse({ ...purchaseInput(), ...change })
        .success,
    ).toBe(false);
  });

  it.each([new Date("invalid"), "2026-09-05T03:00:00Z", null])(
    "rejects invalid occurredAt %s",
    (occurredAt) => {
      expect(
        recordPurchaseInputSchema.safeParse({ ...purchaseInput(), occurredAt })
          .success,
      ).toBe(false);
    },
  );

  it("enforces trimmed optional text length boundaries", () => {
    expect(
      recordPurchaseInputSchema.safeParse({
        ...purchaseInput(),
        purchasedFrom: ` ${"x".repeat(200)} `,
        notes: ` ${"x".repeat(2_000)} `,
      }).success,
    ).toBe(true);
    expect(
      recordPurchaseInputSchema.safeParse({
        ...purchaseInput(),
        purchasedFrom: "x".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      recordPurchaseInputSchema.safeParse({
        ...purchaseInput(),
        notes: "x".repeat(2_001),
      }).success,
    ).toBe(false);
  });
});
