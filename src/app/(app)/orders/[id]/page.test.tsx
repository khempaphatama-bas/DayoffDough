import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OrderDetail,
  OrderFormOptionIncludes,
  OrderFormOptions,
} from "@/modules/orders/application/orders";

const mocks = vi.hoisted(() => ({
  cancelOrderAction: vi.fn(),
  get: vi.fn(),
  formOptions: vi.fn(),
  markOrderRefundedAction: vi.fn(),
  notFound: vi.fn(),
  requireOwner: vi.fn(),
  restoreOrderPaymentTrackingAction: vi.fn(),
  saveOrderAction: vi.fn(),
  updateFulfillmentStatusAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/orders/application/orders", () => ({
  createOrderService: () => ({
    get: mocks.get,
    formOptions: mocks.formOptions,
  }),
}));
vi.mock("@/app/(app)/orders/actions", () => ({
  cancelOrderAction: mocks.cancelOrderAction,
  markOrderRefundedAction: mocks.markOrderRefundedAction,
  restoreOrderPaymentTrackingAction: mocks.restoreOrderPaymentTrackingAction,
  saveOrderAction: mocks.saveOrderAction,
  updateFulfillmentStatusAction: mocks.updateFulfillmentStatusAction,
}));
vi.mock("@/app/(app)/customers/actions", () => ({
  createQuickCustomerAction: vi.fn(),
}));

import OrderDetailPage from "./page";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000010";
const CYCLE_ID = "00000000-0000-4000-8000-000000000020";
const METHOD_ID = "00000000-0000-4000-8000-000000000030";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000040";
const ORDER_ID = "00000000-0000-4000-8000-000000000060";

const DETAIL: OrderDetail = {
  id: ORDER_ID,
  ownerId: OWNER_ID,
  customerId: CUSTOMER_ID,
  customerName: "คุณเมย์ (เก่า)",
  bakeCycleId: CYCLE_ID,
  cycleName: "รอบที่เสร็จแล้ว",
  cycleStatus: "COMPLETED",
  sourceChannel: "INSTAGRAM",
  requestedDeliveryDate: "2026-08-30",
  confirmedDeliveryDate: "2026-08-30",
  confirmedDeliveryTime: "14:30",
  deliveryMethodId: METHOD_ID,
  deliveryMethodName: "KEX เก่า",
  deliveryFeeChargedSatang: 12000,
  deliveryCostSatang: 11550,
  deliveryFeePayer: "CUSTOMER",
  discountSatang: 2000,
  amountPaidSatang: 20000,
  deliveryLocation: "บางรัก กรุงเทพฯ",
  deliveryNote: "โทรก่อนส่ง",
  specialInstructions: "แยกถุง",
  paymentStatus: "PARTIAL",
  fulfillmentStatus: "CONFIRMED",
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
  items: [
    {
      id: "00000000-0000-4000-8000-000000000070",
      ownerId: OWNER_ID,
      orderId: ORDER_ID,
      productId: PRODUCT_ID,
      productName: "Focaccia เก่า",
      quantity: 2,
      unitPriceSatang: 22050,
      lineNote: "อบเข้ม",
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    },
    {
      id: "00000000-0000-4000-8000-000000000071",
      ownerId: OWNER_ID,
      orderId: ORDER_ID,
      productId: PRODUCT_ID,
      productName: "Focaccia เก่า",
      quantity: 1,
      unitPriceSatang: 22050,
      lineNote: null,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    },
  ],
  totals: {
    subtotalSatang: 66150,
    grandTotalSatang: 76150,
    balanceSatang: 56150,
    overpaidSatang: 0,
    paymentStatus: "PARTIAL",
  },
};

const HISTORICAL_OPTIONS: OrderFormOptions = {
  customers: [
    {
      id: CUSTOMER_ID,
      name: DETAIL.customerName,
      contactHandle: null,
      phone: null,
      defaultDeliveryMethodId: METHOD_ID,
      defaultDeliveryLocation: DETAIL.deliveryLocation,
      defaultDeliveryNote: DETAIL.deliveryNote,
      active: false,
    },
  ],
  products: [
    {
      id: PRODUCT_ID,
      name: DETAIL.items[0]!.productName,
      defaultUnitPriceSatang: 25000,
      active: false,
    },
  ],
  deliveryMethods: [
    {
      id: METHOD_ID,
      name: DETAIL.deliveryMethodName!,
      defaultCustomerFeeSatang: 15000,
      defaultInternalCostSatang: 15000,
      requiresDeliveryLocation: true,
      active: false,
    },
  ],
  bakeCycles: [
    {
      id: CYCLE_ID,
      cycleNumber: 12,
      name: DETAIL.cycleName,
      status: "COMPLETED",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    },
  ],
};

describe("OrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.get.mockResolvedValue(DETAIL);
    mocks.formOptions.mockImplementation(
      async (_ownerId: string, include: OrderFormOptionIncludes | undefined) => {
        const keepsHistory =
          include?.customerId === CUSTOMER_ID &&
          include.bakeCycleId === CYCLE_ID &&
          include.deliveryMethodId === METHOD_ID &&
          JSON.stringify(include.productIds) === JSON.stringify([PRODUCT_ID]);
        return keepsHistory
          ? HISTORICAL_OPTIONS
          : { customers: [], products: [], deliveryMethods: [], bakeCycles: [] };
      },
    );
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("loads historical options and preserves stored baht copies in edit mode", async () => {
    render(await OrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) }));

    expect(screen.getByRole("heading", { name: "แก้ไขออเดอร์" })).toBeInTheDocument();
    expect(screen.getByText("ยอดสุทธิ")).toBeInTheDocument();
    expect(screen.getByText("฿761.50")).toBeInTheDocument();
    expect(screen.getByText("฿200.00")).toBeInTheDocument();
    expect(screen.getByText("฿561.50")).toBeInTheDocument();
    expect(screen.getByText("KEX เก่า")).toBeInTheDocument();
    expect(screen.getAllByText("ชำระบางส่วน").length).toBeGreaterThan(0);
    expect(screen.getByText("ยืนยันแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกออเดอร์" })).toBeNull();
    expect(screen.getByRole("button", { name: "เริ่มผลิต" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกคืนเงิน" })).toBeInTheDocument();
    expect(screen.getByLabelText("ลูกค้า")).toHaveValue(CUSTOMER_ID);
    expect(screen.getByLabelText("รอบผลิต")).toHaveValue(CYCLE_ID);
    expect(screen.getByLabelText("วิธีจัดส่ง")).toHaveValue(METHOD_ID);
    expect(screen.getByLabelText("เวลานัดส่ง")).toHaveValue("14:30");
    expect(screen.getByLabelText("เวลานัดส่ง")).toBeDisabled();
    expect(screen.getAllByRole("option", { name: /Focaccia เก่า/ })).toHaveLength(2);
    expect(screen.getByLabelText("ราคาต่อหน่วย รายการที่ 1 (บาท)")).toHaveValue("220.50");
    expect(screen.getByLabelText("ต้นทุนจัดส่ง (บาท)")).toHaveValue("115.50");
    expect(screen.getByText(
      "รอบผลิตถูกล็อกแล้ว แก้ได้เฉพาะยอดชำระและสถานะที่ไม่กระทบการผลิต",
    )).toBeInTheDocument();
    expect(screen.getByLabelText("ลูกค้า")).toBeDisabled();
    expect(screen.getByLabelText("จำนวน รายการที่ 1")).toBeDisabled();
    expect(screen.getByLabelText("ยอดชำระแล้ว (บาท)")).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "บันทึกยอดชำระ" }))
      .toHaveLength(2);
  });

  it("turns only the exact missing-order service error into not found", async () => {
    mocks.get.mockRejectedValueOnce(new Error("Order not found"));
    await expect(
      OrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    mocks.get.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      OrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) }),
    ).rejects.toThrow("database unavailable");
  });
});
