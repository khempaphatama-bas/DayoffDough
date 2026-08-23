import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

vi.mock("@/app/(app)/customers/actions", () => actions);

import { CustomerForm } from "./customer-form";

describe("CustomerForm", () => {
  it("keeps typed values and shows Thai errors after an expected action failure", async () => {
    actions.createCustomerAction.mockResolvedValue({
      error: "กรุณาตรวจสอบข้อมูลลูกค้า",
      fieldErrors: { name: ["กรุณากรอกชื่อลูกค้าให้ถูกต้อง"] },
      saved: false,
    });
    const user = userEvent.setup();
    render(
      <CustomerForm
        deliveryMethods={[
          {
            id: "00000000-0000-4000-8000-000000000030",
            name: "KEX Same Day",
            active: true,
          },
        ]}
      />,
    );

    const name = screen.getByLabelText("ชื่อลูกค้า");
    const contact = screen.getByLabelText("ช่องทางติดต่อ");
    const method = screen.getByLabelText("วิธีส่งประจำ");
    const location = screen.getByLabelText("สถานที่จัดส่งประจำ");
    await user.type(name, "คุณเมย์");
    await user.type(contact, "@may");
    await user.selectOptions(
      method,
      "00000000-0000-4000-8000-000000000030",
    );
    await user.type(location, "บางรัก กรุงเทพฯ");
    await user.click(screen.getByRole("button", { name: "บันทึกลูกค้า" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณาตรวจสอบข้อมูลลูกค้า",
    );
    expect(screen.getByText("กรุณากรอกชื่อลูกค้าให้ถูกต้อง"))
      .toBeInTheDocument();
    expect(name).toHaveValue("คุณเมย์");
    expect(contact).toHaveValue("@may");
    expect(method).toHaveValue(
      "00000000-0000-4000-8000-000000000030",
    );
    expect(location).toHaveValue("บางรัก กรุงเทพฯ");
  });
});
