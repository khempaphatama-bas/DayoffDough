import type { ReactElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CANCELLED_SETTLEMENT, CONSUMPTION_IDS as ids, MIXED_SETTLEMENT_PREVIEW, RELATED_SETTLEMENT_CONTEXT, SETTLEMENT_PREVIEW } from "@tests/fixtures/consumption-views";
import type { ConsumptionActionState, SettleUseInput } from "../domain/types";
import { SettlementForm } from "./settlement-form";

const initial: ConsumptionActionState = { error: null, fieldErrors: {}, saved: false, stale: false, result: null, blockers: [] };
const success = (number: number): ConsumptionActionState => ({ ...initial, saved: true, result: { operationId: `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`, revisionIds: [ids.revision], countMovementIds: [ids.count], replayed: false } });
function mount(element: ReactElement) {
  const container = document.createElement("div"); document.body.append(container);
  return render(element, { container, baseElement: container });
}
function payload(data: FormData): SettleUseInput {
  expect(data.getAll("payload")).toHaveLength(1);
  return JSON.parse(String(data.get("payload")));
}
type UI = ReturnType<typeof mount>;
function complete(ui: UI) {
  fireEvent.change(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)"), { target: { value: "25" } });
  fireEvent.change(ui.getByLabelText("เหตุผลการนับและเคลียร์ยอดใช้"), { target: { value: "นับของเหลือหลังอบ" } });
  fireEvent.click(ui.getByLabelText("ยืนยันว่าของเหลือเป็นยอดหลังใช้ทุกรายการที่แสดง และผลิตเสร็จแล้ว"));
}
function submit(ui: UI) { fireEvent.click(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })); }

describe("SettlementForm", () => {
  // Catches advertising an impossible mixed operation or silently narrowing the
  // owner's selected counts/tokens instead of requiring an explicit fresh GET.
  it("blocks mixed count-only settlement until explicit pending-only selection and fresh preview", () => {
    const ui = mount(<SettlementForm preview={MIXED_SETTLEMENT_PREVIEW} action={async () => initial} />);
    expect(ui.queryByText(/ข้อมูลตัวอย่างไม่ครบ/)).toBeNull();
    expect(ui.getByLabelText("นับของเหลือ น้ำตาลทราย")).toBeChecked();
    expect(ui.getByLabelText("ของเหลือหลังใช้ น้ำตาลทราย (kg)")).toBeRequired();
    expect(ui.getByRole("link", { name: /นับสต๊อกปัจจุบัน น้ำตาลทราย/ })).toHaveAttribute("href", `/inventory/${ids.countedOnly}`);
    expect(ui.queryByText("แป้งชื่อปัจจุบัน")).toBeNull();
    expect(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)")).toBeRequired();
    expect(ui.queryByLabelText(`จำนวนใช้ ${ids.countedOnly}`)).toBeNull();
    expect(ui.getByText(/DIRECT · ผลยอดใช้ -2/)).toBeInTheDocument();
    complete(ui);
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    fireEvent.change(ui.getByLabelText("ของเหลือหลังใช้ น้ำตาลทราย (kg)"), { target: { value: "7.125" } });
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    expect(ui.getByRole("alert")).toHaveTextContent(/น้ำตาลทราย.*ไม่มีรอบค้างยอดใช้.*นับสต๊อกปัจจุบัน/);
    const form = ui.getByRole("form", { name: "นับของเหลือและเคลียร์ยอดใช้" }) as HTMLFormElement;
    const draft = payload(new FormData(form));
    expect(draft.counts.map(row => row.inventoryItemId)).toEqual([ids.flour, ids.countedOnly]);
    expect(draft.expectedLedger).toEqual(MIXED_SETTLEMENT_PREVIEW.expectedLedger);
    expect(draft.contexts[0]!.items.map(row => row.inventoryItemId)).toEqual([ids.flour, ids.bag]);
    expect(ui.getByText("ยอดหลังนับ 7.125 · ผล COUNT -2.125")).toBeInTheDocument();
    fireEvent.click(ui.getByLabelText("นับของเหลือ น้ำตาลทราย"));
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    expect(new FormData(form).has("payload")).toBe(false);
    const selection = new FormData(ui.getByRole("form", { name: "เลือกรายการนับของเหลือ" }) as HTMLFormElement);
    expect(selection.getAll("countItem")).toEqual([ids.flour]);
    expect(selection.get("mode")).toBe("settle");
    expect(ui.getByRole("form", { name: "เลือกรายการนับของเหลือ" })).toHaveAttribute("method", "get");
    // Only adoption of the explicit fresh preview can enable a new operation.
    ui.rerender(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async () => initial} />);
    expect(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)")).toHaveValue("");
    complete(ui);
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeEnabled();
  });
  // Catches selected-only usage payloads, hidden zero effects and double subtracting physical stock.
  it("sends the full use context but a physical count only for selected flour", async () => {
    const sent: SettleUseInput[] = [];
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async (_, data) => { sent.push(payload(data)); return initial; }} />);
    expect(ui.getByText(/COUNT_SETTLED · ผลยอดใช้ 0/)).toBeInTheDocument();
    expect(ui.getByText(/DIRECT · ผลยอดใช้ -2/)).toBeInTheDocument();
    expect(ui.getByText(/ยอดบัญชีก่อนนับ 10.7/)).toBeInTheDocument();
    expect(ui.queryByLabelText("ของเหลือหลังใช้ ถุงขนมจากแผน (ชิ้น)")).toBeNull();
    complete(ui); submit(ui);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ requestId: expect.any(String), contexts: [{ ...SETTLEMENT_PREVIEW.contexts[0]!.source, confirmTakenOutOfUse: true, items: [
      { inventoryItemId: ids.flour, usedQuantity: "0.3", basis: "PLANNED", reason: null },
      { inventoryItemId: ids.bag, usedQuantity: "2", basis: "PLANNED", reason: null },
    ] }], counts: [{ inventoryItemId: ids.flour, remainingQuantity: "25" }], reason: "นับของเหลือหลังอบ", expectedLedger: SETTLEMENT_PREVIEW.expectedLedger });
    expect(ui.getByText(/ยอดหลังนับ 25/)).toBeInTheDocument();
  });

  // Catches blank/missing context values or incomplete count/reason bypassing the full manifest.
  it("requires every usage line, remaining, confirmation and overall reason", () => {
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async () => initial} />);
    complete(ui);
    for (const label of ["ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)", "จำนวนใช้ ถุงขนมจากแผน", "เหตุผลการนับและเคลียร์ยอดใช้"]) {
      const field = ui.getByLabelText(label); const value = (field as HTMLInputElement).value;
      fireEvent.change(field, { target: { value: "" } });
      expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
      fireEvent.change(field, { target: { value } });
    }
  });
  it.each([{ countedItemIds: [] }, { countedItemIds: [ids.flour, ids.flour] }])("cannot submit an invalid selected set $countedItemIds", ({ countedItemIds }) => {
    const ui = mount(<SettlementForm preview={{ ...SETTLEMENT_PREVIEW, countedItemIds }} action={async () => initial} />);
    expect(ui.queryByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeNull();
  });
  it("does not offer counts-only settlement without pending contexts", () => {
    const ui = mount(<SettlementForm preview={{ ...SETTLEMENT_PREVIEW, contexts: [] }} action={async () => initial} />);
    expect(ui.queryByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeNull();
    expect(ui.getByRole("link", { name: /นับสต๊อกปัจจุบัน/ })).toHaveAttribute("href", `/inventory/${ids.flour}`);
  });
  it("keeps every cancelled actual blank and owner reported until individually entered", () => {
    const ui = mount(<SettlementForm preview={CANCELLED_SETTLEMENT} action={async () => initial} />);
    complete(ui);
    for (const name of ["แป้งขนมปังจากแผน", "ถุงขนมจากแผน"]) {
      expect(ui.getByLabelText(`จำนวนใช้ ${name}`)).toHaveValue("");
      expect(ui.getByLabelText(`ที่มาของยอดใช้ ${name}`)).toHaveValue("OWNER_REPORTED");
      expect(ui.queryByRole("option", { name: "ตามแผน (ประมาณการ)" })).toBeNull();
      fireEvent.change(ui.getByLabelText(`จำนวนใช้ ${name}`), { target: { value: name.startsWith("แป้ง") ? "0.3" : "2" } });
    }
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeEnabled();
  });
  it("uses semantic decimals, requires changed/zero reasons and rejects invalid exact quantities", () => {
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async () => initial} />); complete(ui);
    const amount = ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน");
    fireEvent.change(amount, { target: { value: "0.300000" } });
    expect(ui.getByLabelText("ที่มาของยอดใช้ แป้งขนมปังจากแผน")).toHaveValue("PLANNED");
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeEnabled();
    for (const value of ["0.1", "0", "-1", "0.1234567", "1000000000000", "1e2"]) {
      fireEvent.change(amount, { target: { value } });
      expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    }
    fireEvent.change(amount, { target: { value: "0.1" } });
    fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ชั่งจริง" } });
    expect(ui.getByLabelText("ที่มาของยอดใช้ แป้งขนมปังจากแผน")).toHaveValue("OWNER_REPORTED");
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeEnabled();
  });

  for (const stale of [false, true]) {
    it(`retains the entire failed ${stale ? "stale context" : "shortage"} intent through unsolicited props and retry`, async () => {
      const sent: SettleUseInput[] = [];
      const action = async (_: ConsumptionActionState, data: FormData) => { sent.push(payload(data)); return { ...initial, stale, error: stale ? "มีรอบค้างเพิ่ม กรุณาเปิดข้อมูลล่าสุด" : "ถุงไม่พอ ไม่ได้บันทึกทั้งชุด", fieldErrors: { "counts.0.remainingQuantity": "ตรวจยอดเหลือ" }, blockers: [{ cycleId: ids.cycle, cycleName: "รอบค้าง" }] }; };
      const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={action} />); complete(ui);
      fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: "0.1" } });
      fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ชั่งใช้จริง" } });
      submit(ui);
      await waitFor(() => expect(ui.getByRole("alert")).toHaveTextContent(stale ? "มีรอบค้างเพิ่ม" : "ไม่ได้บันทึกทั้งชุด"));
      expect(ui.queryByRole("status")).toBeNull();
      expect(payload(new FormData(ui.getByRole("form", { name: "นับของเหลือและเคลียร์ยอดใช้" }) as HTMLFormElement))).toEqual(sent[0]);
      expect(ui.getByLabelText("ที่มาของยอดใช้ แป้งขนมปังจากแผน")).toHaveValue("OWNER_REPORTED");
      expect(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน")).toHaveValue("0.1");
      expect(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน")).toHaveValue("ชั่งใช้จริง");
      expect(ui.getByRole("checkbox", { name: /ยืนยันว่าของเหลือเป็นยอดหลังใช้/ })).toBeChecked();
      expect(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)")).toHaveAccessibleDescription("ตรวจยอดเหลือ");
      const changed = { ...SETTLEMENT_PREVIEW, expectedLedger: SETTLEMENT_PREVIEW.expectedLedger.map(row => ({ ...row, ledgerRevision: "99" })), contexts: [...SETTLEMENT_PREVIEW.contexts, { ...RELATED_SETTLEMENT_CONTEXT, cycle: { ...RELATED_SETTLEMENT_CONTEXT.cycle, cycleName: "รอบเพิ่มใหม่" } }] };
      ui.rerender(<SettlementForm preview={changed} action={action} />);
      expect(ui.queryByText("รอบเพิ่มใหม่")).toBeNull(); submit(ui);
      await waitFor(() => expect(sent).toHaveLength(2)); expect(sent[1]).toEqual(sent[0]);
      expect(ui.getByRole("link", { name: "รอบค้าง" })).toHaveAttribute("href", `/cycles/${ids.cycle}/consumption`);
      expect(ui.getByRole("link", { name: "เปิดข้อมูลล่าสุดและเริ่มรายการใหม่" })).toHaveAttribute("href", expect.stringContaining(`countItem=${ids.flour}`));
    });
  }
  it("makes changed selection a new intent with new captured tokens and blanks", async () => {
    const sent: SettleUseInput[] = [];
    const action = async (_: ConsumptionActionState, data: FormData) => { sent.push(payload(data)); return initial; };
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={action} />); complete(ui); submit(ui);
    await waitFor(() => expect(sent).toHaveLength(1));
    ui.rerender(<SettlementForm preview={{ ...SETTLEMENT_PREVIEW, countedItemIds: [ids.flour, ids.bag], counts: [...SETTLEMENT_PREVIEW.counts, { inventoryItemId: ids.bag, inventoryItemName: "ถุงชื่อปัจจุบัน", baseUnit: "piece", remainingQuantity: null, mode: "COUNT", quantityDelta: null }], expectedLedger: SETTLEMENT_PREVIEW.expectedLedger.map(row => ({ ...row, ledgerRevision: "8" })) }} action={action} />);
    expect(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)")).toHaveValue(""); complete(ui);
    fireEvent.change(ui.getByLabelText("ของเหลือหลังใช้ ถุงขนมจากแผน (ชิ้น)"), { target: { value: "4" } }); submit(ui);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.requestId).not.toBe(sent[0]!.requestId);
    expect(sent[1]!.expectedLedger.map(row => row.ledgerRevision)).toEqual(["8", "8"]);
  });
  // Catches an old valid POST staying enabled after the GET selector was edited.
  it("invalidates preview immediately when the counted checkbox selection changes", () => {
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async () => initial} />); complete(ui);
    fireEvent.click(ui.getByLabelText("นับของเหลือ ถุงขนมจากแผน"));
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    expect(ui.getByText(/เปลี่ยนรายการนับแล้ว/)).toBeInTheDocument();
    // Returning to the old selection is still a new intent, not permission to reuse old tokens.
    fireEvent.click(ui.getByLabelText("นับของเหลือ ถุงขนมจากแผน"));
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    expect(ui.getByRole("form", { name: "เลือกรายการนับของเหลือ" })).toHaveAttribute("method", "get");
  });
  it("displays exact aggregate DIRECT stock effects across all affected contexts", () => {
    const preview = { ...SETTLEMENT_PREVIEW, contexts: [...SETTLEMENT_PREVIEW.contexts, RELATED_SETTLEMENT_CONTEXT] };
    const ui = mount(<SettlementForm preview={preview} action={async () => initial} />);
    expect(ui.getByText("ถุงขนมจากแผน · DIRECT รวม -3.75 · ยอดบัญชี 8 → คงเหลือที่เสนอ 4.25")).toBeInTheDocument();
  });
  it("dispatches every complete context with matching immutable sources and item IDs", async () => {
    const sent: SettleUseInput[] = [];
    const ui = mount(<SettlementForm preview={{ ...SETTLEMENT_PREVIEW, contexts: [...SETTLEMENT_PREVIEW.contexts, { ...RELATED_SETTLEMENT_CONTEXT, items: [...RELATED_SETTLEMENT_CONTEXT.items].reverse() }] }} action={async (_, data) => { sent.push(payload(data)); return initial; }} />);
    complete(ui); submit(ui);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.contexts).toEqual([
      { cycleId: ids.cycle, planningSnapshotId: ids.snapshot, contextId: ids.context, confirmTakenOutOfUse: true, items: [
        { inventoryItemId: ids.flour, usedQuantity: "0.3", basis: "PLANNED", reason: null },
        { inventoryItemId: ids.bag, usedQuantity: "2", basis: "PLANNED", reason: null },
      ] },
      { cycleId: "20000000-0000-4000-8000-000000000001", planningSnapshotId: "20000000-0000-4000-8000-000000000002", contextId: "20000000-0000-4000-8000-000000000003", confirmTakenOutOfUse: true, items: [
        { inventoryItemId: ids.bag, usedQuantity: "1.75", basis: "PLANNED", reason: null },
        { inventoryItemId: ids.flour, usedQuantity: "0.3", basis: "PLANNED", reason: null },
      ] },
    ]);
  });
  it("rejects an incomplete captured union missing an uncounted ledger token", () => {
    const ui = mount(<SettlementForm preview={{ ...SETTLEMENT_PREVIEW, expectedLedger: SETTLEMENT_PREVIEW.expectedLedger.slice(0, 1) }} action={async () => initial} />);
    expect(ui.queryByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeNull();
    expect(ui.getByText(/ข้อมูลตัวอย่างไม่ครบ/)).toBeInTheDocument();
  });
  it("rotates IDs for three dispatched successes and reports counts and usage atomically", async () => {
    const sent: SettleUseInput[] = [];
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async (_, data) => { sent.push(payload(data)); return success(sent.length); }} />);
    for (let index = 0; index < 3; index++) {
      complete(ui); submit(ui);
      await waitFor(() => expect(sent).toHaveLength(index + 1));
      await waitFor(() => expect(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)")).toHaveValue(""));
      // Draft reset can render before useActionState commits its returned result.
      // Wait for the original button label: pending has ended and the new intent is unconfirmed.
      await waitFor(() => expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled());
      expect(ui.getByRole("status")).toHaveTextContent("บันทึกยอดใช้ 1 รอบ และยอดนับ 1 รายการแล้ว");
      expect(ui.getByRole("status")).not.toHaveTextContent("หักสต๊อก");
    }
    expect(new Set(sent.map(row => row.requestId)).size).toBe(3);
  });
  it("does not consume a new request ID on an already-observed operation replay", async () => {
    const sent: SettleUseInput[] = [];
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async (_, data) => { sent.push(payload(data)); const result = success(1); return { ...result, result: { ...result.result!, replayed: sent.length > 1 } }; }} />);
    complete(ui); submit(ui);
    await waitFor(() => expect(ui.getByLabelText("ของเหลือหลังใช้ แป้งขนมปังจากแผน (g)")).toHaveValue(""));
    await waitFor(() => expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled());
    complete(ui); submit(ui);
    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() => expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeEnabled());
    submit(ui); await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[0]!.requestId).not.toBe(sent[1]!.requestId);
    expect(sent[1]).toEqual(sent[2]);
  });
  it("locks editing, refresh and duplicate submits during actual pending dispatch", async () => {
    let resolve!: (value: ConsumptionActionState) => void;
    const delayed = new Promise<ConsumptionActionState>(done => { resolve = done; });
    const ui = mount(<SettlementForm preview={SETTLEMENT_PREVIEW} action={async () => delayed} />); complete(ui); submit(ui);
    await waitFor(() => expect(ui.getByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled());
    expect(ui.getByLabelText("จำนวนใช้ ถุงขนมจากแผน")).toBeDisabled();
    expect(ui.queryByRole("link", { name: "เปิดข้อมูลล่าสุดและเริ่มรายการใหม่" })).toBeNull();
    expect(ui.queryByRole("status")).toBeNull();
    await act(async () => resolve({ ...initial, error: "ไม่ได้บันทึกทั้งชุด" }));
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeEnabled();
  });
});
