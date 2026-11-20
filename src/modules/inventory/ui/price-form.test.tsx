import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ count: vi.fn(), price: vi.fn() }));
vi.mock("@/app/(app)/inventory/actions", () => ({ recordInventoryCountAction: actions.count, addInventoryPriceAction: actions.price }));
import { PhysicalCountForm, PriceForm } from "./price-form";
const itemId = "10000000-0000-4000-8000-000000000005";
const blocker = { cycleId: "10000000-0000-4000-8000-000000000001", cycleName: "รอบค้างยอดใช้" };
beforeEach(() => { vi.clearAllMocks(); actions.count.mockResolvedValue({ error: null, saved: true }); actions.price.mockResolvedValue({ error: null, saved: true }); });
it("guides a known pending item to its selected settlement without allowing ordinary COUNT", () => {
  render(<PhysicalCountForm itemId={itemId} baseUnit="g" blockers={[blocker]} />);
  expect(screen.getByRole("button", { name: "บันทึกยอดนับ" })).toBeDisabled();
  expect(screen.getByRole("link", { name: blocker.cycleName })).toHaveAttribute("href", `/cycles/${blocker.cycleId}/consumption`);
  expect(screen.getByRole("link", { name: "นับของเหลือและเคลียร์ยอดใช้" })).toHaveAttribute("href", `/cycles/${blocker.cycleId}/consumption?mode=settle&countItem=${itemId}`);
  expect(screen.queryByText(blocker.cycleId)).toBeNull();
});
it("renders owned blocker links after dispatching COUNT from a stale unblocked page", async () => {
  actions.count.mockResolvedValue({ error: "มีรอบค้างยอดใช้ กรุณาเคลียร์ก่อนนับ", saved: false, blockers: [blocker] });
  render(<PhysicalCountForm itemId={itemId} baseUnit="g" />);
  await userEvent.type(screen.getByLabelText(/จำนวนที่นับได้/), "3.125");
  await userEvent.click(screen.getByRole("button", { name: "บันทึกยอดนับ" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("มีรอบค้างยอดใช้");
  expect(screen.getByRole("link", { name: blocker.cycleName })).toHaveAttribute("href", `/cycles/${blocker.cycleId}/consumption`);
  expect(String(actions.count.mock.calls[0]![1].get("countedQuantity"))).toBe("3.125");
  expect(screen.getByLabelText(/จำนวนที่นับได้/)).toHaveValue(3.125);
});
it("submits the units displayed for ordinary count and purchase-price inputs", async () => {
  const count = render(<PhysicalCountForm itemId={itemId} baseUnit="kg" />);
  await userEvent.type(screen.getByLabelText(/จำนวนที่นับได้.*kg/), "2");
  await userEvent.click(screen.getByRole("button", { name: "บันทึกยอดนับ" }));
  expect(await screen.findByText("อัปเดตยอดสต๊อกแล้ว")).toBeVisible();
  expect(actions.count.mock.calls[0]![1].get("itemId")).toBe(itemId);
  expect(actions.count.mock.calls[0]![1].get("expectedBaseUnit")).toBe("kg");
  count.unmount();
  render(<PriceForm itemId={itemId} baseUnit="g" packBaseQuantity="1000" defaultDate="2026-11-10" />);
  expect(screen.getByLabelText(/ปริมาณฐานในแพ็ก.*g/)).toHaveValue(1000);
  await userEvent.type(screen.getByLabelText("ราคาต่อแพ็ก"), "20");
  await userEvent.click(screen.getByRole("button", { name: "บันทึกราคา" }));
  expect(await screen.findByText("บันทึกราคาแล้ว")).toBeVisible();
  expect(actions.price.mock.calls[0]![1].get("itemId")).toBe(itemId);
  expect(actions.price.mock.calls[0]![1].get("expectedBaseUnit")).toBe("g");
});

it("does not silently reinterpret a price draft under a new unit after revalidation", async () => {
  actions.price.mockResolvedValue({ error: "หน่วยเปลี่ยน กรุณาโหลดข้อมูลล่าสุด", saved: false });
  const user = userEvent.setup();
  const view = render(<PriceForm itemId={itemId} baseUnit="g" packBaseQuantity="1000" defaultDate="2026-11-10" />);
  await user.type(screen.getByLabelText("ราคาต่อแพ็ก"), "20");
  view.rerender(<PriceForm itemId={itemId} baseUnit="kg" packBaseQuantity="1" defaultDate="2026-11-11" />);
  await user.click(screen.getByRole("button", { name: "บันทึกราคา" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/โหลดข้อมูลล่าสุด/);
  expect(screen.getByLabelText("ราคาต่อแพ็ก")).toHaveValue(20);
  expect(screen.getByLabelText(/ปริมาณฐานในแพ็ก.*\(g\)/)).toHaveValue(1000);
  expect(screen.getByLabelText("วันที่มีผล")).toHaveValue("2026-11-10");
  expect(actions.price.mock.calls[0]![1].get("expectedBaseUnit")).toBe("g");
});
