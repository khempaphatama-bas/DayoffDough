import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  PlanningGenerationSummary,
  PlanningGenerationView as PlanningGenerationViewData,
} from "@/modules/planning/application/planning-queries";
import { PlanningGenerationView } from "./planning-generation-view";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

const GENERATIONS: ReadonlyArray<PlanningGenerationSummary> = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    cycleId: CYCLE_ID,
    generation: 2,
    status: "ACTIVE",
    costComplete: false,
    lockedAt: new Date("2026-08-29T06:00:00.000Z"),
    unlockedAt: null,
    unlockReason: null,
    unlockedFromStatus: null,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    cycleId: CYCLE_ID,
    generation: 1,
    status: "SUPERSEDED",
    costComplete: true,
    lockedAt: new Date("2026-08-27T06:00:00.000Z"),
    unlockedAt: new Date("2026-08-28T08:30:00.000Z"),
    unlockReason: "เพิ่มออเดอร์ด่วน",
    unlockedFromStatus: "LOCKED",
  },
];

const INCOMPLETE_GENERATION: PlanningGenerationViewData = {
  ...GENERATIONS[0]!,
  cycleName: "รอบส่ง 30 ส.ค.",
  warnings: [
    {
      code: "ORDER_PARTIAL",
      scope: "ORDER",
      sourceEntityId: "66666666-6666-4666-8666-666666666666",
      message: "มีออเดอร์ที่ชำระเงินบางส่วน",
      context: {},
    },
  ],
  orders: [],
  productPlans: [
    {
      productId: PRODUCT_ID,
      productName: "Focaccia",
      sellingUnit: "piece",
      orderedQuantity: "20",
      yieldInSellingUnit: "12",
      suggestedBatchCount: 2,
      selectedBatchCount: "2",
      overrideReason: null,
      plannedOutput: "24",
      outputDifference: "4",
    },
    {
      productId: SECOND_PRODUCT_ID,
      productName: "Scone",
      sellingUnit: "piece",
      orderedQuantity: "10",
      yieldInSellingUnit: "8",
      suggestedBatchCount: 2,
      selectedBatchCount: "1",
      overrideReason: "รับยอดขาด 2 ชิ้น",
      plannedOutput: "8",
      outputDifference: "-2",
    },
  ],
  recipePlans: [],
  materialRequirements: [
    {
      productId: PRODUCT_ID,
      recipeIngredientId: "77777777-7777-4777-8777-777777777777",
      inventoryItemId: "88888888-8888-4888-8888-888888888888",
      inventoryItemName: "แป้งขนมปัง",
      baseUnit: "g",
      quantityPerBatch: "900",
      selectedBatchCount: "2",
      baseRequirement: "1800",
      wasteAllowancePercent: "11.111111",
      wasteQuantity: "200",
      plannedRequirement: "2000",
      baseCostSatang: 10000,
      wasteCostSatang: 1000,
    },
    {
      productId: SECOND_PRODUCT_ID,
      recipeIngredientId: "99999999-9999-4999-8999-999999999999",
      inventoryItemId: "88888888-8888-4888-8888-888888888888",
      inventoryItemName: "แป้งขนมปัง",
      baseUnit: "g",
      quantityPerBatch: "950",
      selectedBatchCount: "1",
      baseRequirement: "950",
      wasteAllowancePercent: "5.263158",
      wasteQuantity: "50",
      plannedRequirement: "1000",
      baseCostSatang: 5000,
      wasteCostSatang: 250,
    },
  ],
  packagingRequirements: [
    {
      packagingRuleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope: "PRODUCT",
      consumptionBasis: "PER_PRODUCT_UNIT",
      productId: PRODUCT_ID,
      deliveryMethodId: null,
      targetName: "Focaccia",
      inventoryItemId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      inventoryItemName: "ถุงคราฟต์",
      baseUnit: "piece",
      ruleQuantity: "1",
      multiplier: "24",
      plannedRequirement: "24",
      costSatang: 2400,
    },
  ],
  productCosts: [
    {
      productId: PRODUCT_ID,
      knownBaseIngredientCostSatang: 10000,
      knownWasteCostSatang: 1000,
      knownProductPackagingCostSatang: 2400,
      laborCostSatang: 3600,
      utilityCostSatang: 2000,
      knownProductionCostSatang: 19000,
      completeProductionCostSatang: null,
      costComplete: false,
      missingPriceCount: 1,
    },
  ],
  cycleCost: {
    knownBaseIngredientCostSatang: 15000,
    knownWasteCostSatang: 1250,
    knownProductPackagingCostSatang: 2400,
    knownDeliveryPackagingCostSatang: 515,
    laborCostSatang: 0,
    utilityCostSatang: 2000,
    knownProductionCostSatang: 21165,
    completeProductionCostSatang: null,
    costComplete: false,
    missingPriceCount: 1,
  },
};

describe("PlanningGenerationView", () => {
  it("renders an immutable incomplete generation with history and grouped copied requirements", () => {
    render(
      <PlanningGenerationView
        cycleId={CYCLE_ID}
        generation={INCOMPLETE_GENERATION}
        generations={GENERATIONS}
      />,
    );

    expect(screen.getByText("รุ่น 2")).toBeInTheDocument();
    expect(screen.getByText("ใช้งานอยู่")).toBeInTheDocument();
    expect(screen.getByText(/29 ส.ค. 2569.*13:00/)).toBeInTheDocument();
    expect(screen.getByText("คำเตือนที่ยอมรับตอนล็อกแผน")).toBeInTheDocument();
    expect(screen.getByText("มีออเดอร์ที่ชำระเงินบางส่วน")).toBeInTheDocument();

    const focaccia = screen.getByRole("article", { name: "Focaccia" });
    expect(focaccia).toHaveTextContent("ยอดสั่ง 20 ชิ้น");
    expect(focaccia).toHaveTextContent("แบตช์แนะนำ 2");
    expect(focaccia).toHaveTextContent("แบตช์ที่ล็อก 2");
    expect(focaccia).toHaveTextContent("ผลผลิตตามแผน 24 ชิ้น");
    expect(focaccia).toHaveTextContent("ส่วนต่าง 4 ชิ้น");
    const scone = screen.getByRole("article", { name: "Scone" });
    expect(scone).toHaveTextContent("ขาด 2 ชิ้น");
    expect(scone).toHaveTextContent("รับยอดขาด 2 ชิ้น");

    const flour = screen.getByRole("group", { name: "แป้งขนมปัง" });
    expect(flour).toHaveTextContent("รวม 3000 g");
    expect(flour).toHaveTextContent("Focaccia 2000 g");
    expect(flour).toHaveTextContent("Scone 1000 g");
    expect(screen.getByText("ถุงคราฟต์ 24 ชิ้น")).toBeInTheDocument();

    expect(screen.getByText("ต้นทุนไม่สมบูรณ์")).toBeInTheDocument();
    expect(screen.getByText("ยอดต้นทุนที่ทราบแล้ว ฿211.65")).toBeInTheDocument();
    expect(screen.queryByText(/ต้นทุนรวม ฿/)).toBeNull();

    expect(screen.getByRole("link", { name: /รุ่น 2.*ใช้งานอยู่/ })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}/planning?generation=2`,
    );
    const superseded = screen.getByRole("link", { name: /รุ่น 1.*แทนที่แล้ว/ });
    expect(superseded).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}/planning?generation=1`,
    );
    expect(screen.getByText("เหตุผลที่ปลดล็อก: เพิ่มออเดอร์ด่วน")).toBeInTheDocument();
    expect(screen.getByText(/ปลดล็อกเมื่อ.*28 ส.ค. 2569.*15:30/)).toBeInTheDocument();
  });

  it("shows complete totals and derives costs only from positive denominators", () => {
    const complete: PlanningGenerationViewData = {
      ...INCOMPLETE_GENERATION,
      costComplete: true,
      productPlans: [
        INCOMPLETE_GENERATION.productPlans[0]!,
        {
          ...INCOMPLETE_GENERATION.productPlans[1]!,
          orderedQuantity: "0",
          selectedBatchCount: "0",
          plannedOutput: "0",
          outputDifference: "0",
        },
      ],
      productCosts: [
        {
          ...INCOMPLETE_GENERATION.productCosts[0]!,
          knownProductionCostSatang: 18000,
          completeProductionCostSatang: 18000,
          costComplete: true,
          missingPriceCount: 0,
        },
        {
          ...INCOMPLETE_GENERATION.productCosts[0]!,
          productId: SECOND_PRODUCT_ID,
          knownProductionCostSatang: 100,
          completeProductionCostSatang: 100,
          costComplete: true,
          missingPriceCount: 0,
        },
      ],
      cycleCost: {
        ...INCOMPLETE_GENERATION.cycleCost,
        knownProductionCostSatang: 21165,
        completeProductionCostSatang: 21165,
        costComplete: true,
        missingPriceCount: 0,
      },
    };

    render(
      <PlanningGenerationView
        cycleId={CYCLE_ID}
        generation={complete}
        generations={GENERATIONS}
      />,
    );

    expect(screen.getByText("ต้นทุนรวม ฿211.65")).toBeInTheDocument();
    const focaccia = screen.getByRole("article", { name: "Focaccia" });
    expect(focaccia).toHaveTextContent("ต้นทุนต่อแบตช์ ฿90.00");
    expect(focaccia).toHaveTextContent("ต้นทุนต่อหน่วยตามแผน ฿7.50");
    expect(focaccia).toHaveTextContent("ต้นทุนต่อหน่วยที่สั่ง ฿9.00");
    const scone = screen.getByRole("article", { name: "Scone" });
    expect(within(scone).queryByText(/ต้นทุนต่อแบตช์/)).toBeNull();
    expect(within(scone).queryByText(/ต้นทุนต่อหน่วยตามแผน/)).toBeNull();
    expect(within(scone).queryByText(/ต้นทุนต่อหน่วยที่สั่ง/)).toBeNull();
  });
});
