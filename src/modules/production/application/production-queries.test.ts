import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import {
  seedLockedPlanningScenario,
  seedPlanningScenario,
} from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { products } from "@/modules/products/db/schema";
import {
  cycleTaskGenerations,
  cycleTasks,
} from "@/modules/production/db/schema";
import { createProductionQueryService } from "./production-queries";

const MISSING_CYCLE_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";

async function expectNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow("Production generation not found");
}

describe("production query service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("returns CURRENT only for the active writable generation", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    const view = await createProductionQueryService(context.db).getCycleProduction(
      OWNER_ID,
      scenario.cycleId,
    );

    expect(view).toMatchObject({
      kind: "CURRENT",
      writable: true,
      cycle: {
        cycleId: scenario.cycleId,
        cycleNumber: 1,
        cycleName: "รอบส่ง 30 ส.ค.",
        cycleStatus: "LOCKED",
      },
      generation: {
        generation: 1,
        planningSnapshotId: scenario.planningSnapshotId,
        planningStatus: "ACTIVE",
      },
    });
    expect(view.kind).toBe("CURRENT");
    if (view.kind !== "CURRENT") return;
    expect(view.generations).toEqual([
      expect.objectContaining({
        planningSnapshotId: scenario.planningSnapshotId,
        generation: 1,
        planningStatus: "ACTIVE",
        hasTimeline: true,
        unlockedAt: null,
        unlockReason: null,
      }),
    ]);
    expect(view.tasks).toEqual([
      expect.objectContaining({
        origin: "TEMPLATE",
        sourceTemplateName: "เทมเพลตฟอคคาเซียหลัก",
        sourceActivityName: "เตรียมและอบ",
        title: "เตรียมและอบ",
        productId: scenario.productId,
        productName: "ฟอคคาเซีย",
        batchCount: "2.000000",
        status: "PENDING",
        skipReason: null,
      }),
    ]);
  });

  it("returns HISTORY for a superseded generation, including unlock metadata", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    const unlockedAt = new Date("2026-08-30T03:00:00.000Z");
    await context.db
      .update(cyclePlanningSnapshots)
      .set({
        status: "SUPERSEDED",
        unlockedAt,
        unlockReason: "เพิ่มออเดอร์ด่วน",
        unlockedFromStatus: "LOCKED",
      })
      .where(eq(cyclePlanningSnapshots.id, scenario.planningSnapshotId));
    await context.db
      .update(bakeCycles)
      .set({ activePlanningSnapshotId: null, status: "OPEN" })
      .where(eq(bakeCycles.id, scenario.cycleId));

    const view = await createProductionQueryService(context.db).getCycleProduction(
      OWNER_ID,
      scenario.cycleId,
      1,
    );

    expect(view).toMatchObject({
      kind: "HISTORY",
      writable: false,
      generation: {
        generation: 1,
        planningStatus: "SUPERSEDED",
      },
      generations: [
        expect.objectContaining({
          generation: 1,
          planningStatus: "SUPERSEDED",
          hasTimeline: true,
          lockedAt: new Date("2026-08-23T03:00:00.000Z"),
          unlockedAt,
          unlockReason: "เพิ่มออเดอร์ด่วน",
        }),
      ],
    });
  });

  it("returns NO_GENERATION/NO_PLAN when no planning snapshot is selected", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const view = await createProductionQueryService(context.db).getCycleProduction(
      OWNER_ID,
      scenario.cycleId,
    );

    expect(view).toEqual({
      kind: "NO_GENERATION",
      reason: "NO_PLAN",
      selectedPlanningGeneration: null,
      generations: [],
      cycle: {
        cycleId: scenario.cycleId,
        cycleNumber: 1,
        cycleName: "รอบส่ง 30 ส.ค.",
        cycleStatus: "OPEN",
      },
      writable: false,
    });
  });

  it("returns NO_GENERATION/LEGACY_SNAPSHOT when a planning snapshot has no timeline", async () => {
    const scenario = await seedPlanningScenario(context.db);
    const snapshotId = "60000000-0000-4000-8000-000000000101";
    await context.db.insert(cyclePlanningSnapshots).values({
      id: snapshotId,
      ownerId: OWNER_ID,
      bakeCycleId: scenario.cycleId,
      generation: 1,
      status: "ACTIVE",
      lockRequestId: "60000000-0000-4000-8000-000000000102",
      inputFingerprint: "a".repeat(64),
      cycleNumber: 7,
      cycleName: "ชื่อรอบจาก legacy snapshot",
      orderCutoffAt: null,
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
      laborRateSatangPerHour: 12_000,
      defaultWasteAllowancePercent: "3.0000",
      timezone: "Asia/Bangkok",
      currency: "THB",
      costComplete: true,
      lockedAt: new Date("2026-08-29T00:00:00.000Z"),
    });
    await context.db
      .update(bakeCycles)
      .set({ activePlanningSnapshotId: snapshotId, status: "LOCKED" })
      .where(eq(bakeCycles.id, scenario.cycleId));

    const view = await createProductionQueryService(context.db).getCycleProduction(
      OWNER_ID,
      scenario.cycleId,
    );

    expect(view).toEqual({
      kind: "NO_GENERATION",
      reason: "LEGACY_SNAPSHOT",
      selectedPlanningGeneration: 1,
      generations: [
        expect.objectContaining({
          planningSnapshotId: snapshotId,
          generation: 1,
          planningStatus: "ACTIVE",
          hasTimeline: false,
        }),
      ],
      cycle: {
        cycleId: scenario.cycleId,
        cycleNumber: 7,
        cycleName: "ชื่อรอบจาก legacy snapshot",
        cycleStatus: "LOCKED",
      },
      writable: false,
    });
  });

  it.each([
    ["cross-owner", OTHER_OWNER_ID, "10000000-0000-4000-8000-000000000009", undefined],
    ["missing cycle", OWNER_ID, MISSING_CYCLE_ID, undefined],
    ["malformed owner", "not-an-owner", "10000000-0000-4000-8000-000000000009", undefined],
    ["malformed generation", OWNER_ID, "10000000-0000-4000-8000-000000000009", 0],
    ["missing generation", OWNER_ID, "10000000-0000-4000-8000-000000000009", 99],
  ])("uses the same not-found outcome for %s requests", async (_name, ownerId, cycleId, generation) => {
    await seedLockedPlanningScenario(context.db);
    await expectNotFound(
      createProductionQueryService(context.db).getCycleProduction(
        ownerId,
        cycleId,
        generation,
      ),
    );
  });

  it("filters deleted manual tasks, preserves snapshot names, loads active product options, and sorts deterministically", async () => {
    const scenario = await seedLockedPlanningScenario(context.db);
    const productId = "60000000-0000-4000-8000-000000000103";
    await context.db.insert(products).values({
      id: productId,
      ownerId: OWNER_ID,
      name: "ช็อกโกแลต",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 10_000,
      active: true,
    });
    const [generation] = await context.db
      .select()
      .from(cycleTaskGenerations)
      .where(eq(cycleTaskGenerations.planningSnapshotId, scenario.planningSnapshotId));
    const [generatedTask] = await context.db
      .select()
      .from(cycleTasks)
      .where(eq(cycleTasks.cycleTaskGenerationId, generation!.id));
    const scheduledAt = generatedTask!.scheduledAt;
    await context.db.insert(cycleTasks).values([
      {
        id: "60000000-0000-4000-8000-000000000104",
        ownerId: OWNER_ID,
        cycleTaskGenerationId: generation!.id,
        origin: "MANUAL",
        creationRequestId: "60000000-0000-4000-8000-000000000105",
        title: "ช็อกโกแลต",
        productId,
        productName: "ช็อกโกแลต",
        batchCount: null,
        scheduledAt,
        estimatedDurationMinutes: 20,
        notes: null,
        sequence: 1,
        status: "PENDING",
        skipReason: null,
      },
      {
        id: "60000000-0000-4000-8000-000000000106",
        ownerId: OWNER_ID,
        cycleTaskGenerationId: generation!.id,
        origin: "MANUAL",
        creationRequestId: "60000000-0000-4000-8000-000000000107",
        title: "ลบแล้ว",
        productId: null,
        productName: null,
        batchCount: null,
        scheduledAt,
        estimatedDurationMinutes: 20,
        notes: null,
        sequence: 1,
        status: "PENDING",
        skipReason: null,
        deletedAt: new Date("2026-08-30T00:00:00.000Z"),
      },
      {
        id: "60000000-0000-4000-8000-000000000108",
        ownerId: OWNER_ID,
        cycleTaskGenerationId: generation!.id,
        origin: "MANUAL",
        creationRequestId: "60000000-0000-4000-8000-000000000109",
        title: "ช็อกโกแลต 2",
        productId,
        productName: "ช็อกโกแลต",
        batchCount: null,
        scheduledAt,
        estimatedDurationMinutes: 20,
        notes: null,
        sequence: 1,
        status: "PENDING",
        skipReason: null,
      },
    ]);
    await context.db.update(products).set({ name: "ชื่อสินค้าปัจจุบันใหม่" }).where(eq(products.id, scenario.productId));
    await context.db.insert(products).values({
      id: "60000000-0000-4000-8000-000000000110",
      ownerId: OWNER_ID,
      name: "สินค้าปิดใช้งาน",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 1,
      active: false,
    });

    const view = await createProductionQueryService(context.db).getCycleProduction(
      OWNER_ID,
      scenario.cycleId,
    );
    expect(view.kind).toBe("CURRENT");
    if (view.kind !== "CURRENT") return;
    expect(view.products).toEqual([
      { id: scenario.productId, name: "ชื่อสินค้าปัจจุบันใหม่" },
      { id: productId, name: "ช็อกโกแลต" },
    ]);
    expect(view.tasks.map((task) => task.id)).toEqual([
      "60000000-0000-4000-8000-000000000104",
      "60000000-0000-4000-8000-000000000108",
      generatedTask!.id,
    ]);
    expect(view.tasks.find((task) => task.id === generatedTask!.id)).toMatchObject({
      productName: "ฟอคคาเซีย",
      sourceTemplateName: "เทมเพลตฟอคคาเซียหลัก",
    });
  });

  it("returns history for terminal cycles even when the snapshot remains active", async () => {
    const scenario = await seedLockedPlanningScenario(context.db, {
      cycleStatus: "OPEN",
    });
    await context.db
      .update(bakeCycles)
      .set({ status: "CANCELLED" })
      .where(eq(bakeCycles.id, scenario.cycleId));
    const view = await createProductionQueryService(context.db).getCycleProduction(
      OWNER_ID,
      scenario.cycleId,
    );
    expect(view).toMatchObject({ kind: "HISTORY", writable: false });
  });
});
