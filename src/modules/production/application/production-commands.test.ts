import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "drizzle-orm/logger";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedLockedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import { cycleTaskGenerations, cycleTasks } from "@/modules/production/db/schema";
import { createProductionCommandService, ProductionStateError, ProductionValidationError } from "./production-commands";

const OTHER_PRODUCT_ID = "71000000-0000-4000-8000-000000000001";
const MANUAL_REQUEST_ID = "71000000-0000-4000-8000-000000000002";
const SECOND_MANUAL_REQUEST_ID = "71000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-09-13T03:00:00.000Z");

describe("production task command service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  async function fixture() {
    const scenario = await seedLockedPlanningScenario(context.db);
    const [generation] = await context.db
      .select()
      .from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, scenario.planningSnapshotId));
    const [task] = await context.db
      .select()
      .from(cycleTasks)
      .where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
    if (!generation || !task) throw new Error("production fixture incomplete");
    return { ...scenario, generation, task };
  }

  function updateInput(fixtureValue: Awaited<ReturnType<typeof fixture>>) {
    return {
      cycleId: fixtureValue.cycleId,
      taskGenerationId: fixtureValue.generation.id,
      taskId: fixtureValue.task.id,
      title: "งานแก้ไขแล้ว",
      productId: fixtureValue.productId,
      batchCount: "1.500000",
      scheduledAt: new Date("2026-08-30T02:00:00.000Z"),
      estimatedDurationMinutes: 45,
      notes: "หมายเหตุใหม่",
      sequence: 4,
      status: "PENDING" as const,
      skipReason: null,
    };
  }

  function manualInput(fixtureValue: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
    return {
      cycleId: fixtureValue.cycleId,
      taskGenerationId: fixtureValue.generation.id,
      creationRequestId: MANUAL_REQUEST_ID,
      title: "เช็ดโต๊ะ",
      productId: null,
      batchCount: null,
      scheduledAt: new Date("2026-08-30T03:00:00.000Z"),
      estimatedDurationMinutes: 15,
      notes: null,
      sequence: 9,
      status: "PENDING" as const,
      skipReason: null,
      ...overrides,
    };
  }

  it("updates business fields, resolves the active product name, and preserves source lineage", async () => {
    const value = await fixture();
    await context.db.insert(products).values({
      id: OTHER_PRODUCT_ID,
      ownerId: OWNER_ID,
      name: "สินค้าใหม่",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 10000,
      active: true,
    });
    const before = value.task;
    const after = await createProductionCommandService(context.db).updateTask(
      OWNER_ID,
      { ...updateInput(value), productId: OTHER_PRODUCT_ID, status: "DONE", skipReason: "ไม่ใช้แล้ว" },
    );
    expect(after).toMatchObject({
      productId: OTHER_PRODUCT_ID,
      productName: "สินค้าใหม่",
      status: "DONE",
      skipReason: null,
      title: "งานแก้ไขแล้ว",
      batchCount: "1.500000",
    });
    expect({
      origin: after.origin,
      sourceTemplateId: after.sourceTemplateId,
      sourceActivityId: after.sourceActivityId,
      sourceTemplateScope: after.sourceTemplateScope,
      sourceProductId: after.sourceProductId,
      sourceTemplateName: after.sourceTemplateName,
      sourceActivityName: after.sourceActivityName,
      sourceProductName: after.sourceProductName,
      creationRequestId: after.creationRequestId,
      cycleTaskGenerationId: after.cycleTaskGenerationId,
    }).toEqual({
      origin: before.origin,
      sourceTemplateId: before.sourceTemplateId,
      sourceActivityId: before.sourceActivityId,
      sourceTemplateScope: before.sourceTemplateScope,
      sourceProductId: before.sourceProductId,
      sourceTemplateName: before.sourceTemplateName,
      sourceActivityName: before.sourceActivityName,
      sourceProductName: before.sourceProductName,
      creationRequestId: before.creationRequestId,
      cycleTaskGenerationId: before.cycleTaskGenerationId,
    });
  });

  it.each([
    ["PENDING", "   ", null],
    ["IN_PROGRESS", "  เหตุผลเก่า  ", null],
    ["DONE", "  เหตุผลเก่า  ", null],
    ["SKIPPED", "  หยุดผลิต  ", "หยุดผลิต"],
  ] as const)("normalizes skip reason for %s", async (status, reason, expected) => {
    const value = await fixture();
    const result = await createProductionCommandService(context.db).updateTask(
      OWNER_ID,
      { ...updateInput(value), status, skipReason: reason },
    );
    expect(result.status).toBe(status);
    expect(result.skipReason).toBe(expected);
  });

  it("rejects a skipped task without a nonblank reason", async () => {
    const value = await fixture();
    await expect(createProductionCommandService(context.db).updateTask(
      OWNER_ID,
      { ...updateInput(value), status: "SKIPPED", skipReason: "   " },
    )).rejects.toBeInstanceOf(ProductionValidationError);
  });

  it("returns one manual task for identical request and rejects a changed full payload", async () => {
    const value = await fixture();
    const commands = createProductionCommandService(context.db);
    const first = await commands.createManualTask(OWNER_ID, manualInput(value));
    await expect(commands.createManualTask(OWNER_ID, manualInput(value))).resolves.toEqual(first);
    await expect(commands.createManualTask(OWNER_ID, manualInput(value, { title: "payload ใหม่" }))).rejects.toBeInstanceOf(ProductionStateError);
    await expect(commands.createManualTask(OWNER_ID, manualInput(value, { sequence: 10 }))).rejects.toBeInstanceOf(ProductionStateError);
    const rows = await context.db.select().from(cycleTasks).where(eq(cycleTasks.creationRequestId, MANUAL_REQUEST_ID));
    expect(rows).toHaveLength(1);
  });

  it("returns the existing manual task when an identical request uses a normal integer batch count", async () => {
    const value = await fixture();
    const commands = createProductionCommandService(context.db);
    const input = manualInput(value, { batchCount: "1" });
    const first = await commands.createManualTask(OWNER_ID, input);
    await expect(commands.createManualTask(OWNER_ID, input)).resolves.toEqual(first);
  });

  it("creates a manual task with null source lineage", async () => {
    const value = await fixture();
    const task = await createProductionCommandService(context.db).createManualTask(OWNER_ID, manualInput(value));
    expect(task).toMatchObject({
      origin: "MANUAL",
      creationRequestId: MANUAL_REQUEST_ID,
      sourceTemplateId: null,
      sourceActivityId: null,
      sourceTemplateScope: null,
      sourceProductId: null,
      sourceTemplateName: null,
      sourceActivityName: null,
      sourceProductName: null,
    });
  });

  it("resolves manual product names only from an owner-scoped active product", async () => {
    const value = await fixture();
    await expect(createProductionCommandService(context.db).createManualTask(
      OWNER_ID,
      manualInput(value, { productId: OTHER_PRODUCT_ID }),
    )).rejects.toBeInstanceOf(ProductionValidationError);

    await context.db.insert(products).values({
      id: OTHER_PRODUCT_ID,
      ownerId: OWNER_ID,
      name: "งานสินค้า",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 10000,
      active: false,
    });
    await expect(createProductionCommandService(context.db).createManualTask(
      OWNER_ID,
      manualInput(value, { productId: OTHER_PRODUCT_ID, creationRequestId: SECOND_MANUAL_REQUEST_ID }),
    )).rejects.toBeInstanceOf(ProductionValidationError);
  });

  it("soft-deletes only a pending manual task and never hard-deletes", async () => {
    const value = await fixture();
    const commands = createProductionCommandService(context.db, { now: () => NOW });
    const created = await commands.createManualTask(OWNER_ID, manualInput(value));
    const deleted = await commands.softDeleteManualTask(OWNER_ID, {
      cycleId: value.cycleId,
      taskGenerationId: value.generation.id,
      taskId: created.id,
    });
    expect(deleted.deletedAt).toEqual(NOW);
    await expect(context.db.delete(cycleTasks).where(eq(cycleTasks.id, created.id))).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/hard delete/i) }),
    });
  });

  it.each([
    ["generated", "generated"],
    ["in-progress manual", "manual-in-progress"],
    ["done manual", "manual-done"],
  ] as const)("rejects deleting a %s task", async (_label, kind) => {
    const value = await fixture();
    const commands = createProductionCommandService(context.db);
    let taskId = value.task.id;
    if (kind !== "generated") {
      const created = await commands.createManualTask(OWNER_ID, manualInput(value, {
        creationRequestId: kind === "manual-done" ? SECOND_MANUAL_REQUEST_ID : MANUAL_REQUEST_ID,
        status: kind === "manual-done" ? "DONE" : "IN_PROGRESS",
      }));
      taskId = created.id;
    }
    await expect(commands.softDeleteManualTask(OWNER_ID, {
      cycleId: value.cycleId,
      taskGenerationId: value.generation.id,
      taskId,
    })).rejects.toBeInstanceOf(ProductionStateError);
  });

  it("rejects superseded, terminal, and wrong-pointer mutations", async () => {
    const value = await fixture();
    const commands = createProductionCommandService(context.db);
    const input = updateInput(value);
    await context.db.update(cyclePlanningSnapshots).set({
      status: "SUPERSEDED",
      unlockedAt: NOW,
      unlockReason: "แก้แผน",
      unlockedFromStatus: "LOCKED",
    }).where(eq(cyclePlanningSnapshots.id, value.planningSnapshotId));
    await context.db.update(bakeCycles).set({ status: "OPEN", activePlanningSnapshotId: null }).where(eq(bakeCycles.id, value.cycleId));
    await expect(commands.updateTask(OWNER_ID, input)).rejects.toBeInstanceOf(ProductionStateError);

    await context.db.update(cyclePlanningSnapshots).set({
      status: "ACTIVE", unlockedAt: null, unlockReason: null, unlockedFromStatus: null,
    }).where(eq(cyclePlanningSnapshots.id, value.planningSnapshotId));
    await context.db.update(bakeCycles).set({ status: "LOCKED", activePlanningSnapshotId: value.planningSnapshotId }).where(eq(bakeCycles.id, value.cycleId));
    await context.db.update(bakeCycles).set({ activePlanningSnapshotId: null }).where(eq(bakeCycles.id, value.cycleId));
    await expect(commands.updateTask(OWNER_ID, updateInput(value))).rejects.toBeInstanceOf(ProductionStateError);
    await context.db.update(bakeCycles).set({ activePlanningSnapshotId: value.planningSnapshotId, status: "COMPLETED" }).where(eq(bakeCycles.id, value.cycleId));
    await expect(commands.updateTask(OWNER_ID, updateInput(value))).rejects.toBeInstanceOf(ProductionStateError);
  });

  it("uses the same state error for unknown and cross-owner task IDs", async () => {
    const value = await fixture();
    const commands = createProductionCommandService(context.db);
    const input = updateInput(value);
    const outcomes: Array<Readonly<{ kind: string; message: string }>> = [];
    for (const operation of [
      () => commands.updateTask(OTHER_OWNER_ID, input),
      () => commands.updateTask(OWNER_ID, { ...input, taskId: "ffffffff-ffff-4fff-bfff-ffffffffffff" }),
    ]) {
      try {
        await operation();
      } catch (error) {
        expect(error).toBeInstanceOf(ProductionStateError);
        outcomes.push({
          kind: (error as ProductionStateError).kind,
          message: (error as ProductionStateError).message,
        });
      }
    }
    expect(outcomes).toEqual([
      { kind: "TASK_NOT_FOUND", message: "Production task not found" },
      { kind: "TASK_NOT_FOUND", message: "Production task not found" },
    ]);
  });

  it("locks the owned cycle before the task row", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({ logger: { logQuery(query: string) { queries.push(query.toLowerCase()); } } satisfies Logger });
    const value = await fixture();
    queries.length = 0;
    await createProductionCommandService(context.db).updateTask(OWNER_ID, updateInput(value));
    const locks = queries.filter((query) => query.includes("for update"));
    expect(locks.findIndex((query) => query.includes('from "bake_cycles"'))).toBeGreaterThanOrEqual(0);
    expect(locks.findIndex((query) => query.includes('from "cycle_tasks"'))).toBeGreaterThan(
      locks.findIndex((query) => query.includes('from "bake_cycles"')),
    );
  });
});
