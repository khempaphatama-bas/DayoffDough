import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  RecipeMaintenanceError,
  type RecipeIngredient,
  type RecipeVersion,
} from "@/modules/products/application/products";
import { RecipeVersionForm } from "./recipe-version-form";

const mocks = vi.hoisted(() => ({
  createRecipeVersion: vi.fn(),
  activateRecipeVersion: vi.fn(),
  revalidatePath: vi.fn(),
}));
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const FLOUR_ID = "10000000-0000-4000-8000-000000000002";
const WATER_ID = "10000000-0000-4000-8000-000000000003";
const ICE_ID = "10000000-0000-4000-8000-000000000004";

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: async () => ({ id: OWNER_ID, email: "owner@example.com" }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/products/application/products", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/products/application/products")>(),
  createProductService: () => mocks,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const flour = { id: FLOUR_ID, name: "แป้ง", baseUnit: "g", ingredientKind: "STANDARD" } as const;
const water = { id: WATER_ID, name: "น้ำ", baseUnit: "ml", ingredientKind: "WATER" } as const;
const ice = { id: ICE_ID, name: "น้ำแข็ง", baseUnit: "kg", ingredientKind: "ICE" } as const;

const flourRow: RecipeIngredient = {
  id: "flour-row", inventoryItemId: FLOUR_ID, inventoryItemName: "แป้ง", baseUnit: "g",
  ingredientKind: "STANDARD", itemActive: true, quantityInBaseUnit: "410.5",
};
const waterRow: RecipeIngredient = {
  id: "water-row", inventoryItemId: WATER_ID, inventoryItemName: "น้ำ", baseUnit: "ml",
  ingredientKind: "WATER", itemActive: true, quantityInBaseUnit: "250",
};
const source: RecipeVersion = {
  id: "source-version", versionCode: "v1", baseYieldQuantity: "1.25", yieldUnit: "kg",
  laborMinutesPerBatch: 37, utilityCostSatangPerBatch: 1285, wasteAllowancePercent: "2.125",
  activeFrom: new Date("2026-11-16"), archivedAt: null, instructions: "นวดแป้ง\nพักไว้ก่อนอบ",
  ingredients: [flourRow, waterRow],
};

function editor(initialVersion: RecipeVersion, ingredientOptions = [flour, water, ice]) {
  return <RecipeVersionForm productId={PRODUCT_ID} defaultYieldUnit="piece" initialVersion={initialVersion} ingredientOptions={ingredientOptions} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createRecipeVersion.mockResolvedValue({
    ...source, id: "saved-version", versionCode: "v6", activeFrom: null,
    archivedVersions: [{ id: "archived-version", versionCode: "v2" }],
  });
});

it("copies all recipe fields, then saves edited, removed and added rows under a new code", async () => {
  const user = userEvent.setup();
  render(editor(source));
  expect(screen.getByLabelText("รหัสเวอร์ชัน")).toHaveValue("");
  expect(screen.getByLabelText("ผลผลิตต่อสูตร")).toHaveValue(1.25);
  expect(screen.getByLabelText("หน่วยผลผลิต")).toHaveValue("kg");
  expect(screen.getByLabelText("เวลาแรงงานต่อสูตร (นาที)")).toHaveValue(37);
  expect(screen.getByLabelText("ค่าไฟหรือแก๊สต่อสูตร (บาท)")).toHaveValue(12.85);
  expect(screen.getByLabelText("ค่าเผื่อสูญเสีย (%)")).toHaveValue(2.125);
  expect(screen.getByLabelText("วิธีทำ")).toHaveValue("นวดแป้ง\nพักไว้ก่อนอบ");
  expect(screen.getByLabelText("วัตถุดิบ 1")).toHaveValue(FLOUR_ID);
  expect(screen.getByLabelText("ปริมาณวัตถุดิบ 1")).toHaveValue(410.5);
  expect(screen.getByLabelText("วัตถุดิบ 2")).toHaveValue(WATER_ID);
  expect(screen.getByLabelText("ปริมาณวัตถุดิบ 2")).toHaveValue(250);
  await user.type(screen.getByLabelText("รหัสเวอร์ชัน"), "v6");
  await user.clear(screen.getByLabelText("ปริมาณวัตถุดิบ 1"));
  await user.type(screen.getByLabelText("ปริมาณวัตถุดิบ 1"), "415.25");
  await user.click(screen.getByRole("button", { name: "ลบวัตถุดิบ 2" }));
  await user.click(screen.getByRole("button", { name: "เพิ่มวัตถุดิบ" }));
  await user.selectOptions(screen.getByLabelText("วัตถุดิบ 2"), ICE_ID);
  await user.type(screen.getByLabelText("ปริมาณวัตถุดิบ 2"), "0.15");
  await user.click(screen.getByRole("button", { name: "บันทึกเวอร์ชันสูตร" }));

  expect(await screen.findByText("สูตร v2 ถูกย้ายไปที่ประวัติ")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("ยังไม่ได้เปิดใช้งาน");
  expect(mocks.createRecipeVersion).toHaveBeenCalledExactlyOnceWith(OWNER_ID, PRODUCT_ID, {
    versionCode: "v6", baseYieldQuantity: "1.25", yieldUnit: "kg", laborMinutesPerBatch: 37,
    utilityCostSatangPerBatch: 1285, wasteAllowancePercent: "2.125", instructions: "นวดแป้ง\nพักไว้ก่อนอบ",
    ingredients: [
      { inventoryItemId: FLOUR_ID, quantityInBaseUnit: "415.25", expectedIdentity: { baseUnit: "g", ingredientKind: "STANDARD" } },
      { inventoryItemId: ICE_ID, quantityInBaseUnit: "0.15", expectedIdentity: { baseUnit: "kg", ingredientKind: "ICE" } },
    ],
  });
  expect(mocks.activateRecipeVersion).not.toHaveBeenCalled();
  expect(mocks.revalidatePath.mock.calls).toEqual([[`/products/${PRODUCT_ID}`], ["/products"]]);
});

it("shows a copied inactive row and requires replacing or removing it before saving", async () => {
  const user = userEvent.setup();
  render(editor({ ...source, ingredients: [{ ...waterRow, itemActive: false }] }, [flour, ice]));

  expect(screen.getByLabelText("วัตถุดิบ 1")).toHaveDisplayValue(/น้ำ.*ปิดใช้งาน/);
  expect(screen.getByLabelText("ปริมาณวัตถุดิบ 1")).toHaveValue(250);
  expect(screen.getByText(/เลือกวัตถุดิบอื่นแทนหรือลบรายการนี้/)).toBeVisible();
  await user.type(screen.getByLabelText("รหัสเวอร์ชัน"), "v6");
  const save = screen.getByRole("button", { name: "บันทึกเวอร์ชันสูตร" });
  expect(save).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("วัตถุดิบ 1"), ICE_ID);
  expect(screen.getByRole("button", { name: "ลบวัตถุดิบ 1" })).toBeVisible();
  expect(save).toBeEnabled();
});

it.each([
  [new RecipeMaintenanceError("ITEM_CHANGED"), "โหลดหน้าใหม่"],
  [new Error("private SQL failure"), "บันทึกเวอร์ชันสูตรไม่สำเร็จ"],
])("renders safe guidance after the save rejects (%s)", async (error, guidance) => {
  mocks.createRecipeVersion.mockRejectedValueOnce(error);
  const user = userEvent.setup();
  render(<RecipeVersionForm productId={PRODUCT_ID} defaultYieldUnit="piece" ingredientOptions={[flour]} />);
  await user.click(screen.getByRole("button", { name: "เพิ่มเวอร์ชันสูตร" }));
  await user.type(screen.getByLabelText("รหัสเวอร์ชัน"), "v6");
  await user.type(screen.getByLabelText("ผลผลิตต่อสูตร"), "8");
  await user.selectOptions(screen.getByLabelText("วัตถุดิบ 1"), FLOUR_ID);
  await user.type(screen.getByLabelText("ปริมาณวัตถุดิบ 1"), "375");
  await user.click(screen.getByRole("button", { name: "บันทึกเวอร์ชันสูตร" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(guidance);
  expect(screen.getByRole("alert")).not.toHaveTextContent(error.message);
  expect(screen.getByLabelText("รหัสเวอร์ชัน")).toHaveValue("v6");
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
