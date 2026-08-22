import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createDeliveryService } from "@/modules/delivery/application/delivery";
import { createCustomerService } from "./customers";

describe("customer service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createCustomerService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createCustomerService(context.db);
  });

  afterEach(async () => context.close());

  it("creates, searches, updates, and owner-scopes customers", async () => {
    const delivery = createDeliveryService(context.db);
    const method = await delivery.createMethod(OWNER_ID, {
      name: "KEX Same Day",
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
      requiresDeliveryLocation: true,
    });
    const created = await service.create(OWNER_ID, {
      name: "คุณเมย์",
      contactHandle: "@may",
      phone: "0812345678",
      defaultDeliveryMethodId: method.id,
      defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
      defaultDeliveryNote: "โทรก่อนส่ง",
      notes: "",
    });

    expect(await service.list(OWNER_ID, { query: "เมย์", active: true })).toEqual([
      expect.objectContaining({ id: created.id, active: true }),
    ]);

    const updated = await service.update(OWNER_ID, created.id, {
      name: "คุณเมย์",
      contactHandle: "@may",
      phone: "0812345678",
      defaultDeliveryMethodId: method.id,
      defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
      defaultDeliveryNote: "โทรก่อนส่ง",
      notes: "",
      active: false,
    });
    expect(updated.active).toBe(false);
    await expect(service.get(OTHER_OWNER_ID, created.id)).rejects.toThrow(
      "Customer not found",
    );
  });
});
