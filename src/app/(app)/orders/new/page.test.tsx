import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderFormOptions } from "@/modules/orders/application/orders";

const mocks = vi.hoisted(() => ({
  formOptions: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/orders/application/orders", () => ({
  createOrderService: () => ({ formOptions: mocks.formOptions }),
}));
vi.mock("@/app/(app)/orders/actions", () => ({ saveOrderAction: vi.fn() }));
vi.mock("@/app/(app)/customers/actions", () => ({
  createQuickCustomerAction: vi.fn(),
}));

import OrdersNewPage from "./page";

const FIRST_CYCLE_ID = "00000000-0000-4000-8000-000000000020";
const SECOND_CYCLE_ID = "00000000-0000-4000-8000-000000000021";
const OPTIONS: OrderFormOptions = {
  customers: [],
  products: [],
  deliveryMethods: [],
  bakeCycles: [
    {
      id: FIRST_CYCLE_ID,
      cycleNumber: 12,
      name: "รอบแรก",
      status: "OPEN",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    },
    {
      id: SECOND_CYCLE_ID,
      cycleNumber: 13,
      name: "รอบสอง",
      status: "DRAFT",
      targetProductionDate: "2026-09-05",
      primaryDeliveryDate: "2026-09-06",
    },
  ],
};

describe("OrdersNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "owner@example.com",
    });
    mocks.formOptions.mockResolvedValue(OPTIONS);
  });

  it("awaits search params and preselects an available cycle", async () => {
    render(
      await OrdersNewPage({
        searchParams: Promise.resolve({ cycleId: SECOND_CYCLE_ID }),
      }),
    );

    expect(screen.getByRole("heading", { name: "สร้างออเดอร์" })).toBeInTheDocument();
    expect(screen.getByLabelText("รอบผลิต")).toHaveValue(SECOND_CYCLE_ID);
    expect(screen.getByLabelText("เวลานัดส่ง")).toHaveValue("");
    expect(screen.getByLabelText("จำนวน รายการที่ 1")).toHaveValue(1);
    expect(screen.getByLabelText("ราคาต่อหน่วย รายการที่ 1 (บาท)")).toHaveValue("0.00");
  });

  it("does not trust a cycle id that is absent from create options", async () => {
    render(
      await OrdersNewPage({
        searchParams: Promise.resolve({
          cycleId: "00000000-0000-4000-8000-000000000099",
        }),
      }),
    );

    expect(screen.getByLabelText("รอบผลิต")).toHaveValue("");
  });
});
