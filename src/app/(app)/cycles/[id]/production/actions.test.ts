import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import type { ProductionActionState } from "./actions";

const CYCLE_ID = "72000000-0000-4000-8000-000000000001";
const GENERATION_ID = "72000000-0000-4000-8000-000000000002";
const TASK_ID = "72000000-0000-4000-8000-000000000003";
const REQUEST_ID = "72000000-0000-4000-8000-000000000004";

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const service = vi.hoisted(() => ({ updateTask: vi.fn(), createManualTask: vi.fn(), softDeleteManualTask: vi.fn() }));
const next = vi.hoisted(() => ({ revalidatePath: vi.fn(), redirect: vi.fn() }));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: auth.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/production/application/production-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/production/application/production-commands")>()),
  createProductionCommandService: () => service,
}));
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: next.redirect }));

import { ProductionStateError } from "@/modules/production/application/production-commands";
import { createManualCycleTaskAction, deleteManualCycleTaskAction, updateCycleTaskAction } from "./actions";

const INITIAL: ProductionActionState = {
  error: null,
  fieldErrors: {},
  values: {},
  saved: false,
};

function payloadForm(payload: unknown, values: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

function validPayload() {
  return {
    cycleId: CYCLE_ID,
    taskGenerationId: GENERATION_ID,
    taskId: TASK_ID,
    title: "เตรียมแป้ง",
    productId: null,
    batchCount: null,
    scheduledAt: "2026-09-12T01:00:00.000Z",
    estimatedDurationMinutes: 30,
    notes: null,
    sequence: 1,
    status: "PENDING",
    skipReason: null,
  };
}

describe("production task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    next.redirect.mockImplementation((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
  });

  it("authenticates before parsing or calling the command service", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(updateCycleTaskAction(INITIAL, new FormData())).rejects.toThrow("Unauthorized");
    expect(service.updateTask).not.toHaveBeenCalled();
  });

  it("derives owner from the verified session, preserves values on validation, and never forwards a submitted owner", async () => {
    const values = { title: "งานที่กรอกไว้", ownerId: "99999999-9999-4999-8999-999999999999" };
    const result = await updateCycleTaskAction(INITIAL, payloadForm({ ...validPayload(), title: "" }, values));
    expect(result).toMatchObject({ error: "กรุณาตรวจสอบข้อมูลงาน", saved: false, values });
    expect(result.fieldErrors.title).toBeTruthy();
    expect(service.updateTask).not.toHaveBeenCalled();
    expect(JSON.stringify(service.updateTask.mock.calls)).not.toContain("99999999");
  });

  it("updates a task, revalidates cycle production views, and returns a serializable saved state", async () => {
    service.updateTask.mockResolvedValue({ id: TASK_ID });
    const result = await updateCycleTaskAction(INITIAL, payloadForm(validPayload()));
    expect(result).toMatchObject({ error: null, fieldErrors: {}, saved: true });
    expect(service.updateTask).toHaveBeenCalledWith(OWNER_ID, expect.objectContaining({ taskId: TASK_ID, scheduledAt: new Date("2026-09-12T01:00:00.000Z") }));
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/cycles/72000000-0000-4000-8000-000000000001"],
      ["/cycles/72000000-0000-4000-8000-000000000001/planning"],
      ["/cycles/72000000-0000-4000-8000-000000000001/production"],
      ["/cycles/72000000-0000-4000-8000-000000000001/operations"],
      ["/cycles"],
      ["/dashboard"],
    ]);
  });

  it("translates a superseded generation into the exact safe Thai message", async () => {
    service.updateTask.mockRejectedValueOnce(new ProductionStateError("task generation is read-only"));
    await expect(updateCycleTaskAction(INITIAL, payloadForm(validPayload()))).resolves.toMatchObject({
      error: "แผนงานชุดนี้ถูกแทนที่แล้ว กรุณาเปิดรุ่นปัจจุบัน",
      fieldErrors: {},
      saved: false,
    });
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a manual task from a parsed payload and revalidates before returning", async () => {
    service.createManualTask.mockResolvedValue({ id: TASK_ID });
    const payload = Object.fromEntries(Object.entries({ ...validPayload(), creationRequestId: REQUEST_ID }).filter(([key]) => key !== "taskId"));
    const result = await createManualCycleTaskAction(INITIAL, payloadForm(payload));
    expect(result).toMatchObject({ error: null, saved: true });
    expect(service.createManualTask).toHaveBeenCalledWith(OWNER_ID, expect.objectContaining({ creationRequestId: REQUEST_ID }));
    expect(next.revalidatePath).toHaveBeenCalledTimes(6);
  });

  it("returns safe delete errors and does not leak raw database details", async () => {
    service.softDeleteManualTask.mockRejectedValueOnce(new ProductionStateError("cycle task hard delete is not allowed; SELECT secret"));
    const result = await deleteManualCycleTaskAction(payloadForm({ cycleId: CYCLE_ID, taskGenerationId: GENERATION_ID, taskId: TASK_ID }));
    expect(result).toMatchObject({ error: "ลบงานนี้ไม่ได้ กรุณาตรวจสอบสถานะงาน", saved: false });
    expect(JSON.stringify(result)).not.toContain("SELECT");
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["direct form", "useActionState"] as const)("deletes an owned manual task through the %s signature and refreshes Operations", async (signature) => {
    service.softDeleteManualTask.mockResolvedValueOnce({ id: TASK_ID });
    const form = payloadForm({ cycleId: CYCLE_ID, taskGenerationId: GENERATION_ID, taskId: TASK_ID });
    const result = signature === "direct form"
      ? await deleteManualCycleTaskAction(form)
      : await deleteManualCycleTaskAction(INITIAL, form);
    expect(result).toMatchObject({ error: null, fieldErrors: {}, saved: true });
    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(service.softDeleteManualTask).toHaveBeenCalledWith(OWNER_ID, {
      cycleId: CYCLE_ID, taskGenerationId: GENERATION_ID, taskId: TASK_ID,
    });
    expect(next.revalidatePath.mock.calls).toEqual([
      [`/cycles/${CYCLE_ID}`], [`/cycles/${CYCLE_ID}/planning`],
      [`/cycles/${CYCLE_ID}/production`], [`/cycles/${CYCLE_ID}/operations`],
      ["/cycles"], ["/dashboard"],
    ]);
  });

  it("logs unexpected failures with identifiers only and returns a safe error", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    service.createManualTask.mockRejectedValueOnce(new Error("postgres://secret raw SQL"));
    const manualPayload = Object.fromEntries(Object.entries({ ...validPayload(), creationRequestId: REQUEST_ID }).filter(([key]) => key !== "taskId"));
    const result = await createManualCycleTaskAction(INITIAL, payloadForm(manualPayload));
    expect(result.error).toBe("ระบบบันทึกงานไม่สำเร็จ กรุณาลองอีกครั้ง");
    expect(JSON.stringify(result)).not.toContain("postgres");
    expect(logger).toHaveBeenCalledWith("production_task_action_failed", expect.objectContaining({ operation: "create", ownerId: OWNER_ID, cycleId: CYCLE_ID }));
  });
});
