import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductActionState } from "./actions";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const service = vi.hoisted(() => ({ createProduct: vi.fn() }));
const next = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: auth.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/products/application/products", () => ({
  createProductService: () => service,
}));
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));

import { createProductAction } from "./actions";

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
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    service.createProduct.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
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
});
