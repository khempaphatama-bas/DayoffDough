import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomer: vi.fn(),
  listDeliveryConfiguration: vi.fn(),
  listOrders: vi.fn(),
  notFound: vi.fn(),
  requireOwner: vi.fn(),
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/customers/application/customers", () => ({
  createCustomerService: () => ({ get: mocks.getCustomer }),
}));
vi.mock("@/modules/delivery/application/delivery", () => ({
  createDeliveryService: () => ({
    listDeliveryConfiguration: mocks.listDeliveryConfiguration,
  }),
}));
vi.mock("@/modules/orders/application/orders", () => ({
  createOrderService: () => ({ list: mocks.listOrders }),
}));
vi.mock("@/app/(app)/customers/actions", () => ({
  createCustomerAction: mocks.createCustomerAction,
  updateCustomerAction: mocks.updateCustomerAction,
}));

import CustomerDetailPage from "./page";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000010";
const CYCLE_ID = "00000000-0000-4000-8000-000000000020";

describe("CustomerDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.getCustomer.mockResolvedValue({
      id: CUSTOMER_ID,
      ownerId: OWNER_ID,
      name: "คุณเมย์",
      contactHandle: "@may",
      phone: null,
      defaultDeliveryMethodId: null,
      defaultDeliveryLocation: null,
      defaultDeliveryNote: null,
      notes: null,
      active: true,
    });
    mocks.listDeliveryConfiguration.mockResolvedValue({ methods: [] });
    mocks.listOrders.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000060",
        customerId: CUSTOMER_ID,
        customerName: "คุณเมย์",
        bakeCycleId: CYCLE_ID,
        cycleName: "รอบปัจจุบัน",
        fulfillmentStatus: "CONFIRMED",
        paymentStatus: "PARTIAL",
        createdAt: new Date("2026-08-21T00:00:00.000Z"),
        items: [{ id: "line-1" }],
        totals: { grandTotalSatang: 62000 },
      },
      {
        id: "00000000-0000-4000-8000-000000000061",
        customerId: CUSTOMER_ID,
        customerName: "คุณเมย์",
        bakeCycleId: CYCLE_ID,
        cycleName: "รอบก่อนหน้า",
        fulfillmentStatus: "CANCELLED",
        paymentStatus: "UNPAID",
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        items: [{ id: "line-2" }],
        totals: { grandTotalSatang: 22000 },
      },
    ]);
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("loads customer-scoped order history including cancelled rows", async () => {
    render(
      await CustomerDetailPage({
        params: Promise.resolve({ id: CUSTOMER_ID }),
      }),
    );

    expect(mocks.listOrders).toHaveBeenCalledWith(OWNER_ID, {
      customerId: CUSTOMER_ID,
    });
    expect(screen.getByRole("heading", { name: "ประวัติออเดอร์" })).toBeInTheDocument();
    expect(screen.getAllByText("รอบปัจจุบัน").length).toBeGreaterThan(0);
    expect(screen.getAllByText("รอบก่อนหน้า").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ยกเลิก").length).toBeGreaterThan(0);
    expect(
      new Set(
        screen
          .getAllByRole("link", { name: "แก้ไขออเดอร์" })
          .map((link) => link.getAttribute("href")),
      ),
    ).toEqual(
      new Set([
        "/orders/00000000-0000-4000-8000-000000000060",
        "/orders/00000000-0000-4000-8000-000000000061",
      ]),
    );
  });
});
