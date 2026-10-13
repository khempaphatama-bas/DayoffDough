import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsStateError } from "@/modules/operations/domain/types";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(), revalidatePath: vi.fn(), select: vi.fn(), where: vi.fn(), innerJoin: vi.fn(),
  startCycle: vi.fn(), confirmOrders: vi.fn(), startOrders: vi.fn(),
  setPackedQuantity: vi.fn(), confirmOrderPacked: vi.fn(), reopenOrderPacking: vi.fn(),
  setOrderAmountPaid: vi.fn(), deliverOrders: vi.fn(), completeCycle: vi.fn(),
}));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/modules/operations/application/order-commands", () => ({ createOrderOperationsCommandService: () => mocks }));
vi.mock("@/modules/operations/application/payment-commands", () => ({ createPaymentOperationsCommandService: () => mocks }));
vi.mock("@/modules/operations/application/cycle-commands", () => ({ createCycleOperationsCommandService: () => mocks }));
import {
  startCycleAction, confirmOrdersAction, startOrdersAction, setPackedQuantityAction,
  confirmOrderPackedAction, reopenOrderPackingAction, setOrderAmountPaidAction,
  deliverOrdersAction, completeCycleAction,
} from "./actions";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CYCLE = "00000000-0000-4000-8000-000000000002";
const ORDER = "00000000-0000-4000-8000-000000000003";
const ITEM = "00000000-0000-4000-8000-000000000004";
const GENERATION = "00000000-0000-4000-8000-000000000005";
const INITIAL = { error: null, kind: null, fieldErrors: {}, saved: false } as const;
const SUCCESS = { ...INITIAL, saved: true };
const batch = { cycleId: CYCLE, orderIds: [ORDER] };
const single = { cycleId: CYCLE, orderId: ORDER };
const cases = [
  ["startCycle", startCycleAction, { cycleId: CYCLE }, []],
  ["confirmOrders", confirmOrdersAction, batch, [ORDER]],
  ["startOrders", startOrdersAction, batch, [ORDER]],
  ["setPackedQuantity", setPackedQuantityAction, { cycleId: CYCLE, orderItemId: ITEM, packedQuantity: 2, expectedPackedQuantity: 1 }, [ORDER]],
  ["confirmOrderPacked", confirmOrderPackedAction, single, [ORDER]],
  ["reopenOrderPacking", reopenOrderPackingAction, single, [ORDER]],
  ["setOrderAmountPaid", setOrderAmountPaidAction, { orderId: ORDER, targetAmountPaidSatang: 200, expectedAmountPaidSatang: 100 }, [ORDER]],
  ["deliverOrders", deliverOrdersAction, batch, [ORDER]],
  ["completeCycle", completeCycleAction, { cycleId: CYCLE, expectedTaskGenerationId: GENERATION, confirmation: true }, []],
] as const;
function form(payload: unknown) {
  const data = new FormData();
  data.set("payload", JSON.stringify(payload));
  return data;
}
function paths(orderIds: readonly string[]) {
  return [`/cycles/${CYCLE}/operations`, `/cycles/${CYCLE}/production`, `/cycles/${CYCLE}/planning`, `/cycles/${CYCLE}`, "/cycles", "/orders", "/dashboard", ...orderIds.map((id) => `/orders/${id}`)];
}

describe("Operations actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER });
    for (const [name] of cases) mocks[name].mockResolvedValue({});
    const query = { from: vi.fn(), innerJoin: mocks.innerJoin, where: mocks.where, limit: vi.fn() };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit.mockResolvedValue([{ id: ORDER, orderId: ORDER, bakeCycleId: CYCLE }]);
    mocks.select.mockReturnValue(query);
  });

  it.each(cases)("%s authenticates, dispatches only its parsed command and revalidates concrete affected views", async (name, action, payload, orderIds) => {
    // Browser authority and unrelated input must never enter a command.
    expect(await action(INITIAL, form({ ...payload, ownerId: "attacker", status: "DELIVERED", quantity: 999, cycleId: "cycleId" in payload ? CYCLE : GENERATION }))).toEqual(SUCCESS);
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks[name]).toHaveBeenCalledExactlyOnceWith(OWNER, payload);
    for (const [other] of cases) if (other !== name) expect(mocks[other]).not.toHaveBeenCalled();
    expect(mocks.requireOwner.mock.invocationCallOrder[0]).toBeLessThan(mocks[name].mock.invocationCallOrder[0]!);
    expect(mocks.revalidatePath.mock.calls).toEqual(paths(orderIds).map((path) => [path]));
  });

  it.each(cases)("%s returns typed errors without revalidation", async (name, action, payload) => {
    mocks[name].mockRejectedValue(new OperationsStateError("STALE_DATA", "private data"));
    expect(await action(INITIAL, form(payload))).toEqual({ error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", kind: "STALE_DATA", fieldErrors: {}, saved: false });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)("%s never swallows authentication failure, even for malformed payloads", async (_name, action) => {
    mocks.requireOwner.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(action(INITIAL, new FormData())).rejects.toThrow("NEXT_REDIRECT");
    for (const [name] of cases) expect(mocks[name]).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(cases)("%s rejects invalid identifiers before any command", async (_name, action, payload) => {
    const invalid = { ...payload, cycleId: "not-a-uuid", orderId: "not-a-uuid", orderIds: ["not-a-uuid"], orderItemId: "not-a-uuid" };
    expect(await action(INITIAL, form(invalid))).toMatchObject({ saved: false, kind: "INVALID_INPUT" });
    for (const [name] of cases) expect(mocks[name]).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([null, "not-json", "null", "[]", "42", "\"text\""])("rejects non-object or invalid JSON payload %s", async (payload) => {
    const data = new FormData();
    if (payload !== null) data.set("payload", payload);
    expect(await deliverOrdersAction(INITIAL, data)).toEqual({ error: "กรุณาตรวจสอบข้อมูล", kind: "INVALID_INPUT", fieldErrors: {}, saved: false });
    expect(mocks.deliverOrders).not.toHaveBeenCalled();
  });

  it("normalizes duplicate batch IDs, but rejects an oversized selection", async () => {
    expect(await deliverOrdersAction(INITIAL, form({ cycleId: CYCLE, orderIds: [GENERATION, ORDER, ORDER] }))).toEqual(SUCCESS);
    expect(mocks.deliverOrders).toHaveBeenCalledWith(OWNER, { cycleId: CYCLE, orderIds: [ORDER, GENERATION] });
    expect(mocks.revalidatePath.mock.calls).toEqual(paths([ORDER, GENERATION]).map((path) => [path]));
    mocks.deliverOrders.mockClear();
    expect(await deliverOrdersAction(INITIAL, form({ cycleId: CYCLE, orderIds: Array(101).fill(ORDER) }))).toMatchObject({ kind: "INVALID_INPUT" });
    expect(mocks.deliverOrders).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", "ไม่พบข้อมูลสำหรับการปฏิบัติงาน"],
    ["INVALID_CYCLE_STATE", "สถานะรอบผลิตไม่อนุญาตให้ทำรายการนี้"],
    ["INVALID_ORDER_STATE", "สถานะออเดอร์ไม่อนุญาตให้ทำรายการนี้"],
    ["PACKING_INCOMPLETE", "ยังแพ็กสินค้าไม่ครบ กรุณาตรวจสอบจำนวนที่แพ็ก"],
    ["PACKED_QUANTITY_OUT_OF_RANGE", "จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึงจำนวนที่สั่ง"],
    ["PAYMENT_OUT_OF_RANGE", "ยอดชำระต้องอยู่ระหว่าง 0 ถึงยอดรวมออเดอร์"],
    ["UNLOCK_BLOCKED_BY_OPERATIONS", "ปลดล็อกรอบไม่ได้ เพราะเริ่มทำออเดอร์แล้ว"],
    ["CYCLE_COMPLETION_BLOCKED", "ยังจบรอบไม่ได้ กรุณาทำงานและจัดส่งออเดอร์ให้ครบ"],
  ] as const)("maps %s without returning raw service details", async (kind, message) => {
    mocks.completeCycle.mockRejectedValue(new OperationsStateError(kind, "customer@example.com", { customerName: "secret" }));
    expect(await completeCycleAction(INITIAL, form({ cycleId: CYCLE, expectedTaskGenerationId: GENERATION, confirmation: true }))).toEqual({ error: message, kind, fieldErrors: {}, saved: false });
  });

  it("maps packing quantity limits into actionable field feedback", async () => {
    mocks.setPackedQuantity.mockRejectedValue(new OperationsStateError("PACKED_QUANTITY_OUT_OF_RANGE", "raw", { quantity: 10, customerName: "secret" }));
    expect(await setPackedQuantityAction(INITIAL, form(cases[3][2]))).toMatchObject({ fieldErrors: { packedQuantity: "จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึง 10" } });
  });

  it.each([
    [setPackedQuantityAction, cases[3][2], [OWNER, ITEM], '"order_items"."owner_id"'],
    [setOrderAmountPaidAction, cases[6][2], [OWNER, ORDER], '"orders"."owner_id"'],
  ] as const)("reads affected parent IDs with authenticated ownership rather than browser hints", async (action, payload, parameters, ownerColumn) => {
    expect(await action(INITIAL, form({ ...payload, cycleId: "cycleId" in payload ? CYCLE : GENERATION, orderId: "orderId" in payload ? ORDER : GENERATION }))).toEqual(SUCCESS);
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(query.params).toEqual(parameters);
    expect(query.sql).toContain(ownerColumn);
    expect(mocks.revalidatePath.mock.calls).toEqual(paths([ORDER]).map((path) => [path]));
    if (action === setPackedQuantityAction) {
      const join = new PgDialect().sqlToQuery(mocks.innerJoin.mock.calls[0]![1]);
      expect(join.sql).toContain('"orders"."owner_id"');
      expect(join.sql).toContain('"order_items"."owner_id"');
    }
  });

  it.each([
    [setPackedQuantityAction, { ...cases[3][2], packedQuantity: -1 }],
    [setPackedQuantityAction, { ...cases[3][2], packedQuantity: 1.5 }],
    [setOrderAmountPaidAction, { ...cases[6][2], targetAmountPaidSatang: "200" }],
    [setOrderAmountPaidAction, { ...cases[6][2], expectedAmountPaidSatang: -1 }],
    [completeCycleAction, { ...cases[8][2], confirmation: false }],
  ] as const)("rejects invalid quantities, money, or completion confirmation before mutation", async (action, payload) => {
    expect(await action(INITIAL, form(payload))).toMatchObject({ kind: "INVALID_INPUT", saved: false });
    for (const [name] of cases) expect(mocks[name]).not.toHaveBeenCalled();
  });

  it("rejects multiple payloads and file payloads", async () => {
    const duplicate = form(batch); duplicate.append("payload", JSON.stringify(batch));
    const file = new FormData(); file.set("payload", new Blob([JSON.stringify(batch)]), "payload.json");
    for (const data of [duplicate, file]) expect(await deliverOrdersAction(INITIAL, data)).toMatchObject({ kind: "INVALID_INPUT", saved: false });
    expect(mocks.deliverOrders).not.toHaveBeenCalled();
  });

  it("logs unexpected failure without error objects or payload/customer data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.deliverOrders.mockRejectedValue(new Error("customer@example.com"));
      expect(await deliverOrdersAction(INITIAL, form({ ...batch, customer: "secret" }))).toEqual({ error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง", kind: null, fieldErrors: {}, saved: false });
      expect(log).toHaveBeenCalledExactlyOnceWith("Operations action failed");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
