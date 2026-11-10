import type { ReactElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CANCELLED_USAGE, CONSUMPTION_IDS as ids, PENDING_USAGE, RECORDED_USAGE } from "@tests/fixtures/consumption-views";
import type { ConsumptionActionState, ConfirmUseInput, CorrectUseInput } from "../domain/types";
import { UsageForm } from "./usage-form";

const initial: ConsumptionActionState = { error: null, fieldErrors: {}, saved: false, stale: false, result: null, blockers: [] };
const successful = (operationId: string, replayed = false): ConsumptionActionState => ({ ...initial, saved: true, result: { operationId, revisionIds: [ids.revision], countMovementIds: [], replayed } });
function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  return render(element, { container, baseElement: container });
}
function payload(data: FormData): ConfirmUseInput | CorrectUseInput {
  expect(data.getAll("payload")).toHaveLength(1);
  return JSON.parse(String(data.get("payload")));
}

describe("UsageForm", () => {
  // Catches a form that silently reports recipe defaults as actual or drops source/fence tokens.
  it("submits explicit planned estimates with the server source and complete expected ledger", async () => {
    const submitted: (ConfirmUseInput | CorrectUseInput)[] = [];
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async (_, data) => { submitted.push(payload(data)); return successful(ids.operation); }} />);
    expect(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน")).toHaveValue("0.3");
    expect(ui.getByLabelText("ที่มาของยอดใช้ แป้งขนมปังจากแผน")).toHaveValue("PLANNED");
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toEqual({ ...PENDING_USAGE.source, requestId: expect.any(String), items: [
      { inventoryItemId: ids.flour, usedQuantity: "0.3", basis: "PLANNED", reason: null },
      { inventoryItemId: ids.bag, usedQuantity: "2", basis: "PLANNED", reason: null },
    ], expectedLedger: PENDING_USAGE.expectedLedger, confirmTakenOutOfUse: true, confirmEmpty: false, reason: null });
  });

  // Catches edits staying PLANNED or changed quantities submitting without reasons.
  it("switches an edited amount to owner reported and requires its reason", () => {
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async () => initial} />);
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: "0.1" } });
    expect(ui.getByLabelText("ที่มาของยอดใช้ แป้งขนมปังจากแผน")).toHaveValue("OWNER_REPORTED");
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
    fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ใช้จริงน้อยลง" } });
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeEnabled();
  });

  // Catches lexical-only edits being falsely reported as owner-measured actuals.
  it("keeps an equal lexical edit PLANNED and submits its canonical quantity without a new reason", async () => {
    const submitted: (ConfirmUseInput | CorrectUseInput)[] = [];
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async (_, data) => { submitted.push(payload(data)); return initial; }} />);
    fireEvent.change(ui.getByLabelText("จำนวนใช้ ถุงขนมจากแผน"), { target: { value: "2.000000" } });
    expect(ui.getByLabelText("ที่มาของยอดใช้ ถุงขนมจากแผน")).toHaveValue("PLANNED");
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]!.items[1]).toEqual({ inventoryItemId: ids.bag, usedQuantity: "2", basis: "PLANNED", reason: null });
  });

  it("allows explicitly owner-reported nonzero usage equal to plan without an item reason", async () => {
    const submitted: (ConfirmUseInput | CorrectUseInput)[] = [];
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async (_, data) => { submitted.push(payload(data)); return initial; }} />);
    fireEvent.change(ui.getByLabelText("ที่มาของยอดใช้ แป้งขนมปังจากแผน"), { target: { value: "OWNER_REPORTED" } });
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]!.items[0]).toEqual({ inventoryItemId: ids.flour, usedQuantity: "0.3", basis: "OWNER_REPORTED", reason: null });
  });

  // Catches a cancelled default/bulk-plan fallback and unresolved/zero lines being sent.
  it("keeps cancelled actuals blank until every line and zero reason is resolved", async () => {
    const submitted: (ConfirmUseInput | CorrectUseInput)[] = [];
    const ui = mount(<UsageForm view={CANCELLED_USAGE} mode="CONFIRM" action={async (_, data) => { submitted.push(payload(data)); return initial; }} />);
    expect(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน")).toHaveValue("");
    expect(ui.getByLabelText("จำนวนใช้ ถุงขนมจากแผน")).toHaveValue("");
    expect(ui.queryByRole("option", { name: "ตามแผน (ประมาณการ)" })).toBeNull();
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: "0" } });
    fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ไม่ได้ใช้" } });
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
    fireEvent.change(ui.getByLabelText("จำนวนใช้ ถุงขนมจากแผน"), { target: { value: "0" } });
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
    fireEvent.change(ui.getByLabelText("เหตุผล ถุงขนมจากแผน"), { target: { value: "ไม่ได้บรรจุ" } });
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]!.items).toEqual([
      { inventoryItemId: ids.flour, usedQuantity: "0", basis: "OWNER_REPORTED", reason: "ไม่ได้ใช้" },
      { inventoryItemId: ids.bag, usedQuantity: "0", basis: "OWNER_REPORTED", reason: "ไม่ได้บรรจุ" },
    ]);
  });

  it("requires deliberate empty confirmation and a reason for the exact empty set", () => {
    const view = { ...PENDING_USAGE, items: [], requirements: [], expectedLedger: [], stock: [] };
    const ui = mount(<UsageForm view={view} mode="CONFIRM" action={async () => initial} />);
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
    fireEvent.click(ui.getByLabelText("ยืนยันว่ารุ่นนี้ไม่มีรายการต้องใช้"));
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
    fireEvent.change(ui.getByLabelText("เหตุผลการบันทึก"), { target: { value: "ไม่มีวัตถุดิบในแผน" } });
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeEnabled();
  });

  // Catches float deltas, recomputing saved effects and confirm-only data leaking into corrections.
  it("previews exact correction deltas, preserves previous effects and sends only correction fields", async () => {
    const submitted: (ConfirmUseInput | CorrectUseInput)[] = [];
    const ui = mount(<UsageForm view={RECORDED_USAGE} mode="CORRECT" action={async (_, data) => { submitted.push(payload(data)); return initial; }} />);
    expect(ui.getByText("ยอดเดิม 0.3 · ผลสต๊อกเดิม -0.3")).toBeInTheDocument();
    expect(ui.getByText("แก้ประวัติเท่านั้น ไม่ปรับสต๊อกปัจจุบัน")).toBeInTheDocument();
    expect(ui.getByRole("link", { name: "เปิดสต๊อกปัจจุบัน แป้งขนมปังจากแผน" })).toHaveAttribute("href", `/inventory/${ids.flour}`);
    fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: "0.1" } });
    fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ตรวจยอดใหม่" } });
    fireEvent.change(ui.getByLabelText("จำนวนใช้ ถุงขนมจากแผน"), { target: { value: "1.75" } });
    fireEvent.change(ui.getByLabelText("เหตุผล ถุงขนมจากแผน"), { target: { value: "ตรวจยอดใหม่" } });
    expect(ui.getByText("ยอดใหม่ 0.1 · ผลสต๊อกที่เสนอ 0")).toBeInTheDocument();
    expect(ui.getByText("ยอดใหม่ 1.75 · ผลสต๊อกที่เสนอ 0.25")).toBeInTheDocument();
    expect(ui.getByRole("button", { name: "บันทึกการแก้ไข" })).toBeDisabled();
    fireEvent.change(ui.getByLabelText("เหตุผลการแก้ไข"), { target: { value: "ตรวจบันทึกแล้ว" } });
    fireEvent.click(ui.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toEqual({ ...RECORDED_USAGE.source, requestId: expect.any(String), expectedLedger: RECORDED_USAGE.expectedLedger, expectedRevisionId: ids.revision, reason: "ตรวจบันทึกแล้ว", items: [
      { inventoryItemId: ids.flour, usedQuantity: "0.1", basis: "OWNER_REPORTED", reason: "ตรวจยอดใหม่" },
      { inventoryItemId: ids.bag, usedQuantity: "1.75", basis: "OWNER_REPORTED", reason: "ตรวจยอดใหม่" },
    ] });
  });

  it("uses exact decimal correction arithmetic before a new count", () => {
    const view = { ...RECORDED_USAGE, expectedLedger: RECORDED_USAGE.expectedLedger.map(row => ({ ...row, countMovementId: null })) };
    const ui = mount(<UsageForm view={view} mode="CORRECT" action={async () => initial} />);
    fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: "0.1" } });
    expect(ui.getByText("ยอดใหม่ 0.1 · ผลสต๊อกที่เสนอ 0.2")).toBeInTheDocument();
  });

  for (const mode of ["CONFIRM", "CORRECT"] as const) {
    // Catches saved-boolean reset effects that only rotate once or replay old success on remount.
    it(`rotates intent IDs for three dispatched ${mode} successes independently`, async () => {
      const submittedRequestIds: string[] = [];
      const ui = mount(<UsageForm view={mode === "CONFIRM" ? PENDING_USAGE : RECORDED_USAGE} mode={mode} action={async (_, data) => {
        submittedRequestIds.push(payload(data).requestId);
        return successful(`30000000-0000-4000-8000-${String(submittedRequestIds.length).padStart(12, "0")}`);
      }} />);
      for (let index = 0; index < 3; index++) {
        if (mode === "CONFIRM") fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
        else fireEvent.change(ui.getByLabelText("เหตุผลการแก้ไข"), { target: { value: `ตรวจครั้ง ${index + 1}` } });
        fireEvent.click(ui.getByRole("button", { name: mode === "CONFIRM" ? "ยืนยันยอดใช้" : "บันทึกการแก้ไข" }));
        await waitFor(() => expect(submittedRequestIds).toHaveLength(index + 1));
        await waitFor(() => expect(ui.getByRole("button", { name: mode === "CONFIRM" ? "ยืนยันยอดใช้" : "บันทึกการแก้ไข" })).toBeDisabled());
      }
      expect(submittedRequestIds).toHaveLength(3);
      expect(new Set(submittedRequestIds).size).toBe(3);
      expect(submittedRequestIds.every(id => id.length === 36)).toBe(true);
    });
  }

  for (const stale of [false, true]) {
    // Actual form dispatch: catches React reset or failure handlers discarding full entered intent.
    it(`retains request, quantities and reasons after a dispatched ${stale ? "stale" : "invalid"} error and retry`, async () => {
      const submitted: (ConfirmUseInput | CorrectUseInput)[] = [];
      const ui = mount(<UsageForm view={RECORDED_USAGE} mode="CORRECT" action={async (_, data) => {
        submitted.push(payload(data));
        return { ...initial, error: stale ? "ข้อมูลเปลี่ยนแล้ว" : "ตรวจข้อมูลอีกครั้ง", stale, fieldErrors: { "items.0.usedQuantity": "ตรวจจำนวนรายการนี้" }, blockers: [{ cycleId: ids.cycle, cycleName: "รอบที่ต้องเคลียร์" }] };
      }} />);
      fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: "0.123456" } });
      fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ยอดจริง" } });
      fireEvent.change(ui.getByLabelText("เหตุผลการแก้ไข"), { target: { value: "แก้บันทึกเดิม" } });
      fireEvent.click(ui.getByRole("button", { name: "บันทึกการแก้ไข" }));
      await waitFor(() => expect(ui.getByRole("alert")).toHaveTextContent(stale ? "ข้อมูลเปลี่ยนแล้ว" : "ตรวจข้อมูลอีกครั้ง"));
      expect(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน")).toHaveValue("0.123456");
      expect(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน")).toHaveAccessibleDescription("ตรวจจำนวนรายการนี้");
      expect(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน")).toHaveValue("ยอดจริง");
      expect(ui.getByLabelText("เหตุผลการแก้ไข")).toHaveValue("แก้บันทึกเดิม");
      expect(ui.getByRole("link", { name: "รอบที่ต้องเคลียร์" })).toHaveAttribute("href", `/cycles/${ids.cycle}/consumption`);
      if (stale) expect(ui.getByRole("link", { name: "เปิดข้อมูลล่าสุด" })).toHaveAttribute("href", `/cycles/${ids.cycle}/consumption`);
      fireEvent.click(ui.getByRole("button", { name: "บันทึกการแก้ไข" }));
      await waitFor(() => expect(submitted).toHaveLength(2));
      expect(submitted[1]).toEqual(submitted[0]);
    });
  }

  it("does not consume a fresh intent on an already observed replayed operation", async () => {
    const requests: string[] = [];
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async (_, data) => { requests.push(payload(data).requestId); return successful(ids.operation, requests.length > 1); }} />);
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled());
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeEnabled());
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[0]).not.toBe(requests[1]);
    expect(requests[1]).toBe(requests[2]);
  });

  it("disables resubmit and editing while an actual dispatch is pending without stock success", async () => {
    let resolve!: (value: ConsumptionActionState) => void;
    const delayed = new Promise<ConsumptionActionState>(done => { resolve = done; });
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async () => delayed} />);
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(ui.getByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled());
    expect(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน")).toBeDisabled();
    expect(ui.queryByText("บันทึกยอดใช้แล้ว")).toBeNull();
    await act(async () => resolve({ ...initial, error: "ลองอีกครั้ง" }));
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeEnabled();
  });

  it.each(["-1", "0.1234567", "1000000000000", "1e2"])("does not submit invalid exact quantity %s", (quantity) => {
    const ui = mount(<UsageForm view={PENDING_USAGE} mode="CONFIRM" action={async () => initial} />);
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.change(ui.getByLabelText("จำนวนใช้ แป้งขนมปังจากแผน"), { target: { value: quantity } });
    fireEvent.change(ui.getByLabelText("เหตุผล แป้งขนมปังจากแผน"), { target: { value: "ตรวจแล้ว" } });
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeDisabled();
  });
});
