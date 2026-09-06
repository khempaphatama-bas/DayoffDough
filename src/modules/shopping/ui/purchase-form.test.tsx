import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseActionState } from "@/app/(app)/cycles/[id]/shopping/actions";
import type { CycleShoppingItemView } from "@/modules/shopping/domain/types";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const SHOPPING_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const INVENTORY_ITEM_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const NEXT_REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actions = vi.hoisted(() => ({ recordCyclePurchaseAction: vi.fn() }));

vi.mock("@/app/(app)/cycles/[id]/shopping/actions", () => ({
  recordCyclePurchaseAction: actions.recordCyclePurchaseAction,
}));

import { PurchaseForm } from "./purchase-form";

const UNSAVED_STATE: PurchaseActionState = {
  error: "กรุณาตรวจสอบข้อมูลที่กรอก",
  fieldErrors: {},
  saved: false,
  stale: false,
};
const SAVED_STATE: PurchaseActionState = {
  error: null,
  fieldErrors: {},
  saved: true,
  stale: false,
};

const ITEM: CycleShoppingItemView = {
  id: SHOPPING_ITEM_ID,
  cycleId: CYCLE_ID,
  planningSnapshotId: SNAPSHOT_ID,
  inventoryCountId: "77777777-7777-4777-8777-777777777777",
  inventoryItemId: INVENTORY_ITEM_ID,
  inventoryItemName: "แป้งขนมปัง",
  inventoryCategory: "INGREDIENT",
  baseUnit: "g",
  requiredQuantity: "2200",
  countedQuantity: "1000",
  purchaseUnitLabel: "ถุง",
  baseQuantityPerPurchasePack: "1000",
  shortfallQuantity: "1200",
  suggestedPackCount: 2,
  suggestedPurchaseQuantity: "2000",
  estimatedCostSatang: 5500,
  createdAt: new Date("2026-09-05T02:00:00.000Z"),
  progress: {
    status: "TO_BUY",
    purchasedQuantity: "0",
    remainingQuantity: "1200",
    overageQuantity: "0",
  },
  purchases: [],
};

function hiddenRequestId(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[name="purchaseRequestId"]',
  );
  if (!input) throw new Error("purchase request id input missing");
  return input;
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("จำนวนแพ็กที่ซื้อ"), "1");
  await user.type(screen.getByLabelText("ราคารวม (บาท)"), "55.00");
  fireEvent.change(screen.getByLabelText("วันและเวลาที่ซื้อ"), {
    target: { value: "2026-09-05T10:00" },
  });
}

describe("PurchaseForm", () => {
  beforeEach(() => {
    actions.recordCyclePurchaseAction.mockReset();
    actions.recordCyclePurchaseAction.mockResolvedValue(SAVED_STATE);
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValue(NEXT_REQUEST_ID);
  });

  afterEach(() => vi.restoreAllMocks());

  it("submits the exact accessible purchase fields with a request UUID and Bangkok local datetime", async () => {
    const user = userEvent.setup();
    render(<PurchaseForm item={ITEM} />);

    const packCount = screen.getByLabelText("จำนวนแพ็กที่ซื้อ");
    expect(packCount).toHaveAttribute("type", "number");
    expect(packCount).toHaveAttribute("step", "1");
    expect(packCount).toHaveAttribute("min", "1");
    expect(packCount).toHaveAttribute("inputmode", "numeric");
    expect(packCount).toHaveClass("min-h-11");
    expect(packCount).toBeRequired();
    const totalPrice = screen.getByLabelText("ราคารวม (บาท)");
    expect(totalPrice).toHaveAttribute("type", "number");
    expect(totalPrice).toHaveAttribute("step", "0.01");
    expect(totalPrice).toHaveAttribute("min", "0");
    expect(totalPrice).toHaveAttribute("inputmode", "decimal");
    expect(totalPrice).toBeRequired();
    expect(screen.getByLabelText("ร้านที่ซื้อ")).toHaveAttribute(
      "maxlength",
      "200",
    );
    expect(screen.getByLabelText("วันและเวลาที่ซื้อ")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByLabelText("วันและเวลาที่ซื้อ")).toBeRequired();
    expect(screen.getByLabelText("หมายเหตุ")).toHaveAttribute(
      "maxlength",
      "2000",
    );

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("ร้านที่ซื้อ"), "ร้านวัตถุดิบ");
    await user.type(screen.getByLabelText("หมายเหตุ"), "รับของหน้าร้าน");
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    await waitFor(() =>
      expect(actions.recordCyclePurchaseAction).toHaveBeenCalledOnce(),
    );
    const submitted = actions.recordCyclePurchaseAction.mock.calls[0]![1] as FormData;
    expect(submitted.get("cycleId")).toBe(CYCLE_ID);
    expect(submitted.get("planningSnapshotId")).toBe(SNAPSHOT_ID);
    expect(submitted.get("shoppingItemId")).toBe(SHOPPING_ITEM_ID);
    expect(submitted.get("purchaseRequestId")).toBe(REQUEST_ID);
    expect(String(submitted.get("purchaseRequestId"))).toMatch(UUID_PATTERN);
    expect(submitted.get("packCount")).toBe("1");
    expect(submitted.get("totalPriceBaht")).toBe("55");
    expect(submitted.get("purchasedFrom")).toBe("ร้านวัตถุดิบ");
    expect(submitted.get("occurredAt")).toBe("2026-09-05T10:00");
    expect(submitted.get("notes")).toBe("รับของหน้าร้าน");
  });

  it("keeps the request UUID through rerenders and failed saves, then resets only after success", async () => {
    actions.recordCyclePurchaseAction
      .mockResolvedValueOnce(UNSAVED_STATE)
      .mockResolvedValueOnce(SAVED_STATE);
    const user = userEvent.setup();
    const { rerender } = render(<PurchaseForm item={ITEM} />);

    expect(hiddenRequestId()).toHaveValue(REQUEST_ID);
    rerender(<PurchaseForm item={ITEM} />);
    expect(hiddenRequestId()).toHaveValue(REQUEST_ID);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณาตรวจสอบข้อมูลที่กรอก",
    );
    expect(hiddenRequestId()).toHaveValue(REQUEST_ID);
    expect(screen.getByLabelText("จำนวนแพ็กที่ซื้อ")).toHaveValue(1);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));
    await waitFor(() => expect(hiddenRequestId()).toHaveValue(NEXT_REQUEST_ID));
    expect(screen.getByLabelText("จำนวนแพ็กที่ซื้อ")).toHaveValue(null);
    expect(screen.getByLabelText("ราคารวม (บาท)")).toHaveValue(null);
    expect(screen.getByLabelText("วันและเวลาที่ซื้อ")).toHaveValue("");
    expect(screen.getByText("บันทึกการซื้อแล้ว")).toBeInTheDocument();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(2);

    const submittedIds = actions.recordCyclePurchaseAction.mock.calls.map(
      (call) => (call[1] as FormData).get("purchaseRequestId"),
    );
    expect(submittedIds).toEqual([REQUEST_ID, REQUEST_ID]);
  });

  it("disables submission while pending", async () => {
    let resolveAction: ((state: PurchaseActionState) => void) | undefined;
    actions.recordCyclePurchaseAction.mockImplementation(
      () =>
        new Promise<PurchaseActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<PurchaseForm item={ITEM} />);
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    expect(
      await screen.findByRole("button", { name: "กำลังบันทึก…" }),
    ).toBeDisabled();
    expect(actions.recordCyclePurchaseAction).toHaveBeenCalledOnce();
    resolveAction?.(SAVED_STATE);
    await waitFor(() =>
      expect(screen.getByText("บันทึกการซื้อแล้ว")).toBeInTheDocument(),
    );
  });

  it("places server errors beside matching fields and exposes the latest view when stale", async () => {
    actions.recordCyclePurchaseAction.mockResolvedValueOnce({
      error: "แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด",
      fieldErrors: {
        packCount: "จำนวนแพ็กไม่ถูกต้อง",
        totalPriceBaht: "ราคารวมไม่ถูกต้อง",
        purchasedFrom: "ชื่อร้านยาวเกินไป",
        occurredAt: "วันและเวลาไม่ถูกต้อง",
        notes: "หมายเหตุยาวเกินไป",
      },
      saved: false,
      stale: true,
    } satisfies PurchaseActionState);
    const user = userEvent.setup();
    render(<PurchaseForm item={ITEM} />);
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    expect(await screen.findByText("จำนวนแพ็กไม่ถูกต้อง")).toHaveAttribute(
      "id",
      `purchase-pack-error-${SHOPPING_ITEM_ID}`,
    );
    expect(screen.getByLabelText("จำนวนแพ็กที่ซื้อ")).toHaveAttribute(
      "aria-describedby",
      `purchase-pack-error-${SHOPPING_ITEM_ID}`,
    );
    expect(screen.getByText("ราคารวมไม่ถูกต้อง")).toHaveAttribute(
      "id",
      `purchase-price-error-${SHOPPING_ITEM_ID}`,
    );
    expect(screen.getByText("ชื่อร้านยาวเกินไป")).toBeInTheDocument();
    expect(screen.getByText("วันและเวลาไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.getByText("หมายเหตุยาวเกินไป")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เปิดรายการล่าสุด" })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}/shopping`,
    );
  });
});
