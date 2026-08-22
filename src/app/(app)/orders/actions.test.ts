import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  createOrderService: vi.fn(),
  redirect: vi.fn(),
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/orders/application/orders", () => ({
  createOrderService: mocks.createOrderService,
}));

import { saveOrderAction } from "./actions";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000010";
const CYCLE_ID = "00000000-0000-4000-8000-000000000020";
const METHOD_ID = "00000000-0000-4000-8000-000000000030";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000040";
const ORDER_ID = "00000000-0000-4000-8000-000000000060";

const VALID_PAYLOAD = {
  customerId: CUSTOMER_ID,
  bakeCycleId: CYCLE_ID,
  sourceChannel: "INSTAGRAM",
  requestedDeliveryDate: "2026-08-30",
  confirmedDeliveryDate: "2026-08-30",
  deliveryMethodId: METHOD_ID,
  deliveryFeeChargedBaht: "120",
  deliveryCostBaht: "120",
  deliveryFeePayer: "CUSTOMER",
  discountBaht: "20",
  amountPaidBaht: "200",
  deliveryLocation: "บางรัก กรุงเทพฯ",
  deliveryNote: "โทรก่อนส่ง",
  specialInstructions: "",
  items: [
    {
      productId: PRODUCT_ID,
      quantity: "2",
      unitPriceBaht: "220",
      lineNote: "",
    },
  ],
};

function formData(orderId?: string): FormData {
  const data = new FormData();
  data.set("payload", JSON.stringify(VALID_PAYLOAD));
  if (orderId) data.set("orderId", orderId);
  return data;
}

describe("saveOrderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.createOrderService.mockReturnValue({
      create: mocks.create,
      update: mocks.update,
    });
    mocks.create.mockResolvedValue({ id: ORDER_ID, bakeCycleId: CYCLE_ID });
    mocks.update.mockResolvedValue({ id: ORDER_ID, bakeCycleId: CYCLE_ID });
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("authenticates, creates, revalidates affected pages, and lets redirect escape", async () => {
    await expect(saveOrderAction({ error: null, fieldErrors: {} }, formData()))
      .rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({
        deliveryFeeChargedSatang: 12000,
        items: [expect.objectContaining({ quantity: 2, unitPriceSatang: 22000 })],
      }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/orders",
      "/cycles",
      `/cycles/${CYCLE_ID}`,
      "/dashboard",
    ]);
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);
  });

  it("updates an identified order instead of creating another", async () => {
    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, formData(ORDER_ID)),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.update).toHaveBeenCalledWith(
      OWNER_ID,
      ORDER_ID,
      expect.objectContaining({ customerId: CUSTOMER_ID }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns Thai field errors for malformed data without mutating", async () => {
    const data = formData();
    data.set(
      "payload",
      JSON.stringify({ ...VALID_PAYLOAD, items: [{ ...VALID_PAYLOAD.items[0], quantity: "0" }] }),
    );

    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, data),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: { "items.0.quantity": "จำนวนสินค้าต้องเป็นเลขจำนวนเต็มที่มากกว่า 0" },
    });
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns an expected Thai save error without redirecting or losing client state", async () => {
    mocks.create.mockRejectedValue(new Error("Customer not found"));

    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, formData()),
    ).resolves.toEqual({
      error: "บันทึกออเดอร์ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง",
      fieldErrors: {},
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
