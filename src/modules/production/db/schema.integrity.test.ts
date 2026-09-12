import { eq, sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import {
  cycleTaskGenerations,
  cycleTasks,
  productionTemplateActivities,
  productionTemplates,
} from "./schema";

const PRODUCT_ID = "54000000-0000-4000-8000-000000000001";
const OTHER_PRODUCT_ID = "54000000-0000-4000-8000-000000000002";
const LOCK_REQUEST_ID = "54000000-0000-4000-8000-000000000003";
const MANUAL_REQUEST_ID = "54000000-0000-4000-8000-000000000004";
const OTHER_MANUAL_REQUEST_ID = "54000000-0000-4000-8000-000000000005";
const SECOND_LOCK_REQUEST_ID = "54000000-0000-4000-8000-000000000006";
const NOW = new Date("2026-09-12T03:00:00.000Z");

async function queryRows<T>(db: DatabaseClient, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraint: string,
) {
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(Error);
  expect(
    (rejection as Error & { cause?: { constraint?: string } }).cause,
  ).toMatchObject({ constraint });
}

async function expectDatabaseRejection(
  operation: () => Promise<unknown>,
  message: RegExp,
) {
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(Error);
  expect((rejection as Error & { cause?: unknown }).cause).toBeInstanceOf(
    Error,
  );
  expect(
    ((rejection as Error & { cause: Error }).cause).message,
  ).toMatch(message);
}

async function insertProduct(
  db: DatabaseClient,
  ownerId = OWNER_ID,
  id = PRODUCT_ID,
) {
  await db.insert(products).values({
    id,
    ownerId,
    name: ownerId === OWNER_ID ? "โชกุปัง" : "ครัวซองต์",
    sellingUnit: "ชิ้น",
    defaultUnitPriceSatang: 12000,
  });
}

async function seedWritableTaskFixture(db: DatabaseClient) {
  await insertProduct(db);
  const [cycle] = await db
    .insert(bakeCycles)
    .values({
      ownerId: OWNER_ID,
      name: "รอบ 13 กันยายน",
      status: "OPEN",
      targetProductionDate: "2026-09-12",
      primaryDeliveryDate: "2026-09-13",
    })
    .returning();
  if (!cycle) throw new Error("Bake cycle insert failed");

  const [snapshot] = await db
    .insert(cyclePlanningSnapshots)
    .values({
      ownerId: OWNER_ID,
      bakeCycleId: cycle.id,
      generation: 1,
      status: "ACTIVE",
      lockRequestId: LOCK_REQUEST_ID,
      inputFingerprint: "a".repeat(64),
      cycleNumber: cycle.cycleNumber,
      cycleName: cycle.name,
      targetProductionDate: cycle.targetProductionDate,
      primaryDeliveryDate: cycle.primaryDeliveryDate,
      laborRateSatangPerHour: 6000,
      defaultWasteAllowancePercent: "3",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt: NOW,
    })
    .returning();
  if (!snapshot) throw new Error("Planning snapshot insert failed");

  const [generation] = await db
    .insert(cycleTaskGenerations)
    .values({
      ownerId: OWNER_ID,
      bakeCycleId: cycle.id,
      planningSnapshotId: snapshot.id,
      generation: snapshot.generation,
      primaryDeliveryDate: snapshot.primaryDeliveryDate,
      timezone: snapshot.timezone,
    })
    .returning();
  if (!generation) throw new Error("Task generation insert failed");

  const [template] = await db
    .insert(productionTemplates)
    .values({
      ownerId: OWNER_ID,
      name: "เตรียมรอบผลิต",
      scope: "CYCLE",
      active: true,
    })
    .returning();
  if (!template) throw new Error("Template insert failed");

  const [activity] = await db
    .insert(productionTemplateActivities)
    .values({
      ownerId: OWNER_ID,
      productionTemplateId: template.id,
      name: "เตรียมอุปกรณ์",
      offsetDaysFromDelivery: -1,
      defaultTime: "08:00:00",
      estimatedDurationMinutes: 30,
      sequence: 1,
      active: true,
    })
    .returning();
  if (!activity) throw new Error("Activity insert failed");

  const [task] = await db
    .insert(cycleTasks)
    .values({
      ownerId: OWNER_ID,
      cycleTaskGenerationId: generation.id,
      origin: "TEMPLATE",
      sourceTemplateId: template.id,
      sourceActivityId: activity.id,
      sourceTemplateScope: "CYCLE",
      sourceTemplateName: template.name,
      sourceActivityName: activity.name,
      title: activity.name,
      scheduledAt: new Date("2026-09-12T01:00:00.000Z"),
      estimatedDurationMinutes: activity.estimatedDurationMinutes,
      sequence: activity.sequence,
      status: "PENDING",
    })
    .returning();
  if (!task) throw new Error("Task insert failed");

  await db
    .update(bakeCycles)
    .set({
      status: "LOCKED",
      lockedAt: NOW,
      activePlanningSnapshotId: snapshot.id,
    })
    .where(eq(bakeCycles.id, cycle.id));

  return { cycle, snapshot, generation, template, activity, task };
}

function manualTaskValues(
  generationId: string,
  creationRequestId = MANUAL_REQUEST_ID,
) {
  return {
    ownerId: OWNER_ID,
    cycleTaskGenerationId: generationId,
    origin: "MANUAL" as const,
    creationRequestId,
    title: "เช็ดโต๊ะ",
    scheduledAt: new Date("2026-09-12T02:00:00.000Z"),
    estimatedDurationMinutes: 15,
    sequence: 2,
    status: "PENDING" as const,
  };
}

describe("Phase 4A production schema integrity", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("rejects invalid template scope/product pairings", async () => {
    await expectConstraintViolation(
      () =>
        context.db.insert(productionTemplates).values({
          ownerId: OWNER_ID,
          name: "ผิดประเภท",
          scope: "CYCLE",
          productId: PRODUCT_ID,
        }),
      "production_templates_scope_product_check",
    );
  });

  it("allows only one active cycle template per owner", async () => {
    await context.db.insert(productionTemplates).values({
      ownerId: OWNER_ID,
      name: "ชุดแรก",
      scope: "CYCLE",
      active: true,
    });

    await expectConstraintViolation(
      () =>
        context.db.insert(productionTemplates).values({
          ownerId: OWNER_ID,
          name: "ชุดที่สอง",
          scope: "CYCLE",
          active: true,
        }),
      "production_templates_one_active_cycle_idx",
    );
  });

  it("allows only one active product template per owner and product", async () => {
    await insertProduct(context.db);
    await context.db.insert(productionTemplates).values({
      ownerId: OWNER_ID,
      name: "ชุดแรก",
      scope: "PRODUCT",
      productId: PRODUCT_ID,
      active: true,
    });

    await expectConstraintViolation(
      () =>
        context.db.insert(productionTemplates).values({
          ownerId: OWNER_ID,
          name: "ชุดที่สอง",
          scope: "PRODUCT",
          productId: PRODUCT_ID,
          active: true,
        }),
      "production_templates_one_active_product_idx",
    );
  });

  it("rejects owner-crossing template product and activity references", async () => {
    await insertProduct(context.db, OTHER_OWNER_ID, OTHER_PRODUCT_ID);
    await expectConstraintViolation(
      () =>
        context.db.insert(productionTemplates).values({
          ownerId: OWNER_ID,
          name: "ข้ามร้าน",
          scope: "PRODUCT",
          productId: OTHER_PRODUCT_ID,
        }),
      "production_templates_owned_product_fk",
    );

    const [otherTemplate] = await context.db
      .insert(productionTemplates)
      .values({
        ownerId: OTHER_OWNER_ID,
        name: "ร้านอื่น",
        scope: "CYCLE",
      })
      .returning();
    if (!otherTemplate) throw new Error("Other template insert failed");

    await expectConstraintViolation(
      () =>
        context.db.insert(productionTemplateActivities).values({
          ownerId: OWNER_ID,
          productionTemplateId: otherTemplate.id,
          name: "ข้ามร้าน",
          offsetDaysFromDelivery: 0,
          defaultTime: "09:00:00",
          estimatedDurationMinutes: 10,
          sequence: 1,
        }),
      "production_template_activities_owned_template_fk",
    );
  });

  it("rejects duplicate active activity sequences", async () => {
    const { template } = await seedWritableTaskFixture(context.db);
    await expectConstraintViolation(
      () =>
        context.db.insert(productionTemplateActivities).values({
          ownerId: OWNER_ID,
          productionTemplateId: template.id,
          name: "ซ้ำลำดับ",
          offsetDaysFromDelivery: 0,
          defaultTime: "09:00:00",
          estimatedDurationMinutes: 10,
          sequence: 1,
          active: true,
        }),
      "production_template_activities_active_sequence_unique",
    );
  });

  it("registers activity name and positive-value checks", async () => {
    const rows = await queryRows<{ constraintName: string }>(
      context.db,
      sql`
        SELECT conname AS "constraintName"
        FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid IN (
            'production_template_activities'::regclass,
            'cycle_task_generations'::regclass,
            'cycle_tasks'::regclass
          )
        ORDER BY conname
      `,
    );

    expect(rows.map((row) => row.constraintName)).toEqual([
      "cycle_task_generations_generation_positive",
      "cycle_tasks_batch_count_positive",
      "cycle_tasks_creation_request_shape",
      "cycle_tasks_deleted_at_shape",
      "cycle_tasks_duration_positive",
      "cycle_tasks_lineage_shape",
      "cycle_tasks_product_pairing",
      "cycle_tasks_sequence_positive",
      "cycle_tasks_skip_reason_shape",
      "cycle_tasks_source_scope_product_shape",
      "production_template_activities_duration_positive",
      "production_template_activities_name_not_blank",
      "production_template_activities_sequence_positive",
    ]);
  });

  it("rejects a task generation with mismatched copied delivery date", async () => {
    const { cycle, snapshot } = await seedWritableTaskFixture(context.db);
    await expectDatabaseRejection(
      () =>
        context.db.insert(cycleTaskGenerations).values({
        ownerId: OWNER_ID,
        bakeCycleId: cycle.id,
        planningSnapshotId: snapshot.id,
        generation: 1,
        primaryDeliveryDate: "2026-09-14",
        timezone: "Asia/Bangkok",
        }),
      /task generation snapshot mismatch/i,
    );
  });

  it("rejects a task generation that crosses the owner boundary", async () => {
    const { cycle, snapshot } = await seedWritableTaskFixture(context.db);
    await expect(
      context.db.insert(cycleTaskGenerations).values({
        ownerId: OTHER_OWNER_ID,
        bakeCycleId: cycle.id,
        planningSnapshotId: snapshot.id,
        generation: snapshot.generation,
        primaryDeliveryDate: snapshot.primaryDeliveryDate,
        timezone: snapshot.timezone,
      }),
    ).rejects.toThrow();
  });

  it("rejects rebinding a task generation to another matching snapshot", async () => {
    const { generation } = await seedWritableTaskFixture(context.db);
    const [otherCycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบ 20 กันยายน",
        status: "OPEN",
        targetProductionDate: "2026-09-19",
        primaryDeliveryDate: "2026-09-20",
      })
      .returning();
    if (!otherCycle) throw new Error("Second bake cycle insert failed");

    const [otherSnapshot] = await context.db
      .insert(cyclePlanningSnapshots)
      .values({
        ownerId: OWNER_ID,
        bakeCycleId: otherCycle.id,
        generation: 1,
        status: "ACTIVE",
        lockRequestId: SECOND_LOCK_REQUEST_ID,
        inputFingerprint: "b".repeat(64),
        cycleNumber: otherCycle.cycleNumber,
        cycleName: otherCycle.name,
        targetProductionDate: otherCycle.targetProductionDate,
        primaryDeliveryDate: otherCycle.primaryDeliveryDate,
        laborRateSatangPerHour: 6000,
        defaultWasteAllowancePercent: "3",
        timezone: "Asia/Bangkok",
        currency: "THB",
        costComplete: true,
        lockedAt: NOW,
      })
      .returning();
    if (!otherSnapshot) throw new Error("Second planning snapshot insert failed");

    await expectDatabaseRejection(
      () =>
        context.db
          .update(cycleTaskGenerations)
          .set({
            bakeCycleId: otherCycle.id,
            planningSnapshotId: otherSnapshot.id,
            generation: otherSnapshot.generation,
            primaryDeliveryDate: otherSnapshot.primaryDeliveryDate,
            timezone: otherSnapshot.timezone,
          })
          .where(eq(cycleTaskGenerations.id, generation.id)),
      /task generation is immutable/i,
    );
  });

  it("rejects invalid template and manual lineage shapes", async () => {
    const { cycle, generation } = await seedWritableTaskFixture(context.db);
    await context.db
      .update(bakeCycles)
      .set({ status: "OPEN", activePlanningSnapshotId: null, lockedAt: null })
      .where(eq(bakeCycles.id, cycle.id));
    await expectConstraintViolation(
      () =>
        context.db.insert(cycleTasks).values({
          ...manualTaskValues(generation.id),
          origin: "TEMPLATE",
          creationRequestId: null,
        }),
      "cycle_tasks_lineage_shape",
    );
  });

  it("rejects mismatched current product/name pairs and non-positive values", async () => {
    const { generation } = await seedWritableTaskFixture(context.db);
    await expectConstraintViolation(
      () =>
        context.db.insert(cycleTasks).values({
          ...manualTaskValues(generation.id),
          productId: PRODUCT_ID,
        }),
      "cycle_tasks_product_pairing",
    );
    await expectConstraintViolation(
      () =>
        context.db.insert(cycleTasks).values({
          ...manualTaskValues(generation.id, OTHER_MANUAL_REQUEST_ID),
          batchCount: "0",
        }),
      "cycle_tasks_batch_count_positive",
    );
  });

  it("rejects blank skipped reasons and reasons on non-skipped tasks", async () => {
    const { generation } = await seedWritableTaskFixture(context.db);
    await expectConstraintViolation(
      () =>
        context.db.insert(cycleTasks).values({
          ...manualTaskValues(generation.id),
          status: "SKIPPED",
          skipReason: "   ",
        }),
      "cycle_tasks_skip_reason_shape",
    );
    await expectConstraintViolation(
      () =>
        context.db.insert(cycleTasks).values({
          ...manualTaskValues(generation.id, OTHER_MANUAL_REQUEST_ID),
          skipReason: "ไม่ควรมี",
        }),
      "cycle_tasks_skip_reason_shape",
    );
  });

  it("rejects repeated owner-scoped manual request ids", async () => {
    const { generation } = await seedWritableTaskFixture(context.db);
    await context.db.insert(cycleTasks).values(manualTaskValues(generation.id));
    await expectConstraintViolation(
      () =>
        context.db.insert(cycleTasks).values(manualTaskValues(generation.id)),
      "cycle_tasks_owner_creation_request_unique",
    );
  });

  it("rejects direct SQL source-product references across owners", async () => {
    const { generation, template, activity } =
      await seedWritableTaskFixture(context.db);
    await insertProduct(context.db, OTHER_OWNER_ID, OTHER_PRODUCT_ID);

    await expect(
      context.db.execute(sql`
        INSERT INTO cycle_tasks (
          owner_id, cycle_task_generation_id, origin,
          source_template_id, source_activity_id, source_template_scope,
          source_product_id, source_template_name, source_activity_name,
          source_product_name, title, scheduled_at,
          estimated_duration_minutes, sequence, status
        ) VALUES (
          ${OWNER_ID}, ${generation.id}, 'TEMPLATE',
          ${template.id}, ${activity.id}, 'PRODUCT',
          ${OTHER_PRODUCT_ID}, ${template.name}, ${activity.name},
          'ครัวซองต์', 'งานข้ามร้าน', ${NOW}, 10, 3, 'PENDING'
        )
      `),
    ).rejects.toThrow();
  });

  it("rejects immutable lineage and generation changes", async () => {
    const { task } = await seedWritableTaskFixture(context.db);
    await expectDatabaseRejection(
      () =>
        context.db
          .update(cycleTasks)
          .set({ sourceTemplateName: "เปลี่ยน snapshot" })
          .where(eq(cycleTasks.id, task.id)),
      /task lineage is immutable/i,
    );
  });

  it("rejects hard deletes", async () => {
    const { task } = await seedWritableTaskFixture(context.db);
    await expectDatabaseRejection(
      () => context.db.delete(cycleTasks).where(eq(cycleTasks.id, task.id)),
      /cycle task hard delete is not allowed/i,
    );
  });

  it("rejects updates after its planning snapshot is superseded", async () => {
    const { cycle, snapshot, task } = await seedWritableTaskFixture(context.db);
    await context.db
      .update(bakeCycles)
      .set({
        status: "OPEN",
        activePlanningSnapshotId: null,
        lockedAt: null,
      })
      .where(eq(bakeCycles.id, cycle.id));
    await context.db
      .update(cyclePlanningSnapshots)
      .set({
        status: "SUPERSEDED",
        unlockedAt: new Date("2026-09-12T04:00:00.000Z"),
        unlockReason: "ปรับแผนการผลิต",
        unlockedFromStatus: "LOCKED",
      })
      .where(eq(cyclePlanningSnapshots.id, snapshot.id));

    await expectDatabaseRejection(
      () =>
        context.db
          .update(cycleTasks)
          .set({ title: "แก้ย้อนหลัง" })
          .where(eq(cycleTasks.id, task.id)),
      /task generation is read-only/i,
    );
  });

  it("rejects manual inserts until the generation is the writable active one", async () => {
    const { cycle, snapshot, generation } =
      await seedWritableTaskFixture(context.db);
    await context.db
      .update(bakeCycles)
      .set({ status: "OPEN", activePlanningSnapshotId: null, lockedAt: null })
      .where(eq(bakeCycles.id, cycle.id));

    await expectDatabaseRejection(
      () => context.db.insert(cycleTasks).values(manualTaskValues(generation.id)),
      /task generation is read-only/i,
    );

    await context.db
      .update(bakeCycles)
      .set({
        status: "LOCKED",
        activePlanningSnapshotId: snapshot.id,
        lockedAt: NOW,
      })
      .where(eq(bakeCycles.id, cycle.id));
    await expect(
      context.db.insert(cycleTasks).values(manualTaskValues(generation.id)),
    ).resolves.toBeDefined();
  });
});
