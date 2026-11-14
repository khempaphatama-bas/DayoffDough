import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONSUMPTION_IDS as ids, HISTORY_USAGE, LEGACY_USAGE, MIXED_SETTLEMENT_PREVIEW, PENDING_USAGE, RECORDED_USAGE, RELATED_SETTLEMENT_CONTEXT, SETTLEMENT_PREVIEW } from "@tests/fixtures/consumption-views";
import { ConsumptionView } from "./consumption-view";

vi.mock("@/app/(app)/cycles/[id]/consumption/actions", () => ({ confirmUseAction: vi.fn(), correctUseAction: vi.fn(), settleUseAction: vi.fn() }));

describe("ConsumptionView", () => {
  it("keeps a mixed selection actionable without inventing counted-only use", () => {
    const ui = render(<ConsumptionView view={PENDING_USAGE} settlement={MIXED_SETTLEMENT_PREVIEW} />);
    expect(ui.getByLabelText("ของเหลือหลังใช้ น้ำตาลทราย (kg)")).toHaveValue("");
    expect(ui.queryByLabelText("จำนวนใช้ น้ำตาลทราย")).toBeNull();
    expect(ui.queryByLabelText(`จำนวนใช้ ${ids.countedOnly}`)).toBeNull();
    const form = ui.getByRole("form", { name: "นับของเหลือและเคลียร์ยอดใช้" }) as HTMLFormElement;
    const payload = JSON.parse(String(new FormData(form).get("payload"))) as {
      counts: { inventoryItemId: string }[];
      contexts: { contextId: string; items: { inventoryItemId: string }[] }[];
    };
    expect(payload.counts.map(item => item.inventoryItemId)).toEqual([ids.flour, ids.countedOnly]);
    expect(payload.contexts.map(context => [context.contextId, context.items.map(item => item.inventoryItemId)]))
      .toEqual([[ids.context, [ids.flour, ids.bag]]]);
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: "ยืนยันยอดใช้" })).toBeNull();
  });
  it.each([HISTORY_USAGE, LEGACY_USAGE])("renders $kind read-only without mutation controls", (view) => {
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(<ConsumptionView view={view} />, { container, baseElement: container });
    expect(ui.getByText(/อ่านอย่างเดียว/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
    expect(ui.queryByRole("textbox")).toBeNull();
  });
  it("allows terminal current corrections independently of Operations and keeps generation history accessible", () => {
    const ui = render(<ConsumptionView view={RECORDED_USAGE} />);
    expect(ui.getByRole("button", { name: "บันทึกการแก้ไข" })).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: /ส่งครบ|จบรอบ|เริ่มผลิต|ยกเลิกรอบ/ })).toBeNull();
    expect(ui.getByRole("link", { name: "เปิดยอดใช้รุ่น 1 · ใช้งานอยู่" })).toHaveAttribute("href", `/cycles/${RECORDED_USAGE.cycle.cycleId}/consumption`);
  });
  it("does not render a confirm form without a matching source/context", () => {
    const ui = render(<ConsumptionView view={{ ...PENDING_USAGE, source: null }} />);
    expect(ui.getByText(/ยังไม่พร้อมบันทึก/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
  it("does not render a correction without the pointer-matched current predecessor", () => {
    const ui = render(<ConsumptionView view={{ ...RECORDED_USAGE, context: { ...RECORDED_USAGE.context!, currentRevisionId: null } }} />);
    expect(ui.getByText(/ยังไม่พร้อมบันทึก/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
  it("scopes ordinary use to one Cycle and offers explicit GET selection for settlement", () => {
    const ui = render(<ConsumptionView view={PENDING_USAGE} />);
    expect(ui.getByRole("form", { name: "เลือกรายการนับของเหลือ" })).toHaveAttribute("method", "get");
    expect(ui.getAllByRole("checkbox", { name: /นับของเหลือ/ })).toHaveLength(2);
    expect(ui.getByRole("button", { name: "ดูตัวอย่างและเริ่มรายการนับใหม่" })).toBeDisabled();
    fireEvent.click(ui.getByRole("checkbox", { name: "นับของเหลือ แป้งขนมปังจากแผน" }));
    expect(ui.getByRole("button", { name: "ดูตัวอย่างและเริ่มรายการนับใหม่" })).toBeEnabled();
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeInTheDocument();
  });
  it("shows all related Cycle contexts for settlement instead of a parallel normal-use form", () => {
    const preview = { ...SETTLEMENT_PREVIEW, contexts: [...SETTLEMENT_PREVIEW.contexts, RELATED_SETTLEMENT_CONTEXT] };
    const ui = render(<ConsumptionView view={PENDING_USAGE} settlement={preview} />);
    expect(ui.getByRole("link", { name: "รอบเกี่ยวข้อง" })).toHaveAttribute("href", "/cycles/20000000-0000-4000-8000-000000000001/consumption");
    expect(ui.queryByRole("button", { name: "ยืนยันยอดใช้" })).toBeNull();
  });
});
