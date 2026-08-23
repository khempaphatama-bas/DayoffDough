import { describe, expect, it } from "vitest";
import { lockCycleInputSchema, unlockCycleInputSchema } from "./lock-form";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

function lockInput(selectedBatchCount = "1.5", reason = "ตั้งใจลด") {
  return {
    cycleId: CYCLE_ID,
    inputFingerprint: "a".repeat(64),
    lockRequestId: REQUEST_ID,
    overrides: [{ productId: PRODUCT_ID, selectedBatchCount, reason }],
  };
}

describe("planning lock form schemas", () => {
  it("accepts the canonical lock and unlock payloads and trims reasons", () => {
    const lock = lockCycleInputSchema.safeParse(lockInput("1.5", "  ตั้งใจลด  "));
    const unlock = unlockCycleInputSchema.safeParse({
      cycleId: CYCLE_ID,
      reason: "  เพิ่มออเดอร์ด่วน  ",
      confirmation: "ปลดล็อก",
    });

    expect(lock.success).toBe(true);
    if (lock.success) expect(lock.data.overrides[0]?.reason).toBe("ตั้งใจลด");
    expect(unlock.success).toBe(true);
    if (unlock.success) expect(unlock.data.reason).toBe("เพิ่มออเดอร์ด่วน");
  });

  it.each(["not-a-uuid", "", "11111111-1111-4111-7111-111111111111"])(
    "rejects an invalid UUID id %s",
    (cycleId) => {
      expect(lockCycleInputSchema.safeParse({ ...lockInput(), cycleId }).success).toBe(false);
    },
  );

  it.each([
    ["lock request", (invalidId: string) => ({ ...lockInput(), lockRequestId: invalidId })],
    [
      "override product",
      (invalidId: string) => ({
        ...lockInput(),
        overrides: [{ ...lockInput().overrides[0]!, productId: invalidId }],
      }),
    ],
  ] as const)("rejects an invalid %s UUID", (_case, makeInvalidInput) => {
    expect(
      lockCycleInputSchema.safeParse(makeInvalidInput("not-a-uuid")).success,
    ).toBe(false);
  });

  it("rejects an invalid unlock cycle UUID", () => {
    expect(
      unlockCycleInputSchema.safeParse({
        cycleId: "not-a-uuid",
        reason: "เพิ่มออเดอร์ด่วน",
        confirmation: "ปลดล็อก",
      }).success,
    ).toBe(false);
  });

  it.each([
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    `${"a".repeat(63)} `,
  ])("rejects a non-canonical fingerprint", (inputFingerprint) => {
    expect(lockCycleInputSchema.safeParse({ ...lockInput(), inputFingerprint }).success).toBe(false);
  });

  it.each(["1", "1.5", "0.000001", "1.000000", "0001.250000"])(
    "accepts positive selected count %s with at most six decimal places",
    (selectedBatchCount) => {
      expect(lockCycleInputSchema.safeParse(lockInput(selectedBatchCount)).success).toBe(true);
    },
  );

  it.each(["0", "0.000000", "-1", "+1", "1.0000001", "1.", ".", "1e2", " Infinity "])(
    "rejects invalid selected count %s",
    (selectedBatchCount) => {
      expect(lockCycleInputSchema.safeParse(lockInput(selectedBatchCount)).success).toBe(false);
    },
  );

  it("enforces trimmed reasons from one through 2,000 characters", () => {
    expect(lockCycleInputSchema.safeParse(lockInput("1", " ")).success).toBe(false);
    expect(lockCycleInputSchema.safeParse(lockInput("1", "x".repeat(2_000))).success).toBe(true);
    expect(lockCycleInputSchema.safeParse(lockInput("1", ` ${"x".repeat(2_000)} `)).success).toBe(true);
    expect(lockCycleInputSchema.safeParse(lockInput("1", "x".repeat(2_001))).success).toBe(false);
    expect(unlockCycleInputSchema.safeParse({ cycleId: CYCLE_ID, reason: " ", confirmation: "ปลดล็อก" }).success).toBe(false);
    expect(unlockCycleInputSchema.safeParse({ cycleId: CYCLE_ID, reason: "x".repeat(2_001), confirmation: "ปลดล็อก" }).success).toBe(false);
  });

  it.each(["unlock", " ปลดล็อก", "ปลดล็อก ", "ปลดล๊อก", ""])(
    "requires the exact unlock confirmation %s",
    (confirmation) => {
      expect(unlockCycleInputSchema.safeParse({ cycleId: CYCLE_ID, reason: "เพิ่มออเดอร์ด่วน", confirmation }).success).toBe(false);
    },
  );
});
