import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import type { PlanningActionState, UnlockActionState } from "./actions";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const LOCK_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const FINGERPRINT = "a".repeat(64);

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const commands = vi.hoisted(() => ({ lock: vi.fn(), unlock: vi.fn() }));
const next = vi.hoisted(() => ({
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: auth.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/planning/application/planning-commands", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/planning/application/planning-commands")
  >();
  return {
    ...actual,
    createPlanningCommandService: () => commands,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: next.redirect }));

import {
  PlanningBlockedError,
  PlanningStaleError,
  PlanningStateError,
} from "@/modules/planning/application/planning-commands";
import { lockCycleAction, unlockCycleAction } from "./actions";

const INITIAL_STATE: PlanningActionState = {
  error: null,
  fieldErrors: {},
  stale: false,
};
const INITIAL_UNLOCK_STATE: UnlockActionState = {
  error: null,
  saved: false,
};

function lockForm(payload: unknown): FormData {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  return formData;
}

describe("planning actions", () => {
  beforeEach(() => {
    auth.requireOwner.mockReset();
    commands.lock.mockReset();
    commands.unlock.mockReset();
    next.redirect.mockReset();
    next.revalidatePath.mockReset();
    auth.requireOwner.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@example.com",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("authenticates, locks the exact parsed payload, revalidates affected views, and redirects", async () => {
    const payload = {
      cycleId: CYCLE_ID,
      inputFingerprint: FINGERPRINT,
      lockRequestId: LOCK_REQUEST_ID,
      overrides: [
        {
          productId: PRODUCT_ID,
          selectedBatchCount: "1.5",
          reason: "ลดของเหลือ",
        },
      ],
    };
    commands.lock.mockResolvedValue({ id: "snapshot-id" });
    next.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });

    await expect(
      lockCycleAction(INITIAL_STATE, lockForm(payload)),
    ).rejects.toThrow(`NEXT_REDIRECT:/cycles/${CYCLE_ID}/planning`);
    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(commands.lock).toHaveBeenCalledWith(OWNER_ID, payload);
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/cycles"],
      [`/cycles/${CYCLE_ID}`],
      [`/cycles/${CYCLE_ID}/planning`],
      [`/cycles/${CYCLE_ID}/production`],
      ["/orders"],
      ["/dashboard"],
    ]);
  });

  it("authenticates before parsing a malformed direct lock submission", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    const malformed = new FormData();
    malformed.set("payload", "{not-json");

    await expect(lockCycleAction(INITIAL_STATE, malformed)).rejects.toThrow(
      "Unauthorized",
    );
    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(commands.lock).not.toHaveBeenCalled();
  });

  it("returns adjacent batch and reason errors without mutating invalid overrides", async () => {
    const result = await lockCycleAction(
      INITIAL_STATE,
      lockForm({
        cycleId: CYCLE_ID,
        inputFingerprint: FINGERPRINT,
        lockRequestId: LOCK_REQUEST_ID,
        overrides: [
          {
            productId: PRODUCT_ID,
            selectedBatchCount: "0.1234567",
            reason: "   ",
          },
        ],
      }),
    );

    expect(result).toEqual({
      error: "กรุณาตรวจสอบข้อมูลแผนการผลิต",
      fieldErrors: {
        [`selectedBatchCount.${PRODUCT_ID}`]:
          "จำนวนแบตช์ต้องเป็นเลขบวก ทศนิยมไม่เกิน 6 ตำแหน่ง",
        [`reason.${PRODUCT_ID}`]: "กรุณากรอกเหตุผลที่ปรับจำนวนแบตช์",
      },
      stale: false,
    });
    expect(commands.lock).not.toHaveBeenCalled();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "stale previews",
      failure: new PlanningStaleError(),
      expected: {
        error: "ข้อมูลรอบเปลี่ยนแล้ว กรุณาตรวจสอบแผนอีกครั้ง",
        fieldErrors: {},
        stale: true,
      },
    },
    {
      name: "blocking issues",
      failure: new PlanningBlockedError([]),
      expected: {
        error: "ยังล็อกรอบไม่ได้ กรุณาแก้รายการที่ระบบแจ้ง",
        fieldErrors: {},
        stale: false,
      },
    },
    {
      name: "state races",
      failure: new PlanningStateError("Cycle changed while locking"),
      expected: {
        error: "ล็อกรอบไม่สำเร็จ กรุณาเปิดแผนล่าสุดแล้วลองอีกครั้ง",
        fieldErrors: {},
        stale: false,
      },
    },
  ])("maps $name to its narrow serializable lock state", async ({ failure, expected }) => {
    commands.lock.mockRejectedValueOnce(failure);

    const result = await lockCycleAction(
      INITIAL_STATE,
      lockForm({
        cycleId: CYCLE_ID,
        inputFingerprint: FINGERPRINT,
        lockRequestId: LOCK_REQUEST_ID,
        overrides: [],
      }),
    );

    expect(result).toEqual(expected);
    expect(next.redirect).not.toHaveBeenCalled();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it("logs only safe identifiers for an unexpected lock failure", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    commands.lock.mockRejectedValueOnce(
      new Error("postgres://secret@host raw SQL note ลดของเหลือ"),
    );

    const result = await lockCycleAction(
      INITIAL_STATE,
      lockForm({
        cycleId: CYCLE_ID,
        inputFingerprint: FINGERPRINT,
        lockRequestId: LOCK_REQUEST_ID,
        overrides: [
          {
            productId: PRODUCT_ID,
            selectedBatchCount: "1.5",
            reason: "ลดของเหลือ",
          },
        ],
      }),
    );

    expect(result).toEqual({
      error: "ระบบบันทึกแผนไม่สำเร็จ กรุณาลองอีกครั้ง",
      fieldErrors: {},
      stale: false,
    });
    expect(logger).toHaveBeenCalledWith("planning_action_failed", {
      operation: "lock",
      ownerId: OWNER_ID,
      cycleId: CYCLE_ID,
      lockRequestId: LOCK_REQUEST_ID,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("ลดของเหลือ");
  });

  it("authenticates and validates unlock before mutation", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    const invalid = new FormData();
    invalid.set("cycleId", "not-a-uuid");
    invalid.set("reason", "");
    invalid.set("confirmation", "wrong");

    await expect(
      unlockCycleAction(INITIAL_UNLOCK_STATE, invalid),
    ).rejects.toThrow("Unauthorized");
    expect(commands.unlock).not.toHaveBeenCalled();
  });

  it("rejects weak unlock confirmation and blank reason without mutation", async () => {
    const invalid = new FormData();
    invalid.set("cycleId", CYCLE_ID);
    invalid.set("reason", "   ");
    invalid.set("confirmation", "unlock");

    await expect(
      unlockCycleAction(INITIAL_UNLOCK_STATE, invalid),
    ).resolves.toEqual({
      error: "กรุณากรอกเหตุผลและพิมพ์คำว่า ปลดล็อก",
      saved: false,
    });
    expect(commands.unlock).not.toHaveBeenCalled();
  });

  it("unlocks with the verified owner and revalidates every affected view", async () => {
    commands.unlock.mockResolvedValue({ id: "snapshot-id" });
    const valid = new FormData();
    valid.set("cycleId", CYCLE_ID);
    valid.set("reason", " เพิ่มออเดอร์ด่วน ");
    valid.set("confirmation", "ปลดล็อก");

    const result = await unlockCycleAction(INITIAL_UNLOCK_STATE, valid);

    expect(result).toEqual({ error: null, saved: true });
    expect(commands.unlock).toHaveBeenCalledWith(OWNER_ID, {
      cycleId: CYCLE_ID,
      reason: "เพิ่มออเดอร์ด่วน",
      confirmation: "ปลดล็อก",
    });
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/cycles"],
      [`/cycles/${CYCLE_ID}`],
      [`/cycles/${CYCLE_ID}/planning`],
      [`/cycles/${CYCLE_ID}/production`],
      ["/orders"],
      ["/dashboard"],
    ]);
  });

  it("maps an ineligible unlock without leaking command details", async () => {
    commands.unlock.mockRejectedValueOnce(
      new PlanningStateError("Cycle cannot be unlocked"),
    );
    const valid = new FormData();
    valid.set("cycleId", CYCLE_ID);
    valid.set("reason", "เพิ่มออเดอร์ด่วน");
    valid.set("confirmation", "ปลดล็อก");

    await expect(
      unlockCycleAction(INITIAL_UNLOCK_STATE, valid),
    ).resolves.toEqual({ error: "ปลดล็อกรอบนี้ไม่ได้", saved: false });
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it("logs only safe identifiers for an unexpected unlock failure", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    commands.unlock.mockRejectedValueOnce(new Error("raw SQL secret reason"));
    const valid = new FormData();
    valid.set("cycleId", CYCLE_ID);
    valid.set("reason", "ข้อมูลลับ");
    valid.set("confirmation", "ปลดล็อก");

    await expect(
      unlockCycleAction(INITIAL_UNLOCK_STATE, valid),
    ).resolves.toEqual({
      error: "ระบบปลดล็อกรอบไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    });
    expect(logger).toHaveBeenCalledWith("planning_action_failed", {
      operation: "unlock",
      ownerId: OWNER_ID,
      cycleId: CYCLE_ID,
      lockRequestId: null,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("ข้อมูลลับ");
  });
});
