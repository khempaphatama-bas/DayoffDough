import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import {
  cycleTaskGenerations,
  cycleTasks,
  productionTemplateActivities,
  productionTemplates,
} from "@/modules/production/db/schema";
import { persistCycleTaskGeneration } from "./task-generation-writer";

describe("persistCycleTaskGeneration", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("persists one independently snapshotted task per activity and product", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const cycleTemplateId = "60000000-0000-4000-8000-000000000001";
    const cycleActivityId = "60000000-0000-4000-8000-000000000002";
    const snapshotId = "60000000-0000-4000-8000-000000000003";
    const lockedAt = new Date("2026-08-29T00:00:00.000Z");

    await context.db.insert(productionTemplates).values({
      id: cycleTemplateId,
      ownerId: OWNER_ID,
      name: "เทมเพลตรอบผลิต",
      scope: "CYCLE",
      productId: null,
      active: true,
    });
    await context.db.insert(productionTemplateActivities).values({
      id: cycleActivityId,
      ownerId: OWNER_ID,
      productionTemplateId: cycleTemplateId,
      name: "เตรียมและอบ",
      offsetDaysFromDelivery: 0,
      defaultTime: "08:00",
      estimatedDurationMinutes: 45,
      sequence: 1,
      notes: "ระดับรอบ",
      active: true,
    });
    await context.db.insert(cyclePlanningSnapshots).values({
      id: snapshotId,
      ownerId: OWNER_ID,
      bakeCycleId: scenario.cycleId,
      generation: 1,
      status: "ACTIVE",
      lockRequestId: "60000000-0000-4000-8000-000000000004",
      inputFingerprint: "a".repeat(64),
      cycleNumber: 1,
      cycleName: "รอบส่ง 30 ส.ค.",
      orderCutoffAt: null,
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
      laborRateSatangPerHour: 12_000,
      defaultWasteAllowancePercent: "3.0000",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt,
    });

    const [productTemplate, productActivity] = await Promise.all([
      context.db
        .select()
        .from(productionTemplates)
        .where(eq(productionTemplates.productId, scenario.productId)),
      context.db
        .select()
        .from(productionTemplateActivities)
        .where(eq(productionTemplateActivities.productionTemplateId, "20000000-0000-4000-8000-000000000005")),
    ]);
    const templates = [
      {
        id: cycleTemplateId,
        name: "เทมเพลตรอบผลิต",
        scope: "CYCLE" as const,
        productId: null,
        active: true as const,
        activities: [{
          id: cycleActivityId,
          name: "เตรียมและอบ",
          offsetDaysFromDelivery: 0,
          defaultTime: "08:00",
          estimatedDurationMinutes: 45,
          sequence: 1,
          notes: "ระดับรอบ",
        }],
      },
      {
        id: productTemplate[0]!.id,
        name: productTemplate[0]!.name,
        scope: "PRODUCT" as const,
        productId: scenario.productId,
        active: true as const,
        activities: productActivity.map((activity) => ({
          id: activity.id,
          name: activity.name,
          offsetDaysFromDelivery: activity.offsetDaysFromDelivery,
          defaultTime: activity.defaultTime.slice(0, 5),
          estimatedDurationMinutes: activity.estimatedDurationMinutes,
          sequence: activity.sequence,
          notes: activity.notes,
        })),
      },
    ];

    const summary = await context.db.transaction((tx) =>
      persistCycleTaskGeneration(tx, OWNER_ID, {
        cycleId: scenario.cycleId,
        planningSnapshotId: snapshotId,
        generation: 1,
        primaryDeliveryDate: "2026-08-30",
        timezone: "Asia/Bangkok",
        templates,
        productPlans: [{
          productId: scenario.productId,
          productName: "ฟอคคาเซีย",
          selectedBatchCount: "2.000000",
        }],
      }),
    );

    expect(summary).toMatchObject({
      cycleId: scenario.cycleId,
      planningSnapshotId: snapshotId,
      generation: 1,
      primaryDeliveryDate: "2026-08-30",
      timezone: "Asia/Bangkok",
    });
    const [generation] = await context.db
      .select()
      .from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, snapshotId));
    const tasks = await context.db
      .select()
      .from(cycleTasks)
      .where(
        and(
          eq(cycleTasks.ownerId, OWNER_ID),
          eq(cycleTasks.cycleTaskGenerationId, generation!.id),
        ),
      )
      .orderBy(cycleTasks.scheduledAt, cycleTasks.id);

    expect(tasks).toHaveLength(2);
    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        origin: "TEMPLATE",
        sourceTemplateScope: "CYCLE",
        sourceProductId: null,
        sourceProductName: null,
        productId: null,
        productName: null,
        title: "เตรียมและอบ",
        notes: "ระดับรอบ",
      }),
      expect.objectContaining({
        origin: "TEMPLATE",
        sourceTemplateScope: "PRODUCT",
        sourceProductId: scenario.productId,
        sourceProductName: "ฟอคคาเซีย",
        productId: scenario.productId,
        productName: "ฟอคคาเซีย",
        batchCount: "2.000000",
      }),
    ]));
    expect(tasks[0]!.id).not.toBe(tasks[1]!.id);
    expect((await context.db.select().from(bakeCycles).where(eq(bakeCycles.id, scenario.cycleId)))[0]!.status).toBe("OPEN");
  });
});
