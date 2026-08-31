import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanningActionState } from "@/app/(app)/cycles/[id]/planning/actions";
import type { PlanningPreview } from "@/modules/planning/domain/types";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const RULE_ID = "44444444-4444-4444-8444-444444444444";
const FINGERPRINT = "a".repeat(64);
const NEXT_FINGERPRINT = "b".repeat(64);
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const NEXT_REQUEST_ID = "66666666-6666-4666-8666-666666666666";

const actions = vi.hoisted(() => ({ lockCycleAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/app/(app)/cycles/[id]/planning/actions", () => ({
  lockCycleAction: actions.lockCycleAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { PlanningPreviewForm } from "./planning-preview-form";

const OK_STATE: PlanningActionState = {
  error: null,
  fieldErrors: {},
  stale: false,
};

const BASE_PREVIEW: PlanningPreview = {
  calculatedAt: new Date("2026-08-29T00:00:00.000Z"),
  cycle: {
    id: CYCLE_ID,
    cycleNumber: 12,
    name: "รอบส่ง 30 ส.ค.",
    status: "OPEN",
    orderCutoffAt: new Date("2026-08-27T00:00:00.000Z"),
    targetProductionDate: "2026-08-29",
    primaryDeliveryDate: "2026-08-30",
  },
  inputFingerprint: FINGERPRINT,
  blockers: [
    {
      code: "INVALID_RECIPE_YIELD",
      scope: "PRODUCT",
      sourceEntityId: PRODUCT_ID,
      message: "ผลผลิตของสูตรต้องมากกว่า 0",
      context: { productName: "ฟอคคาเซีย" },
    },
  ],
  warnings: [
    {
      code: "MISSING_INVENTORY_PRICE",
      scope: "INVENTORY_ITEM",
      sourceEntityId: ITEM_ID,
      message: "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
      context: { inventoryItemName: "แป้งขนมปัง" },
    },
  ],
  orderSnapshots: [],
  productPlans: [
    {
      productId: PRODUCT_ID,
      productName: "ฟอคคาเซีย",
      sellingUnit: "piece",
      orderedQuantity: "10",
      yieldInSellingUnit: "6",
      suggestedBatchCount: 2,
      selectedBatchCount: "2",
      plannedOutput: "12",
      outputDifference: "2",
      overrideReason: null,
    },
  ],
  recipePlans: [
    {
      productId: PRODUCT_ID,
      recipeId: "77777777-7777-4777-8777-777777777777",
      recipeVersionId: "88888888-8888-4888-8888-888888888888",
      recipeName: "สูตรหลัก",
      versionCode: "v1",
      instructions: "ผสมและอบ",
      baseYieldQuantity: "6",
      yieldUnit: "piece",
      yieldInSellingUnit: "6",
      sellingUnit: "piece",
      laborMinutesPerBatch: 30,
      utilityCostSatangPerBatch: 1000,
      wasteAllowancePercent: "10",
      wasteAllowanceSource: "RECIPE",
    },
  ],
  inventoryPrices: [
    {
      inventoryItemId: ITEM_ID,
      inventoryItemName: "แป้งขนมปัง",
      inventoryCategory: "INGREDIENT",
      baseUnit: "g",
      sourcePriceId: null,
      packPriceSatang: null,
      packBaseQuantity: null,
      effectiveAt: null,
      unitCostSatang: null,
    },
  ],
  materialRequirements: [
    {
      productId: PRODUCT_ID,
      recipeIngredientId: "99999999-9999-4999-8999-999999999999",
      inventoryItemId: ITEM_ID,
      inventoryItemName: "แป้งขนมปัง",
      baseUnit: "g",
      quantityPerBatch: "1000",
      selectedBatchCount: "2",
      wasteAllowancePercent: "10",
      baseRequirement: "2000",
      wasteQuantity: "200",
      plannedRequirement: "2200",
      baseCostSatang: null,
      wasteCostSatang: null,
    },
  ],
  packagingRequirements: [
    {
      packagingRuleId: RULE_ID,
      scope: "PRODUCT",
      consumptionBasis: "PER_PRODUCT_UNIT",
      productId: PRODUCT_ID,
      deliveryMethodId: null,
      targetName: "ฟอคคาเซีย",
      inventoryItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      inventoryItemName: "ถุงขนม",
      baseUnit: "piece",
      ruleQuantity: "1",
      multiplier: "12",
      plannedRequirement: "12",
      costSatang: 1200,
    },
  ],
  productCosts: [
    {
      productId: PRODUCT_ID,
      knownBaseIngredientCostSatang: 0,
      knownWasteCostSatang: 0,
      knownProductPackagingCostSatang: 1200,
      laborCostSatang: 6000,
      utilityCostSatang: 2000,
      knownProductionCostSatang: 9200,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 1,
    },
  ],
  cycleCost: {
    knownBaseIngredientCostSatang: 0,
    knownWasteCostSatang: 0,
    knownProductPackagingCostSatang: 1200,
    knownDeliveryPackagingCostSatang: 145,
    laborCostSatang: 7000,
    utilityCostSatang: 4000,
    knownProductionCostSatang: 12345,
    completeProductionCostSatang: null,
    costComplete: false,
    missingPriceCount: 1,
  },
};

function previewWithoutBlockers(
  overrides: Partial<PlanningPreview> = {},
): PlanningPreview {
  return { ...BASE_PREVIEW, blockers: [], ...overrides };
}

describe("PlanningPreviewForm", () => {
  beforeEach(() => {
    actions.lockCycleAction.mockReset();
    actions.lockCycleAction.mockResolvedValue(OK_STATE);
    router.refresh.mockReset();
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(NEXT_REQUEST_ID)
      .mockReturnValue(NEXT_REQUEST_ID);
  });

  afterEach(() => vi.restoreAllMocks());

  it("announces blockers and warnings, shows incomplete known cost, and disables locking", () => {
    render(<PlanningPreviewForm preview={BASE_PREVIEW} />);

    expect(screen.getByRole("alert", { name: "รายการที่ต้องแก้" })).toHaveTextContent(
      "ผลผลิตของสูตรต้องมากกว่า 0",
    );
    expect(screen.getByRole("alert", { name: "คำเตือน" })).toHaveTextContent(
      "รายการนี้ยังไม่มีราคาที่ใช้คำนวณต้นทุน",
    );
    expect(screen.getByText("ต้นทุนไม่สมบูรณ์")).toBeInTheDocument();
    expect(screen.getByText("ต้นทุนที่ทราบของ ฟอคคาเซีย ฿92.00"))
      .toBeInTheDocument();
    expect(screen.getByText("ต้นทุนที่คำนวณได้ ฿123.45")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันล็อกรอบ" })).toBeDisabled();
  });

  it("requires a valid explained override and submits the exact stable payload once", async () => {
    let resolveAction: ((state: PlanningActionState) => void) | undefined;
    actions.lockCycleAction.mockImplementation(
      () =>
        new Promise<PlanningActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<PlanningPreviewForm preview={previewWithoutBlockers()} />);
    const batch = screen.getByRole("textbox", {
      name: "จำนวนแบตช์ ฟอคคาเซีย",
    });

    await user.clear(batch);
    expect(batch).toHaveAttribute("aria-describedby", `batch-error-${PRODUCT_ID}`);
    expect(screen.getByText("จำนวนแบตช์ต้องเป็นเลขบวก ทศนิยมไม่เกิน 6 ตำแหน่ง"))
      .toBeInTheDocument();
    await user.type(batch, "1.5");
    expect(screen.getByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย")).toBeRequired();
    expect(screen.getByText("ผลผลิตตามแผน 9 ชิ้น")).toBeInTheDocument();
    expect(screen.getByText("ส่วนต่าง -1 ชิ้น")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันล็อกรอบ" })).toBeDisabled();
    expect(actions.lockCycleAction).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย"),
      "ลดของเหลือ",
    );
    const submit = screen.getByRole("button", { name: "ยืนยันล็อกรอบ" });
    await user.click(submit);
    await user.click(submit);

    await waitFor(() => expect(actions.lockCycleAction).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "กำลังล็อกรอบ…" })).toBeDisabled();
    const submitted = actions.lockCycleAction.mock.calls[0]![1] as FormData;
    expect(JSON.parse(String(submitted.get("payload")))).toEqual({
      cycleId: CYCLE_ID,
      inputFingerprint: FINGERPRINT,
      lockRequestId: REQUEST_ID,
      overrides: [
        {
          productId: PRODUCT_ID,
          selectedBatchCount: "1.5",
          reason: "ลดของเหลือ",
        },
      ],
    });
    resolveAction?.(OK_STATE);
  });

  it("renders product-keyed server errors beside the matching override controls", async () => {
    actions.lockCycleAction.mockResolvedValueOnce({
      error: null,
      fieldErrors: {
        [`selectedBatchCount.${PRODUCT_ID}`]: "จำนวนแบตช์ไม่ถูกต้อง",
        [`reason.${PRODUCT_ID}`]: "กรุณาระบุเหตุผล",
      },
      stale: false,
    });
    const user = userEvent.setup();
    render(<PlanningPreviewForm preview={previewWithoutBlockers()} />);

    await user.clear(screen.getByLabelText("จำนวนแบตช์ ฟอคคาเซีย"));
    await user.type(screen.getByLabelText("จำนวนแบตช์ ฟอคคาเซีย"), "1.5");
    await user.type(
      screen.getByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย"),
      "ลดของเหลือ",
    );
    await user.click(screen.getByRole("button", { name: "ยืนยันล็อกรอบ" }));

    const productCard = screen.getByRole("article");
    expect(await within(productCard).findByText("จำนวนแบตช์ไม่ถูกต้อง"))
      .toHaveAttribute("id", `batch-error-${PRODUCT_ID}`);
    expect(within(productCard).getByText("กรุณาระบุเหตุผล")).toHaveAttribute(
      "id",
      `reason-error-${PRODUCT_ID}`,
    );
    expect(screen.getByLabelText("จำนวนแบตช์ ฟอคคาเซีย")).toHaveAttribute(
      "aria-describedby",
      `batch-error-${PRODUCT_ID}`,
    );
    expect(screen.getByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย")).toHaveAttribute(
      "aria-describedby",
      `reason-error-${PRODUCT_ID}`,
    );
  });

  it("refreshes stale data and resets override state and request id for a new fingerprint", async () => {
    actions.lockCycleAction
      .mockResolvedValueOnce({
        error: "ข้อมูลรอบเปลี่ยนแล้ว กรุณาตรวจสอบแผนอีกครั้ง",
        fieldErrors: {},
        stale: true,
      })
      .mockResolvedValue(OK_STATE);
    const user = userEvent.setup();
    const { rerender } = render(
      <PlanningPreviewForm preview={previewWithoutBlockers()} />,
    );
    const batch = screen.getByLabelText("จำนวนแบตช์ ฟอคคาเซีย");
    await user.clear(batch);
    await user.type(batch, "1.5");
    await user.type(
      screen.getByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย"),
      "ลดของเหลือ",
    );
    await user.click(screen.getByRole("button", { name: "ยืนยันล็อกรอบ" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());

    rerender(
      <PlanningPreviewForm
        preview={previewWithoutBlockers({ inputFingerprint: NEXT_FINGERPRINT })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("จำนวนแบตช์ ฟอคคาเซีย")).toHaveValue("2"),
    );
    expect(screen.queryByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย")).toBeNull();
    await user.click(screen.getByRole("button", { name: "ยืนยันล็อกรอบ" }));
    await waitFor(() => expect(actions.lockCycleAction).toHaveBeenCalledTimes(2));
    const submitted = actions.lockCycleAction.mock.calls[1]![1] as FormData;
    expect(JSON.parse(String(submitted.get("payload")))).toEqual({
      cycleId: CYCLE_ID,
      inputFingerprint: NEXT_FINGERPRINT,
      lockRequestId: NEXT_REQUEST_ID,
      overrides: [],
    });
  });

  it("keeps every interactive control touch-safe and the phone action above navigation", async () => {
    const user = userEvent.setup();
    render(<PlanningPreviewForm preview={previewWithoutBlockers()} />);
    await user.click(screen.getByText("วัตถุดิบที่ต้องใช้"));
    const batch = screen.getByLabelText("จำนวนแบตช์ ฟอคคาเซีย");
    await user.clear(batch);
    await user.type(batch, "1.5");

    expect(batch).toHaveClass("min-h-11");
    expect(batch).toBeRequired();
    expect(screen.getByLabelText("เหตุผลที่ปรับ ฟอคคาเซีย")).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByText("วัตถุดิบที่ต้องใช้")).toHaveClass("min-h-11");
    expect(screen.getByText("บรรจุภัณฑ์ที่ต้องใช้")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "ยืนยันล็อกรอบ" })).toHaveClass(
      "min-h-12",
    );
    expect(screen.getByTestId("planning-lock-action")).toHaveClass(
      "sticky",
      "bottom-20",
      "z-20",
    );
  });
});
