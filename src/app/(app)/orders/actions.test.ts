import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { OperationsStateError } from "@/modules/operations/domain/types";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  create: vi.fn(),
  markRefunded: vi.fn(),
  restorePaymentTracking: vi.fn(),
  update: vi.fn(),
  updateFulfillmentStatus: vi.fn(),
  confirmBeforeProduction: vi.fn(),
  createOrderService: vi.fn(),
  redirect: vi.fn(),
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
  select: vi.fn(), where: vi.fn(), innerJoin: vi.fn(),
  confirmOrders: vi.fn(), startOrders: vi.fn(), confirmOrderPacked: vi.fn(), deliverOrders: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/modules/operations/application/order-commands", () => ({ createOrderOperationsCommandService: () => mocks }));
vi.mock("@/modules/orders/application/orders", () => ({
  createOrderService: mocks.createOrderService,
}));

import {
  cancelOrderAction,
  markOrderRefundedAction,
  restoreOrderPaymentTrackingAction,
  saveOrderAction,
  updateFulfillmentStatusAction,
} from "./actions";

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
  confirmedDeliveryTime: "14:30",
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
      cancel: mocks.cancel,
      create: mocks.create,
      markRefunded: mocks.markRefunded,
      restorePaymentTracking: mocks.restorePaymentTracking,
      update: mocks.update,
      updateFulfillmentStatus: mocks.updateFulfillmentStatus,
      confirmBeforeProduction: mocks.confirmBeforeProduction,
    });
    mocks.create.mockResolvedValue({ id: ORDER_ID, bakeCycleId: CYCLE_ID });
    mocks.update.mockResolvedValue({ id: ORDER_ID, bakeCycleId: CYCLE_ID });
    const statusResult = {
      id: ORDER_ID,
      bakeCycleId: CYCLE_ID,
      customerId: CUSTOMER_ID,
    };
    mocks.cancel.mockResolvedValue(statusResult);
    mocks.markRefunded.mockResolvedValue(statusResult);
    mocks.restorePaymentTracking.mockResolvedValue(statusResult);
    mocks.updateFulfillmentStatus.mockResolvedValue(statusResult);
    mocks.confirmBeforeProduction.mockResolvedValue(statusResult);
    const query = { from: vi.fn(), innerJoin: mocks.innerJoin, where: mocks.where, limit: vi.fn() };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit.mockResolvedValue([{ ...statusResult, cycleStatus: "OPEN" }]);
    mocks.select.mockReturnValue(query);
    for (const command of [mocks.confirmOrders, mocks.startOrders, mocks.confirmOrderPacked, mocks.deliverOrders]) command.mockResolvedValue(statusResult);
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

  it("returns an excessive discount beside discountBaht without mutating", async () => {
    const data = formData();
    data.set(
      "payload",
      JSON.stringify({
        ...VALID_PAYLOAD,
        deliveryFeeChargedBaht: "0",
        discountBaht: "1000",
      }),
    );

    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, data),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: {
        discountBaht: "ส่วนลดต้องไม่เกินยอดสินค้าและค่าส่ง",
      },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns a Thai delivery-time error without mutating", async () => {
    const data = formData();
    data.set(
      "payload",
      JSON.stringify({
        ...VALID_PAYLOAD,
        confirmedDeliveryTime: "14:30:01",
      }),
    );

    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, data),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: { confirmedDeliveryTime: "เวลานัดส่งไม่ถูกต้อง" },
    });
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

  it("maps only the exact production-freeze rejection for order saves", async () => {
    mocks.update.mockRejectedValueOnce(
      new Error("Cycle production inputs are locked"),
    );

    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, formData(ORDER_ID)),
    ).resolves.toEqual({
      error: "รอบผลิตถูกล็อก กรุณาปลดล็อกรอบก่อนแก้ข้อมูลนี้",
      fieldErrors: {},
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.update.mockRejectedValueOnce(
      new Error("Cycle production inputs are locked by database unavailable"),
    );
    await expect(
      saveOrderAction({ error: null, fieldErrors: {} }, formData(ORDER_ID)),
    ).resolves.toEqual({
      error: "บันทึกออเดอร์ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง",
      fieldErrors: {},
    });
  });

  it.each([
    [
      "updates fulfillment",
      updateFulfillmentStatusAction,
      "CONFIRMED",
      mocks.confirmBeforeProduction,
      [OWNER_ID, ORDER_ID],
    ],
    [
      "cancels",
      cancelOrderAction,
      "CANCELLED",
      mocks.cancel,
      [OWNER_ID, ORDER_ID],
    ],
    [
      "marks refunded",
      markOrderRefundedAction,
      "REFUNDED",
      mocks.markRefunded,
      [OWNER_ID, ORDER_ID],
    ],
    [
      "restores payment tracking",
      restoreOrderPaymentTrackingAction,
      "RESTORE",
      mocks.restorePaymentTracking,
      [OWNER_ID, ORDER_ID],
    ],
  ] as const)(
    "%s with authentication, validation, and all affected revalidations",
    async (_name, action, status, mutation, expectedArguments) => {
      const data = new FormData();
      data.set("orderId", ORDER_ID);
      data.set("status", status);

      await expect(
        action({ error: null, saved: false }, data),
      ).resolves.toEqual({ error: null, saved: true });

      expect(mocks.requireOwner).toHaveBeenCalledOnce();
      expect(mutation).toHaveBeenCalledWith(...expectedArguments);
      expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
        "/orders",
        `/orders/${ORDER_ID}`,
        "/cycles",
        `/cycles/${CYCLE_ID}`,
        `/customers/${CUSTOMER_ID}`,
        "/dashboard",
        ...(action === updateFulfillmentStatusAction ? [
          `/cycles/${CYCLE_ID}/operations`, `/cycles/${CYCLE_ID}/production`, `/cycles/${CYCLE_ID}/planning`,
        ] : []),
      ]);
    },
  );

  it("returns a serializable Thai status error for untrusted values", async () => {
    const data = new FormData();
    data.set("orderId", "not-an-order-id");
    data.set("status", "DELETED");

    await expect(
      updateFulfillmentStatusAction({ error: null, saved: false }, data),
    ).resolves.toEqual({
      error: "กรุณาตรวจสอบสถานะออเดอร์",
      saved: false,
    });
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.confirmBeforeProduction).not.toHaveBeenCalled();
  });

  it("returns a serializable Thai failure when the service rejects a transition", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.confirmBeforeProduction.mockRejectedValueOnce(
      new Error("Invalid fulfillment transition"),
    );
    const data = new FormData();
    data.set("orderId", ORDER_ID);
    data.set("status", "CONFIRMED");

    await expect(
      updateFulfillmentStatusAction({ error: null, saved: false }, data),
    ).resolves.toEqual({
      error: "อัปเดตสถานะออเดอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith("Order fulfillment action failed");
    log.mockRestore();
  });

  it("rejects an old direct PACKED action without calling the pre-freeze command", async () => {
    mocks.confirmOrderPacked.mockRejectedValueOnce(new OperationsStateError("INVALID_ORDER_STATE", "No jump"));
    const data = new FormData();
    data.set("orderId", ORDER_ID);
    data.set("status", "PACKED");
    await expect(updateFulfillmentStatusAction({ error: null, saved: false }, data))
      .resolves.toMatchObject({ saved: false });
    expect(mocks.confirmBeforeProduction).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["CONFIRMED", mocks.confirmOrders, { cycleId: CYCLE_ID, orderIds: [ORDER_ID] }],
    ["IN_PRODUCTION", mocks.startOrders, { cycleId: CYCLE_ID, orderIds: [ORDER_ID] }],
    ["PACKED", mocks.confirmOrderPacked, { cycleId: CYCLE_ID, orderId: ORDER_ID }],
    ["DELIVERED", mocks.deliverOrders, { cycleId: CYCLE_ID, orderIds: [ORDER_ID] }],
  ] as const)("dispatches %s through its guarded command using owned parents", async (status, command, input) => {
    mocks.select().limit.mockResolvedValue([{ id: ORDER_ID, bakeCycleId: CYCLE_ID, customerId: CUSTOMER_ID, cycleStatus: "IN_PRODUCTION" }]);
    const data = new FormData();
    data.set("orderId", ORDER_ID);
    data.set("cycleId", CYCLE_ID);
    data.set("status", status);
    expect(await updateFulfillmentStatusAction({ error: null, saved: false }, data)).toEqual({ error: null, saved: true });
    expect(command).toHaveBeenCalledExactlyOnceWith(OWNER_ID, input);
    expect(mocks.confirmBeforeProduction).not.toHaveBeenCalled();
    expect(mocks.updateFulfillmentStatus).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/orders", `/orders/${ORDER_ID}`, "/cycles", `/cycles/${CYCLE_ID}`, `/customers/${CUSTOMER_ID}`, "/dashboard",
      `/cycles/${CYCLE_ID}/operations`, `/cycles/${CYCLE_ID}/production`, `/cycles/${CYCLE_ID}/planning`,
    ]);
    const where = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(where.params).toEqual([OWNER_ID, ORDER_ID]);
    expect(where.sql).toContain('"orders"."owner_id"');
    const join = new PgDialect().sqlToQuery(mocks.innerJoin.mock.calls[0]![1]);
    expect(join.sql).toContain('"bake_cycles"."owner_id"');
    expect(join.sql).toContain('"orders"."owner_id"');
  });

  it.each(["DRAFT", "OPEN"])("preserves dedicated pre-freeze confirmation in %s", async (cycleStatus) => {
    mocks.select().limit.mockResolvedValue([{ id: ORDER_ID, bakeCycleId: CYCLE_ID, customerId: CUSTOMER_ID, cycleStatus }]);
    const data = new FormData(); data.set("orderId", ORDER_ID); data.set("status", "CONFIRMED");
    expect(await updateFulfillmentStatusAction({ error: null, saved: false }, data)).toEqual({ error: null, saved: true });
    expect(mocks.confirmBeforeProduction).toHaveBeenCalledExactlyOnceWith(OWNER_ID, ORDER_ID);
    expect(mocks.confirmOrders).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "00000000-0000-4000-8000-000000000099"])("rejects malformed or mismatched cycle intent %s", async (cycleId) => {
    const data = new FormData(); data.set("orderId", ORDER_ID); data.set("cycleId", cycleId); data.set("status", "CONFIRMED");
    expect(await updateFulfillmentStatusAction({ error: null, saved: false }, data)).toMatchObject({ saved: false });
    expect(mocks.confirmBeforeProduction).not.toHaveBeenCalled();
    expect(mocks.confirmOrders).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps packing incomplete into a useful Operations link without bypassing the guard", async () => {
    mocks.confirmOrderPacked.mockRejectedValue(new OperationsStateError("PACKING_INCOMPLETE", "private"));
    const data = new FormData(); data.set("orderId", ORDER_ID); data.set("status", "PACKED");
    expect(await updateFulfillmentStatusAction({ error: null, saved: false }, data)).toEqual({
      error: "ยังแพ็กสินค้าไม่ครบ กรุณาบันทึกจำนวนที่แพ็กในหน้าปฏิบัติงานรอบผลิต", saved: false, operationsHref: `/cycles/${CYCLE_ID}/operations`,
    });
    expect(mocks.updateFulfillmentStatus).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps unknown and cross-owner parents indistinguishable without mutation", async () => {
    mocks.select().limit.mockResolvedValue([]);
    const data = new FormData(); data.set("orderId", ORDER_ID); data.set("status", "CONFIRMED");
    expect(await updateFulfillmentStatusAction({ error: null, saved: false }, data)).toEqual({ error: "ไม่พบข้อมูลสำหรับการปฏิบัติงาน", saved: false });
    expect(mocks.confirmBeforeProduction).not.toHaveBeenCalled();
    expect(mocks.confirmOrders).not.toHaveBeenCalled();
  });

  it("rejects NEW rather than reopening via a generic status write", async () => {
    const data = new FormData(); data.set("orderId", ORDER_ID); data.set("status", "NEW");
    expect(await updateFulfillmentStatusAction({ error: null, saved: false }, data)).toEqual({ error: "กรุณาตรวจสอบสถานะออเดอร์", saved: false });
    expect(mocks.updateFulfillmentStatus).not.toHaveBeenCalled();
  });

  it.each([saveOrderAction, updateFulfillmentStatusAction, cancelOrderAction, markOrderRefundedAction, restoreOrderPaymentTrackingAction])("does not catch authentication failures", async (action) => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(action({ error: null, saved: false, fieldErrors: {} }, new FormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.createOrderService).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("maps the exact production-freeze rejection for cancellation without raw leakage", async () => {
    mocks.cancel.mockRejectedValueOnce(
      new Error("Cycle production inputs are locked"),
    );
    const data = new FormData();
    data.set("orderId", ORDER_ID);
    data.set("status", "CANCELLED");

    await expect(
      cancelOrderAction({ error: null, saved: false }, data),
    ).resolves.toEqual({
      error: "รอบผลิตถูกล็อก กรุณาปลดล็อกรอบก่อนแก้ข้อมูลนี้",
      saved: false,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [cancelOrderAction, "PACKED", "กรุณาตรวจสอบการยกเลิกออเดอร์", mocks.cancel],
    [
      markOrderRefundedAction,
      "PAID",
      "กรุณาตรวจสอบสถานะการชำระเงิน",
      mocks.markRefunded,
    ],
    [
      restoreOrderPaymentTrackingAction,
      "REFUNDED",
      "กรุณาตรวจสอบสถานะการชำระเงิน",
      mocks.restorePaymentTracking,
    ],
  ] as const)(
    "rejects an incorrect explicit status intent before mutation",
    async (action, status, error, mutation) => {
      const data = new FormData();
      data.set("orderId", ORDER_ID);
      data.set("status", status);

      await expect(
        action({ error: null, saved: false }, data),
      ).resolves.toEqual({ error, saved: false });
      expect(mocks.requireOwner).toHaveBeenCalledOnce();
      expect(mutation).not.toHaveBeenCalled();
    },
  );
});
