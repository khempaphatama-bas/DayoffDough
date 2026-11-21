import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createRecipeVersionAction } from "@/app/(app)/products/actions";
import { RecipeVersionForm } from "./recipe-version-form";

vi.mock("@/app/(app)/products/actions", () => ({ createRecipeVersionAction: vi.fn() }));

const editor = <RecipeVersionForm productId="loaf" defaultYieldUnit="piece"
  ingredientOptions={[{ id: "flour", name: "แป้ง", baseUnit: "g", ingredientKind: "STANDARD" },
    { id: "sugar", name: "น้ำตาล", baseUnit: "g", ingredientKind: "STANDARD" }]}
  initialVersion={{ id: "source", versionCode: "v1", baseYieldQuantity: "8", yieldUnit: "piece",
    laborMinutesPerBatch: 37, utilityCostSatangPerBatch: 1285, wasteAllowancePercent: "2.125",
    instructions: "ผสมและอบ", activeFrom: null, archivedAt: null,
    ingredients: [{ id: "line", inventoryItemId: "flour", inventoryItemName: "แป้ง", baseUnit: "g",
      ingredientKind: "STANDARD", itemActive: true, quantityInBaseUnit: "20" }] }} />;

it("will not send recipe fields in a native GET before hydration", () => {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(editor), "text/html");
  expect(document.forms[0]?.method).toBe("post");
});

it("keeps the visible yield, ingredient and complete submitted draft identical on retry", async () => {
  const saveAction = vi.mocked(createRecipeVersionAction);
  saveAction.mockResolvedValueOnce({ error: "ลองอีกครั้ง", saved: false }).mockResolvedValueOnce({ error: null, saved: true });
  const user = userEvent.setup();
  render(editor);
  await user.type(screen.getByLabelText("รหัสเวอร์ชัน"), "v2");
  await user.selectOptions(screen.getByLabelText("หน่วยผลผลิต"), "kg");
  await user.selectOptions(screen.getByLabelText("วัตถุดิบ 1"), "sugar");
  await user.clear(screen.getByLabelText("ปริมาณวัตถุดิบ 1"));
  await user.type(screen.getByLabelText("ปริมาณวัตถุดิบ 1"), "50");
  const save = screen.getByRole("button", { name: "บันทึกเวอร์ชันสูตร" });
  await user.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent("ลองอีกครั้ง");
  expect.soft(screen.getByLabelText("หน่วยผลผลิต")).toHaveValue("kg");
  expect.soft(screen.getByLabelText("วัตถุดิบ 1")).toHaveDisplayValue("น้ำตาล (g)");
  expect(screen.getByLabelText("ปริมาณวัตถุดิบ 1")).toHaveValue(50);
  await user.click(save);
  expect(await screen.findByRole("status")).toBeVisible();
  const expected = { productId: "loaf", ingredientCount: "1", versionCode: "v2", baseYieldQuantity: "8",
    yieldUnit: "kg", laborMinutesPerBatch: "37", utilityCostBahtPerBatch: "12.85", wasteAllowancePercent: "2.125",
    ingredientId_0: "sugar", ingredientBaseUnit_0: "g", ingredientKind_0: "STANDARD", ingredientQuantity_0: "50",
    instructions: "ผสมและอบ" };
  expect(saveAction.mock.calls.map(([, data]) => Object.fromEntries(data))).toEqual([expected, expected]);
});
