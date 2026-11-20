import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { InventoryItem } from "@/modules/inventory/application/inventory";
import { InventoryForm } from "./inventory-form";

const water: InventoryItem = {
  id: "10000000-0000-4000-8000-000000000005", ownerId: "10000000-0000-4000-8000-000000000099",
  name: "น้ำกรอง", category: "INGREDIENT", ingredientKind: "WATER", baseUnit: "l",
  purchaseUnitLabel: "ไม่ต้องซื้อ", baseQuantityPerPurchasePack: "1", minimumStockQuantity: "0",
  active: true, notes: "เตรียมก่อนผสม",
};

it.each([
  ["น้ำ", "WATER", "ml", ["ml", "L"]],
  ["น้ำแข็ง", "ICE", "g", ["g", "kg"]],
] as const)("defaults %s to its allowed units and submits without purchase data", async (label, kind, unit, options) => {
  const action = vi.fn().mockResolvedValue({ error: null, saved: true });
  const user = userEvent.setup();
  render(<InventoryForm action={action} />);
  await user.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
  expect(screen.getByLabelText("ชื่อหน่วยซื้อ")).toBeRequired();
  expect(screen.getByLabelText("ปริมาณต่อแพ็ก")).toBeRequired();
  expect(screen.getByLabelText("สต๊อกขั้นต่ำ")).toBeRequired();
  await user.selectOptions(screen.getByLabelText("ประเภท"), "PACKAGING");
  await user.selectOptions(screen.getByLabelText("ชนิดวัตถุดิบ"), screen.getByRole("option", { name: label }));
  const units = screen.getByLabelText("หน่วยฐาน");
  expect(units).toHaveValue(unit);
  expect(within(units).getAllByRole("option").map((option) => option.textContent)).toEqual(options);
  expect(screen.getByText("ไม่คิดต้นทุนและไม่ต้องนับสต๊อก")).toBeVisible();
  expect(screen.queryByLabelText("ชื่อหน่วยซื้อ")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("ปริมาณต่อแพ็ก")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("สต๊อกขั้นต่ำ")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("ชื่อรายการ"), label);
  await user.click(screen.getByRole("button", { name: "บันทึกรายการ" }));
  expect(await screen.findByText("บันทึกรายการแล้ว")).toBeVisible();
  expect(Object.fromEntries(action.mock.calls[0]![1])).toEqual({ name: label, category: "INGREDIENT", ingredientKind: kind, baseUnit: unit, notes: "" });
});

it("keeps the chosen water unit and draft input after rejection and server revalidation", async () => {
  const action = vi.fn().mockResolvedValue({ error: "กรุณาตรวจสอบข้อมูล", saved: false });
  const user = userEvent.setup();
  const view = render(<InventoryForm action={action} initialItem={{ ...water, baseUnit: "ml" }} />);
  const name = screen.getByLabelText("ชื่อรายการ");
  const notes = screen.getByLabelText("หมายเหตุ");
  await user.clear(name);
  await user.type(name, "น้ำใหม่");
  await user.selectOptions(screen.getByLabelText("หน่วยฐาน"), "l");
  await user.type(notes, " ทุกวัน");
  view.rerender(<InventoryForm action={action} initialItem={{ ...water, baseUnit: "ml", notes: "เปลี่ยนจากแท็บอื่น" }} />);
  expect(screen.getByLabelText("หน่วยฐาน")).toHaveValue("l");
  await user.click(screen.getByRole("button", { name: "บันทึกรายการ" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาตรวจสอบข้อมูล");
  expect(action.mock.calls[0]![1].get("baseUnit")).toBe("l");
  expect(name).toHaveValue("น้ำใหม่");
  expect(notes).toHaveValue("เตรียมก่อนผสม ทุกวัน");
  expect(screen.getByLabelText("หน่วยฐาน")).toHaveValue("l");
});

it("does not use a prep-only item's placeholder as a real purchase pack when switching to standard", async () => {
  const action = vi.fn().mockResolvedValue({ error: null, saved: true });
  const user = userEvent.setup();
  render(<InventoryForm action={action} initialItem={water} editPolicy={{ canChangeIdentity: true, canChangePack: true }} />);
  await user.selectOptions(screen.getByLabelText("ชนิดวัตถุดิบ"), "STANDARD");
  await user.click(screen.getByRole("button", { name: "บันทึกรายการ" }));
  expect(action).not.toHaveBeenCalled();
  expect(screen.getByLabelText("ชื่อหน่วยซื้อ")).toHaveValue("");
  expect(screen.getByLabelText("ปริมาณต่อแพ็ก")).toHaveValue(null);
});
