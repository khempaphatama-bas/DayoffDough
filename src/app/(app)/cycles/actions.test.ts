import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import type { CycleActionState } from "./actions";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const cycles = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  changeStatus: vi.fn(),
}));
const next = vi.hoisted(() => ({
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: auth.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/cycles/application/cycles", () => ({
  createCycleService: () => cycles,
}));
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: next.redirect }));

import {
  changeCycleStatusAction,
  createCycleAction,
  updateCycleAction,
} from "./actions";

const INITIAL_STATE: CycleActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
};

function cycleForm(overrides: Readonly<Record<string, string>> = {}): FormData {
  const formData = new FormData();
  const fields = {
    name: "รอบส่ง 30 ส.ค.",
    orderCutoffAt: "2026-08-27T12:00",
    targetProductionDate: "2026-08-29",
    primaryDeliveryDate: "2026-08-30",
    notes: "",
    status: "OPEN",
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

describe("cycle actions", () => {
  beforeEach(() => {
    auth.requireOwner.mockReset();
    cycles.create.mockReset();
    cycles.update.mockReset();
    cycles.changeStatus.mockReset();
    next.redirect.mockReset();
    next.revalidatePath.mockReset();
    auth.requireOwner.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@example.com",
    });
  });

  it("authenticates, parses Bangkok time, and redirects after create succeeds", async () => {
    cycles.create.mockResolvedValue({ id: CYCLE_ID });
    next.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });

    await expect(createCycleAction(INITIAL_STATE, cycleForm())).rejects.toThrow(
      `NEXT_REDIRECT:/cycles/${CYCLE_ID}`,
    );
    expect(cycles.create).toHaveBeenCalledWith(OWNER_ID, {
      name: "รอบส่ง 30 ส.ค.",
      orderCutoffAt: new Date("2026-08-27T05:00:00.000Z"),
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
      notes: "",
      status: "OPEN",
    });
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/cycles"],
      ["/dashboard"],
    ]);
    expect(auth.requireOwner).toHaveBeenCalledOnce();
  });

  it("authenticates before validating direct create submissions", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      createCycleAction(INITIAL_STATE, new FormData()),
    ).rejects.toThrow("Unauthorized");
    expect(cycles.create).not.toHaveBeenCalled();
  });

  it("rejects timezone-bearing cutoff values before Bangkok parsing", async () => {
    const result = await createCycleAction(
      INITIAL_STATE,
      cycleForm({ orderCutoffAt: "2026-08-27T12:00Z" }),
    );

    expect(result).toEqual({
      error: "กรุณาตรวจสอบข้อมูลรอบอบ",
      fieldErrors: {
        orderCutoffAt: ["วันปิดรับออเดอร์ไม่ถูกต้อง"],
      },
      saved: false,
    });
    expect(cycles.create).not.toHaveBeenCalled();
  });

  it("updates metadata without accepting status from the edit form", async () => {
    cycles.update.mockResolvedValue({ id: CYCLE_ID });

    const result = await updateCycleAction(
      INITIAL_STATE,
      cycleForm({ cycleId: CYCLE_ID, status: "CANCELLED" }),
    );

    expect(result).toEqual({ error: null, fieldErrors: {}, saved: true });
    expect(cycles.update).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID, {
      name: "รอบส่ง 30 ส.ค.",
      orderCutoffAt: new Date("2026-08-27T05:00:00.000Z"),
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
      notes: "",
    });
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/cycles"],
      [`/cycles/${CYCLE_ID}`],
      ["/dashboard"],
    ]);
    expect(auth.requireOwner).toHaveBeenCalledOnce();
  });

  it("owner-scopes Phase 2 status changes and rejects LOCKED submissions", async () => {
    const valid = new FormData();
    valid.set("cycleId", CYCLE_ID);
    valid.set("status", "IN_PRODUCTION");

    await changeCycleStatusAction(valid);

    expect(cycles.changeStatus).toHaveBeenCalledWith(
      OWNER_ID,
      CYCLE_ID,
      "IN_PRODUCTION",
    );
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/cycles"],
      [`/cycles/${CYCLE_ID}`],
      ["/dashboard"],
    ]);
    expect(auth.requireOwner).toHaveBeenCalledOnce();

    cycles.changeStatus.mockClear();
    cycles.changeStatus.mockRejectedValueOnce(
      new Error("Cycle locking belongs to Phase 3"),
    );
    const locked = new FormData();
    locked.set("cycleId", CYCLE_ID);
    locked.set("status", "LOCKED");
    await expect(changeCycleStatusAction(locked)).rejects.toThrow(
      "Cycle locking belongs to Phase 3",
    );
    expect(cycles.changeStatus).toHaveBeenCalledWith(
      OWNER_ID,
      CYCLE_ID,
      "LOCKED",
    );
  });
});
