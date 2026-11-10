import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSUMPTION_IDS as ids, HISTORY_USAGE, LEGACY_USAGE, MIXED_SETTLEMENT_PREVIEW, PENDING_USAGE, SETTLEMENT_PREVIEW } from "@tests/fixtures/consumption-views";
import type { ConsumptionActionState, SettleUseInput } from "@/modules/consumption/domain/types";
import { ConsumptionStateError } from "@/modules/consumption/domain/types";

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), getCycleConsumption: vi.fn(), getSettlementPreview: vi.fn(), settleUseAction: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/consumption/application/consumption-queries", () => ({ createConsumptionQueryService: () => ({ getCycleConsumption: mocks.getCycleConsumption, getSettlementPreview: mocks.getSettlementPreview }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("./actions", () => ({ confirmUseAction: vi.fn(), correctUseAction: vi.fn(), settleUseAction: mocks.settleUseAction }));
import ConsumptionPage from "./page";

describe("ConsumptionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: "owned-user" });
    mocks.getCycleConsumption.mockResolvedValue(PENDING_USAGE);
    mocks.getSettlementPreview.mockResolvedValue(SETTLEMENT_PREVIEW);
  });
  it("submits a valid mixed GET preview with complete counts, context and captured ledger", async () => {
    const sent: SettleUseInput[] = [];
    mocks.getSettlementPreview.mockResolvedValueOnce(MIXED_SETTLEMENT_PREVIEW);
    mocks.settleUseAction.mockImplementationOnce(async (_: ConsumptionActionState, data: FormData): Promise<ConsumptionActionState> => {
      expect(data.getAll("payload")).toHaveLength(1); sent.push(JSON.parse(String(data.get("payload"))));
      return { error: null, fieldErrors: {}, saved: false, stale: false, result: null, blockers: [] };
    });
    const ui = render(await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", countItem: [ids.flour, ids.countedOnly] }) }));
    expect(mocks.getSettlementPreview).toHaveBeenCalledWith("owned-user", [ids.flour, ids.countedOnly]);
    expect(mocks.requireOwner.mock.invocationCallOrder[0]!).toBeLessThan(mocks.getSettlementPreview.mock.invocationCallOrder[0]!);
    fireEvent.change(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน"), { target: { value: "25" } });
    fireEvent.change(ui.getByLabelText(`ของเหลือหลังใช้ ${ids.countedOnly}`), { target: { value: "7.125" } });
    fireEvent.change(ui.getByLabelText("เหตุผลการนับและเคลียร์ยอดใช้"), { target: { value: "นับหลังอบ" } });
    fireEvent.click(ui.getByLabelText("ยืนยันว่าของเหลือเป็นยอดหลังใช้ทุกรายการที่แสดง และผลิตเสร็จแล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.counts).toEqual([{ inventoryItemId: ids.flour, remainingQuantity: "25" }, { inventoryItemId: ids.countedOnly, remainingQuantity: "7.125" }]);
    expect(sent[0]!.expectedLedger).toEqual([{ inventoryItemId: ids.flour, ledgerRevision: "4", countMovementId: ids.count }, { inventoryItemId: ids.bag, ledgerRevision: "2", countMovementId: null }, { inventoryItemId: ids.countedOnly, ledgerRevision: "3", countMovementId: null }]);
    expect(sent[0]!.contexts).toEqual([{ cycleId: ids.cycle, planningSnapshotId: ids.snapshot, contextId: ids.context, confirmTakenOutOfUse: true, items: [
      { inventoryItemId: ids.flour, usedQuantity: "0.3", basis: "PLANNED", reason: null },
      { inventoryItemId: ids.bag, usedQuantity: "2", basis: "PLANNED", reason: null },
    ] }]);
  });
  it("authenticates before the owner-scoped read and renders the real confirmation form", async () => {
    const tree = await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) });
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(tree, { container, baseElement: container });
    expect(mocks.getCycleConsumption).toHaveBeenCalledWith("owned-user", ids.cycle, undefined);
    expect(mocks.requireOwner.mock.invocationCallOrder[0]!).toBeLessThan(mocks.getCycleConsumption.mock.invocationCallOrder[0]!);
    expect(ui.getByRole("heading", { name: "บันทึกยอดใช้การผลิต" })).toBeInTheDocument();
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeInTheDocument();
  });
  it("never queries when authentication fails", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) })).rejects.toThrow("Unauthorized");
    expect(mocks.getCycleConsumption).not.toHaveBeenCalled();
  });
  it("awaits the selected generation and renders readonly immutable history", async () => {
    mocks.getCycleConsumption.mockResolvedValueOnce(HISTORY_USAGE);
    const tree = await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ generation: "2" }) });
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(tree, { container, baseElement: container });
    expect(mocks.getCycleConsumption).toHaveBeenCalledWith("owned-user", ids.cycle, 2);
    expect(ui.getByRole("heading", { name: "บันทึกครั้งที่ 1" })).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
  it.each(["", "0", "01", "-1", "1.0", "1e2", "9007199254740992", ["1", "2"]])("404s malformed generation %j before read", async (generation) => {
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ generation }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCycleConsumption).not.toHaveBeenCalled();
  });
  it.each([
    { name: "invalid cycle", cycleId: "not-a-uuid", generation: undefined },
    { name: "unknown cycle", cycleId: "40000000-0000-4000-8000-000000000001", generation: undefined },
    { name: "foreign cycle", cycleId: "40000000-0000-4000-8000-000000000002", generation: undefined },
    { name: "unknown generation", cycleId: ids.cycle, generation: "9" },
  ])("404s an owned-query NOT_FOUND for $name", async ({ cycleId, generation }) => {
    mocks.getCycleConsumption.mockRejectedValueOnce(new ConsumptionStateError("NOT_FOUND", "Consumption record not found"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: cycleId }), searchParams: Promise.resolve(generation === undefined ? {} : { generation }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCycleConsumption).toHaveBeenCalledWith("owned-user", cycleId, generation ? 9 : undefined);
  });
  it("does not disguise an unexpected failure as 404", async () => {
    mocks.getCycleConsumption.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) })).rejects.toThrow("read unavailable");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
  it("renders legacy as readonly without inventing ledger controls", async () => {
    mocks.getCycleConsumption.mockResolvedValueOnce(LEGACY_USAGE);
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) }), { container, baseElement: container });
    expect(ui.getByText(/รอบเดิม.*อ่านอย่างเดียว/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
  // Catches accidental ordinary COUNT/confirm routing or unowned GET preview reads.
  it.each([{ countItem: ids.flour }, { countItem: [ids.flour, ids.bag] }])("loads an explicitly selected owner-first settlement preview $countItem", async ({ countItem }) => {
    const selection: readonly string[] = typeof countItem === "string" ? [countItem] : countItem;
    mocks.getSettlementPreview.mockResolvedValueOnce({ ...SETTLEMENT_PREVIEW, countedItemIds: selection, counts: selection.map(inventoryItemId => ({ inventoryItemId, remainingQuantity: null, mode: "COUNT", quantityDelta: null })), contexts: SETTLEMENT_PREVIEW.contexts.map(context => ({ ...context, items: context.items.map(item => selection.includes(item.inventoryItemId) ? { ...item, mode: "COUNT_SETTLED", quantityDelta: "0" } : item) })) });
    const ui = render(await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", countItem }) }));
    expect(mocks.getSettlementPreview).toHaveBeenCalledWith("owned-user", typeof countItem === "string" ? [countItem] : countItem);
    expect(mocks.requireOwner.mock.invocationCallOrder[0]!).toBeLessThan(mocks.getSettlementPreview.mock.invocationCallOrder[0]!);
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: "ยืนยันยอดใช้" })).toBeNull();
  });
  it("never opens a settlement mutation UI from a historical generation", async () => {
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ generation: "1", mode: "settle", countItem: ids.flour }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getSettlementPreview).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "invalid", [], [ids.flour, ids.flour], [ids.flour, ids.flour.toUpperCase()]].map(countItem => ({ countItem })))("rejects invalid settlement selection $countItem before preview read", async ({ countItem }) => {
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", ...(countItem === undefined ? {} : { countItem }) }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getSettlementPreview).not.toHaveBeenCalled();
  });
  it("keeps ordinary consumption separate even when countItem is present", async () => {
    await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ countItem: ids.flour }) });
    expect(mocks.getSettlementPreview).not.toHaveBeenCalled();
  });
  it("does not read a settlement preview before auth or for an unavailable Cycle", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", countItem: ids.flour }) })).rejects.toThrow("Unauthorized");
    expect(mocks.getSettlementPreview).not.toHaveBeenCalled();
    mocks.getCycleConsumption.mockRejectedValueOnce(new ConsumptionStateError("NOT_FOUND", "Consumption record not found"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", countItem: ids.flour }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getSettlementPreview).not.toHaveBeenCalled();
  });
  it("404s unknown/foreign counted IDs safely and propagates unexpected preview failures", async () => {
    mocks.getSettlementPreview.mockRejectedValueOnce(new ConsumptionStateError("NOT_FOUND", "Consumption record not found"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", countItem: ids.flour }) })).rejects.toThrow("NEXT_NOT_FOUND");
    mocks.getSettlementPreview.mockRejectedValueOnce(new Error("preview unavailable"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ mode: "settle", countItem: ids.flour }) })).rejects.toThrow("preview unavailable");
  });
});
