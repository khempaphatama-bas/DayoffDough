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

  it("rejects another owner's delivery method as a customer default", async () => {
    const method = await createDeliveryService(context.db).createMethod(OWNER_ID, {
      name: "Owner delivery",
      defaultCustomerFeeSatang: 5000,
      defaultInternalCostSatang: 4000,
      requiresDeliveryLocation: true,
    });

    await expect(
      service.create(OTHER_OWNER_ID, {
        name: "Cross-owner customer",
        defaultDeliveryMethodId: method.id,
      }),
    ).rejects.toThrow("Delivery method not found");
  });

  it("searches contact handles and phone text case-insensitively", async () => {
    const handleCustomer = await service.create(OWNER_ID, {
      name: "Handle customer",
      contactHandle: "@MayBakery",
      defaultDeliveryMethodId: null,
    });
    const phoneCustomer = await service.create(OWNER_ID, {
      name: "Phone customer",
      phone: "TEL-MAY-081",
      defaultDeliveryMethodId: null,
    });

    expect(await service.list(OWNER_ID, { query: "@maybakery" })).toEqual([
      expect.objectContaining({ id: handleCustomer.id }),
    ]);
    expect(await service.list(OWNER_ID, { query: "tel-may-081" })).toEqual([
      expect.objectContaining({ id: phoneCustomer.id }),
    ]);
  });

  it("orders active customers first and then by name", async () => {
    const alpha = await service.create(OWNER_ID, {
      name: "Alpha",
      defaultDeliveryMethodId: null,
    });
    const zulu = await service.create(OWNER_ID, {
      name: "Zulu",
      defaultDeliveryMethodId: null,
    });
    const inactive = await service.create(OWNER_ID, {
      name: "Aardvark inactive",
      defaultDeliveryMethodId: null,
    });
    await service.update(OWNER_ID, inactive.id, {
      name: inactive.name,
      defaultDeliveryMethodId: null,
      active: false,
    });

    expect((await service.list(OWNER_ID)).map((customer) => customer.id)).toEqual([
      alpha.id,
      zulu.id,
      inactive.id,
    ]);
  });

  it("does not allow another owner to update a customer", async () => {
    const customer = await service.create(OWNER_ID, {
      name: "Original name",
      defaultDeliveryMethodId: null,
    });

    await expect(
      service.update(OTHER_OWNER_ID, customer.id, {
        name: "Leaked update",
        defaultDeliveryMethodId: null,
        active: false,
      }),
    ).rejects.toThrow("Customer not found");
    await expect(service.get(OWNER_ID, customer.id)).resolves.toMatchObject({
      name: "Original name",
      active: true,
    });
  });
});
