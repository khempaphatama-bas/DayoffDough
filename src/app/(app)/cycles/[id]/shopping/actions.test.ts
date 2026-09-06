import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import type { PurchaseActionState, StockActionState } from "./actions";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const SHOPPING_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-05T03:00:00.000Z");

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const commands = vi.hoisted(() => ({
  confirmStock: vi.fn(),
  recordPurchase: vi.fn(),
}));
const next = vi.hoisted(() => ({
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: auth.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/shopping/application/shopping-commands", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/shopping/application/shopping-commands")
  >();
  return {
    ...actual,
    createShoppingCommandService: () => commands,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: next.redirect }));

import {
  ShoppingStateError,
  ShoppingValidationError,
} from "@/modules/shopping/application/shopping-commands";
import {
  confirmCycleStockAction,
  recordCyclePurchaseAction,
} from "./actions";

const INITIAL_STOCK_STATE: StockActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
  stale: false,
};
const INITIAL_PURCHASE_STATE: PurchaseActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
  stale: false,
};

function stockForm(payload: unknown): FormData {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  return formData;
}

function validStockPayload() {
  return {
    cycleId: CYCLE_ID,
    planningSnapshotId: SNAPSHOT_ID,
    confirmationRequestId: REQUEST_ID,
    countedAt: NOW.toISOString(),
    counts: [{ inventoryItemId: ITEM_ID, countedQuantity: "1000" }],
  };
}

function purchaseForm(
  overrides: Readonly<Record<string, string>> = {},
): FormData {
  const formData = new FormData();
  const fields = {
    cycleId: CYCLE_ID,
    planningSnapshotId: SNAPSHOT_ID,
    shoppingItemId: SHOPPING_ITEM_ID,
    purchaseRequestId: REQUEST_ID,
    packCount: "2",
    totalPriceBaht: "55.00",
    purchasedFrom: " ร้านวัตถุดิบ ",
    occurredAt: NOW.toISOString(),
    notes: " ฝากไว้ประตูหลัง ",
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

const EXPECTED_REVALIDATIONS = [
  "/cycles",
  `/cycles/${CYCLE_ID}`,
  `/cycles/${CYCLE_ID}/planning`,
  `/cycles/${CYCLE_ID}/shopping`,
  "/inventory",
  "/dashboard",
];

describe("shopping actions", () => {
  beforeEach(() => {
    auth.requireOwner.mockReset();
    commands.confirmStock.mockReset();
    commands.recordPurchase.mockReset();
    next.redirect.mockReset();
    next.revalidatePath.mockReset();
    auth.requireOwner.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@example.com",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("authenticates, confirms the parsed stock count, and revalidates exactly the shopping views", async () => {
    commands.confirmStock.mockResolvedValue({ kind: "SHOPPING" });

    const result = await confirmCycleStockAction(
      INITIAL_STOCK_STATE,
      stockForm(validStockPayload()),
    );

    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(commands.confirmStock).toHaveBeenCalledWith(OWNER_ID, {
      cycleId: CYCLE_ID,
      planningSnapshotId: SNAPSHOT_ID,
      confirmationRequestId: REQUEST_ID,
      countedAt: NOW,
      counts: [{ inventoryItemId: ITEM_ID, countedQuantity: "1000" }],
    });
    expect(result).toEqual({
      error: null,
      fieldErrors: {},
      saved: true,
      stale: false,
    });
    expect(next.revalidatePath.mock.calls).toEqual(
      EXPECTED_REVALIDATIONS.map((path) => [path]),
    );
    expect(next.redirect).not.toHaveBeenCalled();
  });

  it("authenticates before reading a malformed stock payload", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    const malformed = new FormData();
    malformed.set("payload", "{not-json");

    await expect(
      confirmCycleStockAction(INITIAL_STOCK_STATE, malformed),
    ).rejects.toThrow("Unauthorized");
    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(commands.confirmStock).not.toHaveBeenCalled();
  });

  it("returns a safe form error for malformed stock JSON without mutation", async () => {
    const malformed = new FormData();
    malformed.set("payload", "{not-json");

    await expect(
      confirmCycleStockAction(INITIAL_STOCK_STATE, malformed),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบข้อมูลที่กรอก",
      fieldErrors: { payload: "ข้อมูลยืนยันสต๊อกไม่ถูกต้อง" },
      saved: false,
      stale: false,
    });
    expect(commands.confirmStock).not.toHaveBeenCalled();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["invalid", "1.0000001"],
  ])(
    "returns an adjacent count error for a %s counted quantity without mutation",
    async (_case, countedQuantity) => {
      const payload = validStockPayload();
      const count = { inventoryItemId: ITEM_ID } as {
        inventoryItemId: string;
        countedQuantity?: string;
      };
      if (countedQuantity !== undefined) count.countedQuantity = countedQuantity;
      payload.counts = [count as (typeof payload.counts)[number]];

      await expect(
        confirmCycleStockAction(INITIAL_STOCK_STATE, stockForm(payload)),
      ).resolves.toEqual({
        error: "กรุณาตรวจสอบข้อมูลที่กรอก",
        fieldErrors: {
          [`countedQuantity.${ITEM_ID}`]:
            "จำนวนที่นับจริงต้องเป็นเลขไม่ติดลบ ทศนิยมไม่เกิน 6 ตำแหน่ง",
        },
        saved: false,
        stale: false,
      });
      expect(commands.confirmStock).not.toHaveBeenCalled();
      expect(next.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["shorthand", "0"],
    ["impossible calendar date", "2026-02-30T10:00:00.000Z"],
    ["trailing junk", "2026-09-05T03:00:00.000Zjunk"],
    ["non-canonical timezone", "2026-09-05T10:00:00.000+07:00"],
  ])(
    "rejects a %s stock timestamp before mutation",
    async (_case, countedAt) => {
      await expect(
        confirmCycleStockAction(
          INITIAL_STOCK_STATE,
          stockForm({ ...validStockPayload(), countedAt }),
        ),
      ).resolves.toEqual({
        error: "กรุณาตรวจสอบข้อมูลที่กรอก",
        fieldErrors: {
          countedAt: "วันและเวลายืนยันสต๊อกไม่ถูกต้อง",
        },
        saved: false,
        stale: false,
      });
      expect(commands.confirmStock).not.toHaveBeenCalled();
      expect(next.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("authenticates, parses a purchase, trims optional text, and revalidates exactly the shopping views", async () => {
    commands.recordPurchase.mockResolvedValue({ status: "COMPLETE" });

    const result = await recordCyclePurchaseAction(
      INITIAL_PURCHASE_STATE,
      purchaseForm(),
    );

    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(commands.recordPurchase).toHaveBeenCalledWith(OWNER_ID, {
      cycleId: CYCLE_ID,
      planningSnapshotId: SNAPSHOT_ID,
      shoppingItemId: SHOPPING_ITEM_ID,
      purchaseRequestId: REQUEST_ID,
      packCount: 2,
      totalPriceSatang: 5_500,
      purchasedFrom: "ร้านวัตถุดิบ",
      occurredAt: NOW,
      notes: "ฝากไว้ประตูหลัง",
    });
    expect(result).toEqual({
      error: null,
      fieldErrors: {},
      saved: true,
      stale: false,
    });
    expect(next.revalidatePath.mock.calls).toEqual(
      EXPECTED_REVALIDATIONS.map((path) => [path]),
    );
    expect(next.redirect).not.toHaveBeenCalled();
  });

  it("authenticates before reading invalid purchase identifiers", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      recordCyclePurchaseAction(
        INITIAL_PURCHASE_STATE,
        purchaseForm({ cycleId: "not-a-uuid" }),
      ),
    ).rejects.toThrow("Unauthorized");
    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(commands.recordPurchase).not.toHaveBeenCalled();
  });

  it("returns an adjacent pack-count error for a non-integer without mutation", async () => {
    await expect(
      recordCyclePurchaseAction(
        INITIAL_PURCHASE_STATE,
        purchaseForm({ packCount: "1.5" }),
      ),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบข้อมูลที่กรอก",
      fieldErrors: {
        packCount: "จำนวนแพ็กต้องเป็นเลขจำนวนเต็มที่มากกว่า 0",
      },
      saved: false,
      stale: false,
    });
    expect(commands.recordPurchase).not.toHaveBeenCalled();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns an adjacent Baht error for an invalid amount without mutation", async () => {
    await expect(
      recordCyclePurchaseAction(
        INITIAL_PURCHASE_STATE,
        purchaseForm({ totalPriceBaht: "55.001" }),
      ),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบข้อมูลที่กรอก",
      fieldErrors: {
        totalPriceBaht:
          "ราคารวมต้องเป็นเงินบาทไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง",
      },
      saved: false,
      stale: false,
    });
    expect(commands.recordPurchase).not.toHaveBeenCalled();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["shorthand", "0"],
    ["impossible Bangkok date", "2026-02-30T10:00"],
    ["trailing junk", "2026-09-05T10:00junk"],
    ["timezone-bearing local value", "2026-09-05T10:00+07:00"],
  ])(
    "rejects a %s purchase timestamp before mutation",
    async (_case, occurredAt) => {
      await expect(
        recordCyclePurchaseAction(
          INITIAL_PURCHASE_STATE,
          purchaseForm({ occurredAt }),
        ),
      ).resolves.toEqual({
        error: "กรุณาตรวจสอบข้อมูลที่กรอก",
        fieldErrors: {
          occurredAt: "วันและเวลาที่ซื้อไม่ถูกต้อง",
        },
        saved: false,
        stale: false,
      });
      expect(commands.recordPurchase).not.toHaveBeenCalled();
      expect(next.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("interprets a strict purchase datetime-local value in Asia/Bangkok", async () => {
    commands.recordPurchase.mockResolvedValue({ status: "PARTIAL" });

    const result = await recordCyclePurchaseAction(
      INITIAL_PURCHASE_STATE,
      purchaseForm({ occurredAt: "2026-09-05T10:00" }),
    );

    expect(commands.recordPurchase).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({
        occurredAt: new Date("2026-09-05T03:00:00.000Z"),
      }),
    );
    expect(result).toEqual({
      error: null,
      fieldErrors: {},
      saved: true,
      stale: false,
    });
  });

  it.each([
    {
      name: "stock state conflicts",
      action: () =>
        confirmCycleStockAction(
          INITIAL_STOCK_STATE,
          stockForm(validStockPayload()),
        ),
      command: commands.confirmStock,
      failure: new ShoppingStateError("raw stale detail"),
      expected: {
        error: "แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด",
        fieldErrors: {},
        saved: false,
        stale: true,
      },
    },
    {
      name: "stock validation conflicts",
      action: () =>
        confirmCycleStockAction(
          INITIAL_STOCK_STATE,
          stockForm(validStockPayload()),
        ),
      command: commands.confirmStock,
      failure: new ShoppingValidationError("raw validation detail"),
      expected: {
        error: "กรุณาตรวจสอบข้อมูลที่กรอก",
        fieldErrors: {},
        saved: false,
        stale: false,
      },
    },
    {
      name: "purchase state conflicts",
      action: () =>
        recordCyclePurchaseAction(INITIAL_PURCHASE_STATE, purchaseForm()),
      command: commands.recordPurchase,
      failure: new ShoppingStateError("raw stale detail"),
      expected: {
        error: "แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด",
        fieldErrors: {},
        saved: false,
        stale: true,
      },
    },
    {
      name: "purchase validation conflicts",
      action: () =>
        recordCyclePurchaseAction(INITIAL_PURCHASE_STATE, purchaseForm()),
      command: commands.recordPurchase,
      failure: new ShoppingValidationError("raw validation detail"),
      expected: {
        error: "กรุณาตรวจสอบข้อมูลที่กรอก",
        fieldErrors: {},
        saved: false,
        stale: false,
      },
    },
  ])(
    "maps $name to a narrow serializable state",
    async ({ action, command, failure, expected }) => {
      command.mockRejectedValueOnce(failure);

      await expect(action()).resolves.toEqual(expected);
      expect(next.revalidatePath).not.toHaveBeenCalled();
      expect(next.redirect).not.toHaveBeenCalled();
    },
  );

  it("logs only safe identifiers for an unexpected stock failure", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    commands.confirmStock.mockRejectedValueOnce(
      new Error("postgres://secret@host raw stock detail"),
    );

    await expect(
      confirmCycleStockAction(
        INITIAL_STOCK_STATE,
        stockForm(validStockPayload()),
      ),
    ).resolves.toEqual({
      error: "ระบบยืนยันสต๊อกไม่สำเร็จ กรุณาลองอีกครั้ง",
      fieldErrors: {},
      saved: false,
      stale: false,
    });
    expect(logger).toHaveBeenCalledWith("shopping_action_failed", {
      operation: "confirm_stock",
      ownerId: OWNER_ID,
      cycleId: CYCLE_ID,
      requestId: REQUEST_ID,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("raw stock detail");
  });

  it("logs only safe identifiers for an unexpected purchase failure", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    commands.recordPurchase.mockRejectedValueOnce(
      new Error("postgres://secret@host raw price detail ร้านวัตถุดิบ"),
    );

    await expect(
      recordCyclePurchaseAction(
        INITIAL_PURCHASE_STATE,
        purchaseForm({
          purchasedFrom: "secret-store",
          notes: "price note must stay private",
        }),
      ),
    ).resolves.toEqual({
      error: "ระบบบันทึกการซื้อไม่สำเร็จ กรุณาลองอีกครั้ง",
      fieldErrors: {},
      saved: false,
      stale: false,
    });
    expect(logger).toHaveBeenCalledWith("shopping_action_failed", {
      operation: "record_purchase",
      ownerId: OWNER_ID,
      cycleId: CYCLE_ID,
      requestId: REQUEST_ID,
    });
    const logged = JSON.stringify(logger.mock.calls);
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("price note");
    expect(logged).not.toContain("ร้านวัตถุดิบ");
    expect(logged).not.toContain("55.00");
  });
});
