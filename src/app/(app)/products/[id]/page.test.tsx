import { describe, expect, it, vi } from "vitest";
import type { ProductDetail } from "@/modules/products/application/products";

const mocks = vi.hoisted(() => ({
  getProductDetail: vi.fn(),
  listCatalogItems: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/inventory/application/inventory", () => ({
  createInventoryService: () => ({ listCatalogItems: mocks.listCatalogItems }),
}));
vi.mock("@/modules/products/application/products", () => ({
  createProductService: () => ({ getProductDetail: mocks.getProductDetail }),
}));

import ProductDetailPage from "./page";

describe("ProductDetailPage", () => {
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
});
