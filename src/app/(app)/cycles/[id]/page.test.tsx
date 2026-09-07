import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import type {
  CycleOrderSummary,
  OrderDetail,
} from "@/modules/orders/application/orders";

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/app/(app)/cycles/actions", () => ({
  changeCycleStatusAction: vi.fn(),
  createCycleAction: vi.fn(),
  updateCycleAction: vi.fn(),
}));

import { CycleDetail } from "./cycle-detail";

const CYCLE: BakeCycle = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "00000000-0000-4000-8000-000000000001",
  cycleNumber: 12,
  name: "รอบส่ง 30 ส.ค.",
  status: "OPEN",
  orderCutoffAt: new Date("2026-08-27T05:00:00.000Z"),
  targetProductionDate: "2026-08-29",
  primaryDeliveryDate: "2026-08-30",
  notes: "อบช่วงเช้า",
  lockedAt: null,
  activePlanningSnapshotId: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

const SUMMARY: CycleOrderSummary = {
  activeOrderCount: 1,
  cancelledOrderCount: 1,
  grandTotalSatang: 62000,
  amountPaidSatang: 20000,
  balanceSatang: 42000,
  demand: [
    {
      productId: "22222222-2222-4222-8222-222222222222",
      productName: "Focaccia",
      sellingUnit: "piece",
      quantity: 3,
    },
    {
      productId: "33333333-3333-4333-8333-333333333333",
      productName: "Scone",
      sellingUnit: "kg",
      quantity: 1,
    },
  ],
};

function makeOrder(
  id: string,
  customerName: string,
  fulfillmentStatus: OrderDetail["fulfillmentStatus"],
): OrderDetail {
  return {
    id,
    ownerId: CYCLE.ownerId,
    customerId: "44444444-4444-4444-8444-444444444444",
    customerName,
    bakeCycleId: CYCLE.id,
    cycleName: CYCLE.name,
    cycleStatus: CYCLE.status,
    sourceChannel: "INSTAGRAM",
    requestedDeliveryDate: "2026-08-30",
    confirmedDeliveryDate: "2026-08-30",
    deliveryMethodId: null,
    deliveryMethodName: null,
    deliveryFeeChargedSatang: 12000,
    deliveryCostSatang: 12000,
    deliveryFeePayer: "CUSTOMER",
    discountSatang: 2000,
    amountPaidSatang: 20000,
    deliveryLocation: "บางรัก กรุงเทพฯ",
    deliveryNote: null,
    specialInstructions: null,
    paymentStatus: "PARTIAL",
    fulfillmentStatus,
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    items: [
      {
        id: `${id.slice(0, -1)}9`,
        ownerId: CYCLE.ownerId,
        orderId: id,
        productId: SUMMARY.demand[0]!.productId,
        productName: "Focaccia",
        quantity: 2,
        unitPriceSatang: 22000,
        lineNote: null,
        createdAt: new Date("2026-08-21T00:00:00.000Z"),
        updatedAt: new Date("2026-08-21T00:00:00.000Z"),
      },
    ],
    totals: {
      subtotalSatang: 52000,
      grandTotalSatang: 62000,
      balanceSatang: 42000,
      overpaidSatang: 0,
      paymentStatus: "PARTIAL",
    },
  };
}

const ORDERS = [
  makeOrder("55555555-5555-4555-8555-555555555555", "คุณเมย์", "NEW"),
  makeOrder(
    "66666666-6666-4666-8666-666666666666",
    "คุณอ้อม",
    "CANCELLED",
  ),
];

describe("CycleDetail", () => {
  it("shows live money, production demand, and cancelled order history", () => {
    render(<CycleDetail cycle={CYCLE} orders={ORDERS} summary={SUMMARY} />);

    expect(screen.getByRole("heading", { name: CYCLE.name })).toBeInTheDocument();
    expect(screen.getByText("รอบ #12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← รอบอบ" })).toHaveClass(
      "inline-flex",
      "min-h-11",
      "items-center",
    );
    expect(screen.getByRole("link", { name: "เพิ่มออเดอร์" })).toHaveAttribute(
      "href",
      `/orders/new?cycleId=${CYCLE.id}`,
    );
    expect(
      screen.getByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
    ).toHaveAttribute("href", `/cycles/${CYCLE.id}/planning`);
    expect(
      screen.getByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
    ).toHaveClass("min-h-12");
    expect(screen.queryByRole("link", { name: "ดูแผนการผลิต" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "เช็กสต๊อกและรายการซื้อ" }),
    ).toBeNull();
    const status = screen.getByLabelText("เปลี่ยนสถานะ");
    const statusOptions = Array.from(status.querySelectorAll("option"));
    expect(status).toHaveValue("");
    expect(statusOptions.map((option) => option.value)).toEqual([
      "",
      "DRAFT",
      "CANCELLED",
    ]);
    expect(statusOptions[0]).toBeDisabled();
    expect(screen.getByText("ออเดอร์ที่ใช้งาน")).toBeInTheDocument();
    expect(screen.getByText("1 ออเดอร์")).toBeInTheDocument();
    expect(screen.getAllByText("฿620.00").length).toBeGreaterThan(0);
    expect(screen.getByText("฿200.00")).toBeInTheDocument();
    expect(screen.getByText("฿420.00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ความต้องการผลิต" })).toBeInTheDocument();
    expect(screen.getByText("Focaccia")).toBeInTheDocument();
    expect(screen.getByText("3 ชิ้น")).toBeInTheDocument();
    expect(screen.getByText("Scone")).toBeInTheDocument();
    expect(screen.getByText("1 kg")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ออเดอร์ในรอบนี้" })).toBeInTheDocument();
    expect(screen.getAllByText("คุณเมย์").length).toBeGreaterThan(0);
    expect(screen.getAllByText("คุณอ้อม").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ยกเลิก").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("ชื่อรอบอบ")).toHaveValue(CYCLE.name);
  });

  it("explains that production inputs are frozen until the cycle is unlocked", () => {
    const { rerender } = render(
      <CycleDetail
        cycle={{ ...CYCLE, status: "IN_PRODUCTION" }}
        orders={ORDERS}
        summary={SUMMARY}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ข้อมูลที่กระทบการผลิตถูกล็อก กรุณาปลดล็อกรอบก่อนแก้ไข",
    );
    expect(screen.queryByRole("link", { name: "เพิ่มออเดอร์" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "แก้ไขออเดอร์" }).length,
    ).toBeGreaterThan(0);

    rerender(
      <CycleDetail
        cycle={{ ...CYCLE, status: "CANCELLED" }}
        orders={ORDERS}
        summary={{ ...SUMMARY, demand: [] }}
      />,
    );
    expect(screen.queryByRole("link", { name: "เพิ่มออเดอร์" })).toBeNull();
    expect(screen.getByText("ยังไม่มีสินค้าที่ต้องผลิต")).toBeInTheDocument();
  });

  it("links an active immutable plan back to the planning route", () => {
    render(
      <CycleDetail
        cycle={{
          ...CYCLE,
          status: "LOCKED",
          activePlanningSnapshotId: "77777777-7777-4777-8777-777777777777",
          lockedAt: new Date("2026-08-29T06:00:00.000Z"),
        }}
        orders={ORDERS}
        summary={SUMMARY}
      />,
    );

    expect(screen.getByRole("link", { name: "ดูแผนการผลิต" })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE.id}/planning`,
    );
    expect(screen.getByRole("link", { name: "ดูแผนการผลิต" })).toHaveClass(
      "min-h-12",
    );
    expect(
      screen.getByRole("link", { name: "เช็กสต๊อกและรายการซื้อ" }),
    ).toHaveAttribute("href", `/cycles/${CYCLE.id}/shopping`);
    expect(
      screen.getByRole("link", { name: "เช็กสต๊อกและรายการซื้อ" }),
    ).toHaveClass("min-h-12");
    expect(
      screen.queryByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
    ).toBeNull();
  });

  it("does not offer planning entry points before a DRAFT cycle is open", () => {
    render(
      <CycleDetail
        cycle={{ ...CYCLE, status: "DRAFT" }}
        orders={ORDERS}
        summary={SUMMARY}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "ตรวจแผนและล็อกรอบ" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "ดูแผนการผลิต" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "เช็กสต๊อกและรายการซื้อ" }),
    ).toBeNull();
  });
});
