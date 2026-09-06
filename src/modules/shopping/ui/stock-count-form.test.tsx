import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockActionState } from "@/app/(app)/cycles/[id]/shopping/actions";
import type { CountRequiredView } from "@/modules/shopping/domain/types";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const FLOUR_ID = "33333333-3333-4333-8333-333333333333";
const BAG_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

const actions = vi.hoisted(() => ({ confirmCycleStockAction: vi.fn() }));

vi.mock("@/app/(app)/cycles/[id]/shopping/actions", () => ({
  confirmCycleStockAction: actions.confirmCycleStockAction,
}));

import { StockCountForm } from "./stock-count-form";

const OK_STATE: StockActionState = {
  error: null,
  fieldErrors: {},
  saved: true,
  stale: false,
};

const VIEW: CountRequiredView = {
  kind: "COUNT_REQUIRED",
  cycle: {
    cycleId: CYCLE_ID,
    cycleNumber: 12,
    cycleName: "รอบส่ง 30 ส.ค.",
    cycleStatus: "LOCKED",
    planningSnapshotId: SNAPSHOT_ID,
    generation: 1,
    planningStatus: "ACTIVE",
  },
  generations: [
    {
      id: SNAPSHOT_ID,
      cycleId: CYCLE_ID,
      generation: 1,
      status: "ACTIVE",
      costComplete: true,
      lockedAt: new Date("2026-09-05T02:00:00.000Z"),
      unlockedAt: null,
      unlockReason: null,
      unlockedFromStatus: null,
    },
  ],
  items: [
    {
      inventoryItemId: FLOUR_ID,
      inventoryItemName: "แป้งขนมปัง",
      inventoryCategory: "INGREDIENT",
      baseUnit: "g",
      priceSnapshotId: "66666666-6666-4666-8666-666666666666",
      unitCostSatang: "0.05",
      requiredQuantity: "2200.000000",
      purchaseUnitLabel: "ถุง",
      baseQuantityPerPurchasePack: "1000.000000",
      systemBalance: "800.500000",
    },
    {
      inventoryItemId: BAG_ID,
      inventoryItemName: "ถุงขนม",
      inventoryCategory: "PACKAGING",
      baseUnit: "piece",
      priceSnapshotId: "77777777-7777-4777-8777-777777777777",
      unitCostSatang: null,
      requiredQuantity: "12.000000",
      purchaseUnitLabel: "แพ็ก",
      baseQuantityPerPurchasePack: "100.000000",
      systemBalance: "20.000000",
    },
  ],
  writable: true,
};

describe("StockCountForm", () => {
  beforeEach(() => {
    actions.confirmCycleStockAction.mockReset();
    actions.confirmCycleStockAction.mockResolvedValue(OK_STATE);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders one touch-safe required count input per candidate with the system balance default", () => {
    render(<StockCountForm view={VIEW} />);

    const flour = screen.getByRole("article", { name: "แป้งขนมปัง" });
    expect(flour).toHaveTextContent("ต้องใช้ 2200 g");
    expect(flour).toHaveTextContent("ยอดในระบบ 800.5 g");
    const flourInput = within(flour).getByLabelText(
      "จำนวนที่นับจริง แป้งขนมปัง",
    );
    expect(flourInput).toHaveValue(800.5);
    expect(flourInput).toBeRequired();
    expect(flourInput).toHaveAttribute("type", "number");
    expect(flourInput).toHaveAttribute("min", "0");
    expect(flourInput).toHaveAttribute("step", "any");
    expect(flourInput).toHaveClass("min-h-11");

    const bagInput = screen.getByLabelText("จำนวนที่นับจริง ถุงขนม");
    expect(bagInput).toHaveValue(20);
    expect(bagInput).toBeRequired();
    expect(screen.getByTestId("stock-count-action")).toHaveClass(
      "sticky",
      "bottom-20",
      "z-20",
    );
  });

  it("cancels without dispatch and confirms one canonical all-item payload", async () => {
    const user = userEvent.setup();
    const confirm = vi.mocked(window.confirm);
    confirm.mockReturnValueOnce(false).mockReturnValue(true);
    render(<StockCountForm view={VIEW} />);

    await user.clear(screen.getByLabelText("จำนวนที่นับจริง แป้งขนมปัง"));
    await user.type(
      screen.getByLabelText("จำนวนที่นับจริง แป้งขนมปัง"),
      "1000",
    );
    const submit = screen.getByRole("button", {
      name: "ยืนยันสต๊อกและสร้างรายการซื้อ",
    });

    await user.click(submit);
    expect(confirm).toHaveBeenCalledWith(
      "ยืนยันยอดนับสำหรับแผนรุ่น 1 และปรับยอดสต๊อกตามจำนวนจริงหรือไม่?",
    );
    expect(actions.confirmCycleStockAction).not.toHaveBeenCalled();

    await user.click(submit);
    await waitFor(() =>
      expect(actions.confirmCycleStockAction).toHaveBeenCalledOnce(),
    );
    const submitted = actions.confirmCycleStockAction.mock.calls[0]![1] as FormData;
    const payload = JSON.parse(String(submitted.get("payload"))) as {
      cycleId: string;
      planningSnapshotId: string;
      confirmationRequestId: string;
      countedAt: string;
      counts: Array<{ inventoryItemId: string; countedQuantity: string }>;
    };
    expect(payload).toMatchObject({
      cycleId: CYCLE_ID,
      planningSnapshotId: SNAPSHOT_ID,
      confirmationRequestId: REQUEST_ID,
      counts: [
        { inventoryItemId: FLOUR_ID, countedQuantity: "1000" },
        { inventoryItemId: BAG_ID, countedQuantity: "20" },
      ],
    });
    expect(new Date(payload.countedAt).toISOString()).toBe(payload.countedAt);
    expect(payload.countedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Set(payload.counts.map((count) => count.inventoryItemId))).toEqual(
      new Set([FLOUR_ID, BAG_ID]),
    );
  });

  it("disables the sticky action while the confirmation is pending", async () => {
    let resolveAction: ((state: StockActionState) => void) | undefined;
    actions.confirmCycleStockAction.mockImplementation(
      () =>
        new Promise<StockActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<StockCountForm view={VIEW} />);

    await user.click(
      screen.getByRole("button", {
        name: "ยืนยันสต๊อกและสร้างรายการซื้อ",
      }),
    );

    expect(
      await screen.findByRole("button", { name: "กำลังยืนยันสต๊อก…" }),
    ).toBeDisabled();
    expect(actions.confirmCycleStockAction).toHaveBeenCalledOnce();
    resolveAction?.(OK_STATE);
    await waitFor(() =>
      expect(screen.getByText("ยืนยันสต๊อกแล้ว")).toBeInTheDocument(),
    );
  });

  it("places an item error beside its input and offers the latest view for stale state", async () => {
    actions.confirmCycleStockAction.mockResolvedValueOnce({
      error: "แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด",
      fieldErrors: {
        [`countedQuantity.${FLOUR_ID}`]: "จำนวนที่นับจริงไม่ถูกต้อง",
      },
      saved: false,
      stale: true,
    } satisfies StockActionState);
    const user = userEvent.setup();
    render(<StockCountForm view={VIEW} />);

    await user.click(
      screen.getByRole("button", {
        name: "ยืนยันสต๊อกและสร้างรายการซื้อ",
      }),
    );

    const error = await screen.findByText("จำนวนที่นับจริงไม่ถูกต้อง");
    expect(error).toHaveAttribute("id", `count-error-${FLOUR_ID}`);
    expect(screen.getByLabelText("จำนวนที่นับจริง แป้งขนมปัง")).toHaveAttribute(
      "aria-describedby",
      `count-error-${FLOUR_ID}`,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด",
    );
    expect(screen.getByRole("link", { name: "เปิดรายการล่าสุด" })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}/shopping`,
    );
  });
});
