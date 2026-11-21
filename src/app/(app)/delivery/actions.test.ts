import { beforeEach, expect, it, vi } from "vitest";
import { InventoryMaintenanceError } from "@/modules/inventory/application/inventory";
import { createPackagingRuleAction } from "./actions";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), write: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.owner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/delivery/application/delivery", () => ({ createDeliveryService: () => ({ createPackagingRule: mocks.write }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

const blank = { error: null, saved: false };
const rule = { scope: "PRODUCT", productId: "10000000-0000-4000-8000-000000000001",
  inventoryItemId: "10000000-0000-4000-8000-000000000002", consumptionBasis: "PER_PRODUCT_UNIT", quantityInBaseUnit: "50" };
function submit(extra: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...rule, ...extra })) data.set(key, value);
  return createPackagingRuleAction(blank, data);
}
beforeEach(() => { vi.resetAllMocks(); mocks.owner.mockResolvedValue({ id: "owner" }); });

it.each([{}, { expectedBaseUnit: "bogus" }] as Record<string, string>[])("refuses a missing or invalid displayed unit without writing", async extra => {
  expect(await submit(extra)).toMatchObject({ saved: false, error: expect.any(String) });
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("requires the owner even for an invalid form", async () => {
  mocks.owner.mockRejectedValue(new Error("login"));
  await expect(submit({})).rejects.toThrow("login");
  expect(mocks.write).not.toHaveBeenCalled();
});

it("passes the owner's displayed unit and gives recoverable guidance on a stale rule", async () => {
  mocks.write.mockRejectedValueOnce(new InventoryMaintenanceError("ITEM_CHANGED"));
  expect(await submit({ expectedBaseUnit: "g" })).toMatchObject({ saved: false, error: expect.stringMatching(/โหลดหน้าใหม่.*ตรวจสอบจำนวน/) });
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith("owner", { ...rule, expectedBaseUnit: "g", deliveryMethodId: null, notes: "" });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
