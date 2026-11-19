import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeMaintenanceError, type ProductDetail, type RecipeVersion } from "@/modules/products/application/products";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_ID = "11111111-1111-4111-8111-111111111112";
const HISTORY_ID = "11111111-1111-4111-8111-111111111113";
const SAVED_ID = "11111111-1111-4111-8111-111111111114";
const OWNER = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com" };

const mocks = vi.hoisted(() => ({
  getProductDetail: vi.fn(),
  listCatalogItems: vi.fn(),
  requireOwner: vi.fn(),
  archiveRecipeVersion: vi.fn(),
  activateRecipeVersion: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/inventory/application/inventory", () => ({
  createInventoryService: () => ({ listCatalogItems: mocks.listCatalogItems }),
}));
vi.mock("@/modules/products/application/products", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/products/application/products")>(),
  createProductService: () => mocks,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import ProductDetailPage from "./page";

function versionCard(versionCode: string) {
  return within(screen.getByRole("heading", { name: versionCode }).closest("article")!);
}

function renderProductData() {
  const version: RecipeVersion = {
    id: ACTIVE_ID, versionCode: "v1", baseYieldQuantity: "8", yieldUnit: "piece",
    laborMinutesPerBatch: 40, utilityCostSatangPerBatch: 1099, wasteAllowancePercent: "3.5",
    activeFrom: new Date("2026-11-16"), archivedAt: null, instructions: "อบสูตรปัจจุบัน",
    ingredients: [],
  };
  mocks.requireOwner.mockResolvedValue(OWNER);
  mocks.listCatalogItems.mockResolvedValue([]);
  mocks.getProductDetail.mockResolvedValue({
    id: PRODUCT_ID, ownerId: OWNER.id, name: "ขนม", sellingUnit: "piece", defaultUnitPriceSatang: 18000,
    activeRecipeVersionId: ACTIVE_ID, recipeId: "recipe-id", active: true, notes: null,
    versions: [version, {
      ...version, id: HISTORY_ID, versionCode: "v2", activeFrom: null, archivedAt: new Date("2026-11-17"),
      instructions: "อบสูตรเดิม 20 นาที", ingredients: [{
        id: "water-row", inventoryItemId: "water", inventoryItemName: "น้ำ", baseUnit: "ml",
        ingredientKind: "WATER", itemActive: true, quantityInBaseUnit: "250",
      }, {
        id: "ice-row", inventoryItemId: "ice", inventoryItemName: "น้ำแข็ง", baseUnit: "g",
        ingredientKind: "ICE", itemActive: true, quantityInBaseUnit: "100",
      }],
    }, { ...version, id: SAVED_ID, versionCode: "v3", activeFrom: null }],
  } satisfies ProductDetail);
}

describe("ProductDetailPage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("observes a catalog failure without waiting for the product query", async () => {
    mocks.requireOwner.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "owner@example.com",
    });
    let resolveProduct!: (product: ProductDetail) => void;
    mocks.getProductDetail.mockReturnValue(
      new Promise<ProductDetail>((resolve) => {
        resolveProduct = resolve;
      }),
    );
    const catalogError = new Error("Catalog unavailable");
    mocks.listCatalogItems.mockRejectedValue(catalogError);

    const renderResult = ProductDetailPage({
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    const observedResult = renderResult.then(
      () => "resolved" as const,
      (error: unknown) => error,
    );
    const firstOutcome = await Promise.race([
      observedResult,
      new Promise<"pending">((resolve) => {
        setTimeout(() => resolve("pending"), 0);
      }),
    ]);

    resolveProduct({} as ProductDetail);
    await observedResult;
    expect(firstOutcome).toBe(catalogError);
  });

  it("shows history without an activate control and preserves water and ice quantities in its ingredient list", async () => {
    renderProductData();
    render(await ProductDetailPage({ params: Promise.resolve({ id: PRODUCT_ID }) }));

    const current = versionCard("v1");
    expect(current.getByText("สูตรที่ใช้งานอยู่")).toBeVisible();
    expect(current.queryByRole("button", { name: /เก็บเข้าประวัติ/ })).not.toBeInTheDocument();
    const historical = versionCard("v2");
    expect(within(screen.getByRole("region", { name: "ประวัติสูตร" })).getByRole("heading", { name: "v2" })).toBeVisible();
    expect(historical.getByText("อบสูตรเดิม 20 นาที")).toBeVisible();
    expect(historical.getByText("ค่าเผื่อสูญเสีย 3.5%", { exact: false })).toBeVisible();
    const [water, ice] = historical.getAllByRole("listitem");
    expect(water).toHaveTextContent("250 ml");
    expect(water).toHaveTextContent("ไม่คิดต้นทุนและไม่ต้องนับสต๊อก");
    expect(ice).toHaveTextContent("100 g");
    expect(ice).toHaveTextContent("ไม่คิดต้นทุนและไม่ต้องนับสต๊อก");
    expect(historical.queryByRole("button", { name: /เปิดใช้/ })).not.toBeInTheDocument();
    expect(historical.queryByRole("button", { name: /เก็บเข้าประวัติ/ })).not.toBeInTheDocument();
    expect(historical.getByRole("link", { name: "ใช้สูตรนี้เป็นต้นแบบ" })).toHaveAttribute("href", `?template=${HISTORY_ID}#recipe-editor`);
    const saved = versionCard("v3");
    expect(saved.getByText("บันทึกแล้ว ยังไม่ได้ใช้งาน")).toBeVisible();
    expect(saved.getByRole("button", { name: "เปิดใช้เวอร์ชันนี้" })).toBeVisible();
  });

  it("opens just one prefilled editor when a template is selected on the product page", async () => {
    renderProductData();
    render(await ProductDetailPage({
      params: Promise.resolve({ id: PRODUCT_ID }),
      searchParams: Promise.resolve({ template: HISTORY_ID }),
    }));

    expect(screen.getAllByLabelText("รหัสเวอร์ชัน")).toHaveLength(1);
    expect(screen.getByLabelText("รหัสเวอร์ชัน")).toHaveValue("");
    expect(screen.getByLabelText("วิธีทำ")).toHaveValue("อบสูตรเดิม 20 นาที");
  });

  it("requires explicit archive confirmation and renders the server's newly-current rejection", async () => {
    renderProductData();
    mocks.archiveRecipeVersion.mockRejectedValueOnce(new RecipeMaintenanceError("ACTIVE_VERSION"));
    const user = userEvent.setup();
    render(await ProductDetailPage({ params: Promise.resolve({ id: PRODUCT_ID }) }));
    const saved = versionCard("v3");
    await user.click(saved.getByRole("button", { name: "เก็บเข้าประวัติ" }));
    expect(mocks.archiveRecipeVersion).not.toHaveBeenCalled();
    await user.click(saved.getByRole("button", { name: "ยืนยันเก็บเข้าประวัติ" }));
    expect(await saved.findByRole("alert")).toHaveTextContent("สลับไปใช้สูตรอื่นก่อน");
    expect(mocks.archiveRecipeVersion).toHaveBeenCalledWith(OWNER.id, PRODUCT_ID, SAVED_ID);
  });

  it("shows server feedback after submitting activation for a newly archived recipe", async () => {
    renderProductData();
    mocks.activateRecipeVersion.mockRejectedValueOnce(new RecipeMaintenanceError("ARCHIVED_VERSION"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(await ProductDetailPage({ params: Promise.resolve({ id: PRODUCT_ID }) }));
      const saved = versionCard("v3");
      await userEvent.click(saved.getByRole("button", { name: "เปิดใช้เวอร์ชันนี้" }));
      expect(await saved.findByRole("alert")).toHaveTextContent("ใช้สูตรนี้เป็นต้นแบบ");
    } finally {
      confirm.mockRestore();
    }
  });
});
