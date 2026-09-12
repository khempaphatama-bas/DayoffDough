import { describe, expect, it } from "vitest";
import {
  createManualTaskInputSchema,
  deleteManualTaskInputSchema,
  productionTemplateInputSchema,
  updateCycleTaskInputSchema,
} from "./forms";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const ACTIVITY_ID = "66666666-6666-4666-8666-666666666666";

function templateInput() {
  return {
    name: "  งานฟอคคาเซีย  ",
    scope: "PRODUCT" as const,
    productId: PRODUCT_ID,
    activities: [
      {
        id: ACTIVITY_ID,
        name: "  ผสมแป้ง  ",
        offsetDaysFromDelivery: -1,
        defaultTime: "22:30",
        estimatedDurationMinutes: 45,
        sequence: 1,
        notes: "  พักแป้งให้พอ  ",
        active: true,
      },
    ],
  };
}

function taskInput() {
  return {
    cycleId: CYCLE_ID,
    taskGenerationId: GENERATION_ID,
    taskId: TASK_ID,
    title: "  อบฟอคคาเซีย  ",
    productId: PRODUCT_ID,
    batchCount: "1.666667",
    scheduledAt: "2026-09-11T15:30:00.000Z",
    estimatedDurationMinutes: 45,
    notes: "  หมุนถาดครึ่งทาง  ",
    sequence: 2,
    status: "PENDING" as const,
    skipReason: null,
  };
}

describe("production template input schema", () => {
  it("normalizes a valid product template and its activity text", () => {
    const parsed = productionTemplateInputSchema.parse(templateInput());

    expect(parsed).toMatchObject({
      name: "งานฟอคคาเซีย",
      scope: "PRODUCT",
      productId: PRODUCT_ID,
      activities: [
        expect.objectContaining({
          name: "ผสมแป้ง",
          notes: "พักแป้งให้พอ",
        }),
      ],
    });
  });

  it.each([
    ["cycle template with a product", { scope: "CYCLE", productId: PRODUCT_ID }],
    ["product template without a product", { scope: "PRODUCT", productId: null }],
  ])("rejects a %s", (_case, change) => {
    expect(
      productionTemplateInputSchema.safeParse({ ...templateInput(), ...change })
        .success,
    ).toBe(false);
  });

  it.each([
    ["non-integer offset", { offsetDaysFromDelivery: -0.5 }],
    ["invalid local time", { defaultTime: "24:00" }],
    ["zero duration", { estimatedDurationMinutes: 0 }],
    ["zero sequence", { sequence: 0 }],
  ])("rejects an activity with %s", (_case, change) => {
    expect(
      productionTemplateInputSchema.safeParse({
        ...templateInput(),
        activities: [{ ...templateInput().activities[0], ...change }],
      }).success,
    ).toBe(false);
  });
});

describe("cycle task input schemas", () => {
  it("parses canonical task fields and normalizes non-skipped reasons to null", () => {
    const parsed = updateCycleTaskInputSchema.parse({
      ...taskInput(),
      skipReason: "  ไม่ใช้แล้ว  ",
    });

    expect(parsed).toMatchObject({
      taskId: TASK_ID,
      title: "อบฟอคคาเซีย",
      notes: "หมุนถาดครึ่งทาง",
      skipReason: null,
    });
    expect(parsed.scheduledAt.toISOString()).toBe("2026-09-11T15:30:00.000Z");
  });

  it("requires a reason only for skipped status", () => {
    expect(
      updateCycleTaskInputSchema.safeParse({
        ...taskInput(),
        status: "SKIPPED",
        skipReason: " ",
      }).success,
    ).toBe(false);
    expect(
      updateCycleTaskInputSchema.parse({
        ...taskInput(),
        status: "DONE",
        skipReason: " ",
      }).skipReason,
    ).toBeNull();
  });

  it.each([
    ["zero", "0"],
    ["more than six decimals", "1.0000001"],
    ["scientific notation", "1e2"],
    ["numeric input", 1],
  ])("rejects a %s batch count", (_case, batchCount) => {
    expect(
      updateCycleTaskInputSchema.safeParse({ ...taskInput(), batchCount })
        .success,
    ).toBe(false);
  });

  it.each([
    "2026-09-11T15:30:00Z",
    "2026-09-11T15:30:00.001+00:00",
    "2026-09-11T15:30:00.000+07:00",
    "2026-09-11T15:30:00.000Z ",
    "not-an-instant",
  ])("rejects a non-canonical scheduled instant %s", (scheduledAt) => {
    expect(
      updateCycleTaskInputSchema.safeParse({ ...taskInput(), scheduledAt }).success,
    ).toBe(false);
  });

  it("retains the manual request id while parsing a manual task", () => {
    const { taskId: _taskId, ...manualInput } = taskInput();
    const parsed = createManualTaskInputSchema.parse({
      ...manualInput,
      creationRequestId: REQUEST_ID,
      productId: null,
      batchCount: null,
    });

    expect(parsed).toMatchObject({
      cycleId: CYCLE_ID,
      taskGenerationId: GENERATION_ID,
      creationRequestId: REQUEST_ID,
      productId: null,
      batchCount: null,
    });
  });

  it("keeps the cycle, generation, and task UUIDs for manual deletion", () => {
    expect(
      deleteManualTaskInputSchema.parse({
        cycleId: CYCLE_ID,
        taskGenerationId: GENERATION_ID,
        taskId: TASK_ID,
      }),
    ).toEqual({
      cycleId: CYCLE_ID,
      taskGenerationId: GENERATION_ID,
      taskId: TASK_ID,
    });
  });
});
