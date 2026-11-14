import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { USAGE_REVISION } from "@tests/fixtures/consumption-views";
import { UsageHistory } from "./usage-history";

describe("UsageHistory", () => {
  it("renders persisted labels, estimate basis, reasons and original stock effects in supplied revision order without editing", () => {
    const second = { ...USAGE_REVISION, id: "30000000-0000-4000-8000-000000000001", operationId: "30000000-0000-4000-8000-000000000002", revisionNumber: 2, previousRevisionId: USAGE_REVISION.id, reason: "ตรวจบันทึกใหม่", confirmedAt: new Date("2026-10-23T03:00:00Z"), items: [
      { ...USAGE_REVISION.items[0]!, basis: "OWNER_REPORTED" as const, usedQuantity: "0.1", reason: "ชั่งจริง", mode: "HISTORY_ONLY" as const, quantityDelta: "0", movementId: "30000000-0000-4000-8000-000000000003" },
      { ...USAGE_REVISION.items[1]!, quantityDelta: "0", movementId: "30000000-0000-4000-8000-000000000004" },
    ] };
    const ui = render(<UsageHistory revisions={[USAGE_REVISION, second]} />);
    const revisions = ui.getAllByRole("article");
    expect(within(revisions[0]!).getByRole("heading", { name: "บันทึกครั้งที่ 1" })).toBeInTheDocument();
    expect(within(revisions[1]!).getByRole("heading", { name: "บันทึกครั้งที่ 2" })).toBeInTheDocument();
    expect(within(revisions[0]!).getByText("ยอดใช้ 0.3 · ผลสต๊อก -0.3 · DIRECT")).toBeInTheDocument();
    expect(within(revisions[0]!).getAllByText("ตามแผน (ประมาณการ)")).toHaveLength(2);
    expect(within(revisions[1]!).getByText("เจ้าของบันทึกใช้จริง")).toBeInTheDocument();
    expect(within(revisions[1]!).getByText("ยอดใช้ 0.1 · ผลสต๊อก 0 · HISTORY_ONLY")).toBeInTheDocument();
    expect(within(revisions[1]!).getByText("ชั่งจริง")).toBeInTheDocument();
    expect(within(revisions[1]!).getByText("ตรวจบันทึกใหม่")).toBeInTheDocument();
    expect(within(revisions[1]!).getByText("แป้งขนมปังจากแผน")).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
    expect(ui.queryByRole("textbox")).toBeNull();
  });
});
