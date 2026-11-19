import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createInventoryService } from "@/modules/inventory/application/inventory";
import { createProductService } from "@/modules/products/application/products";
import type { ProductActionState } from "./actions";

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const database = vi.hoisted(() => ({ context: null as Awaited<ReturnType<typeof createTestDatabase>> | null }));
const next = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: auth.requireOwner }));
vi.mock("@/lib/db/client", () => ({ get db() { return database.context!.db; } }));
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));

import { archiveRecipeVersionAction, createProductAction, createRecipeVersionAction } from "./actions";

const INITIAL: ProductActionState = { error: null, saved: false };

function productForm(): FormData {
  const data = new FormData();
  data.set("name", "ขนมใหม่");
  data.set("sellingUnit", "piece");
  data.set("defaultUnitPriceBaht", "180");
  data.set("notes", "");
  return data;
}

describe("product actions", () => {
  beforeAll(async () => { database.context = await createTestDatabase(); });
  afterAll(async () => { await database.context?.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
  });

  it("invalidates active product options used by the production template form", async () => {
    await expect(createProductAction(INITIAL, productForm())).resolves.toEqual({
      error: null,
      saved: true,
    });
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/products"],
      ["/production/templates/new"],
      ["/dashboard"],
    ]);
  });

  it("requires both expected ingredient identity fields and does not save for a missing owner", async () => {
    const service = createProductService(database.context!.db);
    const product = await service.createProduct(OWNER_ID, {
      name: "ขนมสูตรใหม่", sellingUnit: "piece", defaultUnitPriceSatang: 18000,
    });
    const water = await createInventoryService(database.context!.db).createItem(OWNER_ID, {
      name: "น้ำสำหรับสูตรใหม่", category: "INGREDIENT", baseUnit: "ml", ingredientKind: "WATER",
    });
    const data = new FormData();
    for (const [key, value] of Object.entries({
      productId: product.id, versionCode: "v1", baseYieldQuantity: "1", yieldUnit: "piece",
      laborMinutesPerBatch: "0", utilityCostBahtPerBatch: "0", ingredientCount: "1",
      ingredientId_0: water.id, ingredientQuantity_0: "250", ingredientBaseUnit_0: "ml",
      ingredientKind_0: "WATER", ownerId: OTHER_OWNER_ID,
    })) data.set(key, value);

    for (const [field, value] of [["ingredientKind_0", "WATER"], ["ingredientBaseUnit_0", "ml"]] as const) {
      data.delete(field);
      await expect(createRecipeVersionAction(INITIAL, data)).resolves.toMatchObject({
        error: expect.stringContaining("โหลดหน้าใหม่"), saved: false,
      });
      data.set(field, value);
    }
    auth.requireOwner.mockRejectedValueOnce(new Error("No owner session"));
    await expect(createRecipeVersionAction(INITIAL, data)).rejects.toThrow("No owner session");
    expect((await service.getProductDetail(OWNER_ID, product.id)).versions).toEqual([]);
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not archive a recipe using the wrong product or another owner", async () => {
    const service = createProductService(database.context!.db);
    const first = await service.createProduct(OWNER_ID, {
      name: "ขนมชิ้นแรก", sellingUnit: "piece", defaultUnitPriceSatang: 18000,
    });
    const second = await service.createProduct(OWNER_ID, {
      name: "ขนมชิ้นที่สอง", sellingUnit: "piece", defaultUnitPriceSatang: 18000,
    });
    const water = await createInventoryService(database.context!.db).createItem(OWNER_ID, {
      name: "น้ำสำหรับสูตรเก่า", category: "INGREDIENT", baseUnit: "ml", ingredientKind: "WATER",
    });
    const version = await service.createRecipeVersion(OWNER_ID, first.id, {
      versionCode: "v1", baseYieldQuantity: "1", yieldUnit: "piece", laborMinutesPerBatch: 0,
      utilityCostSatangPerBatch: 0, wasteAllowancePercent: null, instructions: "",
      ingredients: [{ inventoryItemId: water.id, quantityInBaseUnit: "250" }],
    });
    const data = new FormData();
    data.set("productId", second.id);
    data.set("versionId", version.id);
    data.set("ownerId", OWNER_ID);

    expect(archiveRecipeVersionAction).toBeTypeOf("function");
    await expect(archiveRecipeVersionAction(INITIAL, data)).resolves.toMatchObject({
      error: expect.stringContaining("ไม่พบสูตร"), saved: false,
    });
    data.set("productId", first.id);
    auth.requireOwner.mockResolvedValueOnce({ id: OTHER_OWNER_ID, email: "other@example.com" });
    await expect(archiveRecipeVersionAction(INITIAL, data)).resolves.toMatchObject({
      error: expect.stringContaining("ไม่พบสูตร"), saved: false,
    });
    expect((await service.getProductDetail(OWNER_ID, first.id)).versions[0]?.archivedAt).toBeNull();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });
});
