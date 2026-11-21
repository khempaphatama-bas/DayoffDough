import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createPackagingRuleAction } from "@/app/(app)/delivery/actions";
import { PackagingRuleForm } from "./packaging-rule-form";

vi.mock("@/app/(app)/delivery/actions", () => ({ createPackagingRuleAction: vi.fn() }));

it("retains the displayed item/unit and amount until the owner deliberately selects a new unit", async () => {
  const action = vi.mocked(createPackagingRuleAction);
  action.mockResolvedValueOnce({ saved: false, error: "โหลดหน้าใหม่และตรวจสอบจำนวนอีกครั้ง" })
    .mockResolvedValueOnce({ saved: true, error: null });
  const form = (baseUnit: string) => <PackagingRuleForm deliveryMethods={[]} products={[{ id: "loaf", name: "ขนมปัง" }]}
    packagingItems={[{ id: "paper", name: "กระดาษ", baseUnit }, { id: "box", name: "กล่อง", baseUnit: "piece" }]} />;
  const user = userEvent.setup();
  const view = render(form("g"));
  const item = screen.getByLabelText("รายการบรรจุภัณฑ์"), quantity = screen.getByLabelText(/จำนวนที่ใช้/);
  const save = screen.getByRole("button", { name: "บันทึกกฎบรรจุภัณฑ์" });
  await user.selectOptions(screen.getByLabelText("สินค้า"), "loaf");
  await user.selectOptions(item, screen.getByRole("option", { name: "กล่อง (piece)" }));
  await user.type(quantity, "2");
  await user.selectOptions(item, screen.getByRole("option", { name: "กระดาษ (g)" }));
  expect(quantity).toHaveValue(null);
  await user.type(quantity, "50");
  view.rerender(form("kg"));
  expect.soft(item).toHaveDisplayValue(/กระดาษ \(g\)/);
  await user.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent("ตรวจสอบจำนวน");
  const intent = { scope: "PRODUCT", productId: "loaf", inventoryItemId: "paper", expectedBaseUnit: "g",
    consumptionBasis: "PER_PRODUCT_UNIT", quantityInBaseUnit: "50", notes: "" };
  expect.soft(Object.fromEntries(action.mock.calls[0]![1])).toEqual(intent);
  expect.soft(item).toHaveDisplayValue(/กระดาษ \(g\)/);
  expect.soft(quantity).toHaveValue(50);
  await user.selectOptions(item, screen.getByRole("option", { name: "กระดาษ (kg)" }));
  expect(quantity).toHaveValue(null);
  await user.type(quantity, "0.05");
  await user.click(save);
  expect(await screen.findByText("บันทึกกฎบรรจุภัณฑ์แล้ว")).toBeVisible();
  expect(Object.fromEntries(action.mock.calls[1]![1])).toEqual({ ...intent, expectedBaseUnit: "kg", quantityInBaseUnit: "0.05" });
});
