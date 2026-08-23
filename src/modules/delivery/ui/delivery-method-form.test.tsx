import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createDeliveryMethodAction: vi.fn(),
  updateDeliveryMethodAction: vi.fn(),
}));

vi.mock("@/app/(app)/delivery/actions", () => actions);

import { DeliveryMethodForm } from "./delivery-method-form";

describe("DeliveryMethodForm", () => {
  it("keeps typed values and shows a Thai error after an expected action failure", async () => {
    actions.createDeliveryMethodAction.mockResolvedValue({
      error: "กรุณาตรวจสอบข้อมูลวิธีส่ง",
      saved: false,
    });
    const user = userEvent.setup();
    render(<DeliveryMethodForm />);

    await user.click(screen.getByRole("button", { name: "เพิ่มวิธีส่ง" }));
    await user.type(screen.getByLabelText("ชื่อวิธีส่ง"), "KEX Same Day");
    await user.type(screen.getByLabelText("ค่าส่งที่เรียกเก็บ"), "120");
    await user.type(screen.getByLabelText("ต้นทุนขนส่ง"), "115.50");
    await user.click(screen.getByLabelText("ต้องระบุสถานที่จัดส่ง"));
    await user.type(screen.getByLabelText("หมายเหตุ"), "โทรก่อนส่ง");
    await user.click(screen.getByRole("button", { name: "บันทึกวิธีส่ง" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณาตรวจสอบข้อมูลวิธีส่ง",
    );
    expect(screen.getByLabelText("ชื่อวิธีส่ง")).toHaveValue("KEX Same Day");
    expect(screen.getByLabelText("ค่าส่งที่เรียกเก็บ")).toHaveValue(120);
    expect(screen.getByLabelText("ต้นทุนขนส่ง")).toHaveValue(115.5);
    expect(screen.getByLabelText("ต้องระบุสถานที่จัดส่ง"))
      .not.toBeChecked();
    expect(screen.getByLabelText("หมายเหตุ")).toHaveValue("โทรก่อนส่ง");
  });
});
