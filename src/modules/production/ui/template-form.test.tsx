import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProductionTemplateDetail } from "@/modules/production/application/template-service";

vi.mock("@/app/(app)/production/templates/actions", () => ({
  saveProductionTemplateAction: vi.fn(),
}));
import { TemplateForm } from "./template-form";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVITY_ID = "22222222-2222-4222-8222-222222222222";

const PRODUCTS = [{ id: PRODUCT_ID, name: "ฟอคคาเซีย" }];
const DRAFT: ProductionTemplateDetail = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "ฟอคคาเซียชุดใหม่",
  scope: "PRODUCT",
  productId: PRODUCT_ID,
  productName: "ฟอคคาเซีย",
  active: false,
  activeActivityCount: 1,
  activities: [{
    id: ACTIVITY_ID,
    name: "ผสมแป้ง",
    offsetDaysFromDelivery: -1,
    defaultTime: "08:00",
    estimatedDurationMinutes: 30,
    sequence: 1,
    notes: "ใช้หัวเชื้อ",
    active: true,
  }],
};

describe("TemplateForm", () => {
  it("keeps entered activity values beside a Thai validation error after an invalid save", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "ERROR",
      message: "กรุณาตรวจสอบข้อมูลเทมเพลต",
      fieldErrors: { "activities.0.estimatedDurationMinutes": "ระยะเวลาต้องมากกว่า 0 นาที" },
      values: { activities: JSON.stringify([{ ...DRAFT.activities[0], estimatedDurationMinutes: 0 }]) },
    });
    const user = userEvent.setup();
    render(<TemplateForm products={PRODUCTS} initialTemplate={DRAFT} action={action} />);

    await user.clear(screen.getByLabelText("ระยะเวลา (นาที) 1"));
    await user.type(screen.getByLabelText("ระยะเวลา (นาที) 1"), "0");
    await user.click(screen.getByRole("button", { name: "บันทึกเทมเพลต" }));

    expect(await screen.findByText("ระยะเวลาต้องมากกว่า 0 นาที")).toBeVisible();
    expect(screen.getByLabelText("ชื่อกิจกรรม 1")).toHaveValue("ผสมแป้ง");
    expect(screen.getByRole("spinbutton", { name: /ระยะเวลา \(นาที\) 1/ })).toHaveValue(0);
  });

  it("keeps the stable existing activity id while reordering with keyboard-accessible controls", async () => {
    const user = userEvent.setup();
    render(<TemplateForm products={PRODUCTS} initialTemplate={{ ...DRAFT, activities: [
      DRAFT.activities[0]!,
      { ...DRAFT.activities[0]!, id: "44444444-4444-4444-8444-444444444444", name: "อบ", sequence: 2 },
    ] }} action={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "เลื่อนลง กิจกรรม 1" }));

    expect(screen.getByLabelText("ชื่อกิจกรรม 1")).toHaveValue("อบ");
    expect(screen.getByLabelText("ชื่อกิจกรรม 2")).toHaveValue("ผสมแป้ง");
    expect(screen.getByDisplayValue(ACTIVITY_ID)).toHaveAttribute("name", "activityId_2");
  });

  it("offers archive and restore controls without a delete control", async () => {
    const user = userEvent.setup();
    render(<TemplateForm products={PRODUCTS} initialTemplate={DRAFT} action={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "เก็บกิจกรรม 1" }));
    expect(screen.getByRole("button", { name: "กู้คืนกิจกรรม 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /ลบ/ })).toBeNull();
  });

  it("places offset and start-time errors beside their controls and explains the relative delivery date", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "ERROR",
      message: "กรุณาตรวจสอบข้อมูลเทมเพลต",
      fieldErrors: {
        "activities.0.offsetDaysFromDelivery": "จำนวนวันต้องเป็นจำนวนเต็ม",
        "activities.0.defaultTime": "กรุณาระบุเวลาให้ถูกต้อง",
      },
      values: { activities: JSON.stringify(DRAFT.activities) },
    });
    const user = userEvent.setup();
    render(<TemplateForm products={PRODUCTS} initialTemplate={DRAFT} action={action} />);

    expect(screen.getByText("ก่อนวันส่ง 1 วัน")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "บันทึกเทมเพลต" }));

    expect(await screen.findByText("จำนวนวันต้องเป็นจำนวนเต็ม")).toBeVisible();
    expect(screen.getByText("กรุณาระบุเวลาให้ถูกต้อง")).toBeVisible();
  });

  it("reserves phone space and pins its save action above the mobile navigation", () => {
    render(<TemplateForm products={PRODUCTS} initialTemplate={DRAFT} action={vi.fn()} />);

    const saveAction = screen.getByTestId("template-save-action");
    expect(screen.getByRole("button", { name: "บันทึกเทมเพลต" }).closest("form")).toHaveClass("pb-24", "md:pb-0");
    expect(saveAction).toHaveClass(
      "sticky",
      "bottom-20",
      "z-20",
      "md:static",
      "md:mx-0",
      "md:border-0",
      "md:bg-transparent",
      "md:p-0",
    );
    expect(within(saveAction).getByRole("button", { name: "บันทึกเทมเพลต" })).toBeEnabled();
  });
});
