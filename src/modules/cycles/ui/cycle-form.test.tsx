import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";

const actions = vi.hoisted(() => ({
  createCycleAction: vi.fn(),
  updateCycleAction: vi.fn(),
}));

vi.mock("@/app/(app)/cycles/actions", () => actions);

import { CycleForm } from "./cycle-form";

const CYCLE: BakeCycle = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "00000000-0000-4000-8000-000000000001",
  cycleNumber: 12,
  name: "รอบส่ง 30 ส.ค.",
  status: "IN_PRODUCTION",
  orderCutoffAt: new Date("2026-08-27T05:00:00.000Z"),
  targetProductionDate: "2026-08-29",
  primaryDeliveryDate: "2026-08-30",
  notes: "อบช่วงเช้า",
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("CycleForm", () => {
  it("defaults new cycles to OPEN and only offers initial Phase 2 statuses", () => {
    render(<CycleForm />);

    expect(screen.getByLabelText("สถานะเริ่มต้น")).toHaveValue("OPEN");
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("value")))
      .toEqual(["OPEN", "DRAFT"]);
    expect(screen.getByLabelText("ชื่อรอบอบ")).toBeRequired();
    expect(screen.getByLabelText("วันผลิต")).toBeRequired();
    expect(screen.getByLabelText("วันส่งหลัก")).toBeRequired();
  });

  it("keeps status out of metadata edits and displays Bangkok-local cutoff time", () => {
    render(<CycleForm cycle={CYCLE} />);

    expect(screen.queryByLabelText("สถานะเริ่มต้น")).not.toBeInTheDocument();
    expect(screen.getByLabelText("วันปิดรับออเดอร์")).toHaveValue(
      "2026-08-27T12:00",
    );
    expect(screen.getByLabelText("ชื่อรอบอบ")).toHaveValue(CYCLE.name);
    expect(screen.getByDisplayValue("อบช่วงเช้า")).toBeInTheDocument();
  });

  it("keeps typed values and shows Thai errors after an expected action failure", async () => {
    actions.createCycleAction.mockResolvedValue({
      error: "กรุณาตรวจสอบข้อมูลรอบอบ",
      fieldErrors: { name: ["กรุณากรอกชื่อรอบอบให้ถูกต้อง"] },
      saved: false,
    });
    const user = userEvent.setup();
    render(<CycleForm />);

    const name = screen.getByLabelText("ชื่อรอบอบ");
    const status = screen.getByLabelText("สถานะเริ่มต้น");
    const productionDate = screen.getByLabelText("วันผลิต");
    const deliveryDate = screen.getByLabelText("วันส่งหลัก");
    const notes = screen.getByLabelText("หมายเหตุ");
    await user.type(name, "รอบส่งเชียงใหม่");
    await user.selectOptions(status, "DRAFT");
    await user.type(productionDate, "2026-09-05");
    await user.type(deliveryDate, "2026-09-06");
    await user.type(notes, "อบช่วงเช้า");
    await user.click(screen.getByRole("button", { name: "สร้างรอบอบ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณาตรวจสอบข้อมูลรอบอบ",
    );
    expect(screen.getByText("กรุณากรอกชื่อรอบอบให้ถูกต้อง"))
      .toBeInTheDocument();
    expect(name).toHaveValue("รอบส่งเชียงใหม่");
    expect(status).toHaveValue("DRAFT");
    expect(productionDate).toHaveValue("2026-09-05");
    expect(deliveryDate).toHaveValue("2026-09-06");
    expect(notes).toHaveValue("อบช่วงเช้า");
  });
});
