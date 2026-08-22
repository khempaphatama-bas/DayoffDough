import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail } from "@/modules/orders/application/orders";

const mocks = vi.hoisted(() => ({
  listCycles: vi.fn(),
  listCustomers: vi.fn(),
  listOrders: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/orders/application/orders", () => ({
  createOrderService: () => ({ list: mocks.listOrders }),
}));
vi.mock("@/modules/cycles/application/cycles", () => ({
  createCycleService: () => ({ list: mocks.listCycles }),
}));
vi.mock("@/modules/customers/application/customers", () => ({
  createCustomerService: () => ({ list: mocks.listCustomers }),
}));

import OrdersPage from "./page";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000010";
const CYCLE_ID = "00000000-0000-4000-8000-000000000020";
const ORDER_ID = "00000000-0000-4000-8000-000000000060";

const ORDER: OrderDetail = {
  id: ORDER_ID,
  ownerId: OWNER_ID,
  customerId: CUSTOMER_ID,
  customerName: "คุณเมย์",
  bakeCycleId: CYCLE_ID,
  cycleName: "รอบส่ง 30 ส.ค.",
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
  fulfillmentStatus: "CANCELLED",
  createdAt: new Date("2026-08-20T02:00:00.000Z"),
  updatedAt: new Date("2026-08-20T02:00:00.000Z"),
  items: [
    {
      id: "00000000-0000-4000-8000-000000000070",
      ownerId: OWNER_ID,
      orderId: ORDER_ID,
      productId: "00000000-0000-4000-8000-000000000040",
      productName: "Focaccia",
      quantity: 2,
      unitPriceSatang: 22000,
      lineNote: null,
      createdAt: new Date("2026-08-20T02:00:00.000Z"),
      updatedAt: new Date("2026-08-20T02:00:00.000Z"),
    },
  ],
  totals: {
    subtotalSatang: 44000,
    grandTotalSatang: 54000,
    balanceSatang: 34000,
    overpaidSatang: 0,
    paymentStatus: "PARTIAL",
  },
};

describe("OrdersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.listOrders.mockResolvedValue([ORDER]);
    mocks.listCycles.mockResolvedValue([
      {
        id: CYCLE_ID,
        cycleNumber: 12,
        name: "รอบส่ง 30 ส.ค.",
        status: "OPEN",
      },
    ]);
    mocks.listCustomers.mockResolvedValue([
      { id: CUSTOMER_ID, name: "คุณเมย์", active: true },
    ]);
  });

  it("builds validated filters and keeps cancelled orders visible", async () => {
    render(
      await OrdersPage({
        searchParams: Promise.resolve({
          query: "เมย์",
          bakeCycleId: CYCLE_ID,
          customerId: CUSTOMER_ID,
          paymentStatus: "PARTIAL",
          fulfillmentStatus: "CANCELLED",
        }),
      }),
    );

    expect(mocks.listOrders).toHaveBeenCalledWith(OWNER_ID, {
      query: "เมย์",
      bakeCycleId: CYCLE_ID,
      customerId: CUSTOMER_ID,
      paymentStatus: "PARTIAL",
      fulfillmentStatus: "CANCELLED",
    });
    for (const label of ["ค้นหา", "รอบผลิต", "การชำระเงิน", "การจัดเตรียม"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "ล้างตัวกรอง" })).toHaveAttribute(
      "href",
      "/orders",
    );
    expect(screen.getAllByText("คุณเมย์").length).toBeGreaterThan(0);
    expect(screen.getAllByText("รอบส่ง 30 ส.ค.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 รายการสินค้า").length).toBeGreaterThan(0);
    expect(screen.getAllByText("฿540.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ยกเลิก").length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole("link", { name: "แก้ไขออเดอร์" })) {
      expect(link).toHaveAttribute("href", `/orders/${ORDER_ID}`);
    }
  });

  it("omits arrays, malformed ids, and unknown status values", async () => {
    render(
      await OrdersPage({
        searchParams: Promise.resolve({
          query: ["ไม่ควรใช้"],
          bakeCycleId: "not-a-uuid",
          customerId: "also-invalid",
          paymentStatus: "DELETED",
          fulfillmentStatus: "UNKNOWN",
        }),
      }),
    );

    expect(mocks.listOrders).toHaveBeenCalledWith(OWNER_ID, {});
  });
});
