import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import type { CustomerActionState } from "./actions";

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: auth.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  createCustomerAction,
  createQuickCustomerAction,
  updateCustomerAction,
} from "./actions";

const INITIAL_STATE: CustomerActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
};

function customerForm(overrides: Readonly<Record<string, string>> = {}): FormData {
  const formData = new FormData();
  const fields = {
    name: "คุณเมย์",
    contactHandle: "@may",
    phone: "0812345678",
    defaultDeliveryMethodId: "",
    defaultDeliveryLocation: "บางรัก กรุงเทพฯ",
    defaultDeliveryNote: "โทรก่อนส่ง",
    notes: "",
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

describe("customer actions", () => {
  beforeEach(() => {
    auth.requireOwner.mockReset();
    auth.requireOwner.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@example.com",
    });
  });

  it("returns serialized Thai field errors for malformed UUIDs", async () => {
    const result = await updateCustomerAction(
      INITIAL_STATE,
      customerForm({
        customerId: "not-a-uuid",
        defaultDeliveryMethodId: "also-not-a-uuid",
      }),
    );

    expect(result).toEqual({
      error: "กรุณาตรวจสอบข้อมูลลูกค้า",
      fieldErrors: {
        customerId: ["รหัสลูกค้าไม่ถูกต้อง"],
        defaultDeliveryMethodId: ["วิธีส่งประจำไม่ถูกต้อง"],
      },
      saved: false,
    });
    expect(auth.requireOwner).toHaveBeenCalledOnce();
  });

  it("returns serialized Thai field errors for overlong input", async () => {
    const result = await createCustomerAction(
      INITIAL_STATE,
      customerForm({
        contactHandle: "x".repeat(201),
        defaultDeliveryLocation: "ก".repeat(2001),
      }),
    );

    expect(result).toEqual({
      error: "กรุณาตรวจสอบข้อมูลลูกค้า",
      fieldErrors: {
        contactHandle: ["ช่องทางติดต่อต้องไม่เกิน 200 ตัวอักษร"],
        defaultDeliveryLocation: [
          "สถานที่จัดส่งประจำต้องไม่เกิน 2,000 ตัวอักษร",
        ],
      },
      saved: false,
    });
  });

  it("authenticates before parsing direct action submissions", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      createCustomerAction(INITIAL_STATE, new FormData()),
    ).rejects.toThrow("Unauthorized");
  });

  it("returns the exact quick-customer failure result for malformed input", async () => {
    await expect(
      createQuickCustomerAction({
        name: "คุณเมย์",
        defaultDeliveryMethodId: "not-a-uuid",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "กรุณาตรวจสอบข้อมูลลูกค้า",
    });
  });
});
