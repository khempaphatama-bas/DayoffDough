import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "drizzle-orm/logger";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { seedPlanningScenario } from "@tests/fixtures/planning";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles, bakeCycleStatus } from "@/modules/cycles/db/schema";
import { createPlanningCommandService } from "@/modules/planning/application/planning-commands";
import { createPlanningQueryService } from "@/modules/planning/application/planning-queries";
import {
  type BakeCycleStatus,
  type BakeCycleInput,
  createCycleService,
} from "./cycles";

const BASE_INPUT: BakeCycleInput = {
  name: "รอบส่ง 30 ส.ค.",
  orderCutoffAt: new Date("2026-08-27T12:00:00+07:00"),
  targetProductionDate: "2026-08-29",
  primaryDeliveryDate: "2026-08-30",
  notes: "",
};

describe("cycle service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createCycleService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createCycleService(context.db);
  });

  afterEach(async () => context.close());

  it("locks the owned cycle row before changing its status", async () => {
    const queries: string[] = [];
    await context.close();
    context = await createTestDatabase({
      logger: {
        logQuery(query: string) {
          queries.push(query);
        },
      } satisfies Logger,
    });
    service = createCycleService(context.db);
    const cycle = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      status: "OPEN",
    });

    queries.length = 0;
    await service.changeStatus(OWNER_ID, cycle.id, "CANCELLED");

    expect(
      queries.some(
        (query) =>
          query.includes('from "bake_cycles"') &&
          query.toLowerCase().includes("for update"),
      ),
    ).toBe(true);
  });

  it("creates numbered cycles and blocks Phase 3 locking", async () => {
    const first = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      status: "OPEN",
    });
    const second = await service.create(OWNER_ID, {
      name: "รอบส่ง 6 ก.ย.",
      status: "DRAFT",
      orderCutoffAt: null,
      targetProductionDate: "2026-09-05",
      primaryDeliveryDate: "2026-09-06",
      notes: "",
    });

    expect(first.status).toBe("OPEN");
    expect(second.cycleNumber).toBeGreaterThan(first.cycleNumber);
    await expect(service.changeStatus(OWNER_ID, first.id, "LOCKED"))
      .rejects.toThrow("Cycle locking belongs to Phase 3");
  });

  it("searches Thai names, owner-scopes lists, and orders newest delivery first", async () => {
    const earlier = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      name: "รอบส่งเชียงใหม่",
      primaryDeliveryDate: "2026-08-30",
      status: "OPEN",
    });
    const later = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      name: "รอบส่งเชียงใหม่พิเศษ",
      primaryDeliveryDate: "2026-09-06",
      status: "DRAFT",
    });
    const sameDateLater = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      name: "รอบส่งเชียงใหม่รอบสอง",
      primaryDeliveryDate: "2026-09-06",
      status: "OPEN",
    });
    await service.create(OTHER_OWNER_ID, {
      ...BASE_INPUT,
      name: "รอบส่งเชียงใหม่ของคนอื่น",
      primaryDeliveryDate: "2026-09-13",
      status: "OPEN",
    });

    expect(
      (await service.list(OWNER_ID, { query: "เชียงใหม่" })).map(
        (cycle) => cycle.id,
      ),
    ).toEqual([sameDateLater.id, later.id, earlier.id]);
    expect(await service.list(OWNER_ID, { status: "DRAFT" })).toEqual([
      expect.objectContaining({ id: later.id }),
    ]);
  });

  it.each(["DRAFT", "OPEN"] as const)(
    "updates metadata while a cycle is %s without changing status",
    async (status) => {
      const created = await service.create(OWNER_ID, {
        ...BASE_INPUT,
        status,
      });

      const updated = await service.update(OWNER_ID, created.id, {
        name: "รอบส่ง 30 ส.ค. (แก้ไข)",
        orderCutoffAt: null,
        targetProductionDate: "2026-08-28",
        primaryDeliveryDate: "2026-08-31",
        notes: "อบเช้ากว่าปกติ",
      });

      expect(updated).toMatchObject({
        id: created.id,
        ownerId: OWNER_ID,
        name: "รอบส่ง 30 ส.ค. (แก้ไข)",
        status,
        orderCutoffAt: null,
        targetProductionDate: "2026-08-28",
        primaryDeliveryDate: "2026-08-31",
        notes: "อบเช้ากว่าปกติ",
      });
    },
  );

  it.each([
    "LOCKED",
    "IN_PRODUCTION",
    "COMPLETED",
    "CANCELLED",
  ] as const)("rejects metadata edits while a cycle is %s", async (status) => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: `Frozen ${status}`,
        status,
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
        lockedAt:
          status === "LOCKED" || status === "IN_PRODUCTION"
            ? new Date("2026-08-28T00:00:00.000Z")
            : null,
      })
      .returning();
    const before = await service.get(OWNER_ID, cycle!.id);

    await expect(
      service.update(OWNER_ID, cycle!.id, {
        ...BASE_INPUT,
        name: "Must not change",
      }),
    ).rejects.toThrow("Cycle must be open for editing");
    expect(await service.get(OWNER_ID, cycle!.id)).toEqual(before);
  });

  it("enforces the complete explicit lifecycle transition map", async () => {
    const allowed: Readonly<
      Record<BakeCycleStatus, ReadonlyArray<BakeCycleStatus>>
    > = {
      DRAFT: ["OPEN", "CANCELLED"],
      OPEN: ["DRAFT", "CANCELLED"],
      LOCKED: ["IN_PRODUCTION", "CANCELLED"],
      IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
      COMPLETED: [],
      CANCELLED: [],
    };
    const manuallyReachableTargets = bakeCycleStatus.filter(
      (status) => status !== "LOCKED",
    );

    for (const current of bakeCycleStatus) {
      for (const target of manuallyReachableTargets) {
        const lockedAt =
          current === "LOCKED" || current === "IN_PRODUCTION"
            ? new Date("2026-08-28T00:00:00.000Z")
            : null;
        const [cycle] = await context.db
          .insert(bakeCycles)
          .values({
            ownerId: OWNER_ID,
            name: `${current} to ${target}`,
            status: current,
            targetProductionDate: "2026-08-29",
            primaryDeliveryDate: "2026-08-30",
            lockedAt,
          })
          .returning();

        if (allowed[current].includes(target)) {
          await expect(
            service.changeStatus(OWNER_ID, cycle!.id, target),
          ).resolves.toMatchObject({
            id: cycle!.id,
            status: target,
            lockedAt,
          });
        } else {
          await expect(
            service.changeStatus(OWNER_ID, cycle!.id, target),
          ).rejects.toThrow("Invalid cycle status transition");
          await expect(service.get(OWNER_ID, cycle!.id)).resolves.toMatchObject({
            status: current,
            lockedAt,
          });
        }
      }
    }
  });

  it.each([
    {
      source: "LOCKED",
      target: "CANCELLED",
      lockRequestId: "71717171-7171-4171-8171-717171717171",
    },
    {
      source: "IN_PRODUCTION",
      target: "COMPLETED",
      lockRequestId: "72727272-7272-4272-8272-727272727272",
    },
    {
      source: "IN_PRODUCTION",
      target: "CANCELLED",
      lockRequestId: "73737373-7373-4373-8373-737373737373",
    },
  ] as const)(
    "preserves the active planning generation across $source -> $target",
    async ({ source, target, lockRequestId }) => {
      const scenario = await seedPlanningScenario(context.db);
      const lockedAt = new Date("2026-08-29T00:00:00.000Z");
      const planningQueries = createPlanningQueryService(context.db, {
        now: () => new Date(lockedAt),
      });
      const preview = await planningQueries.preview(
        OWNER_ID,
        scenario.cycleId,
      );
      const locked = await createPlanningCommandService(context.db, {
        now: () => new Date(lockedAt),
      }).lock(OWNER_ID, {
        cycleId: scenario.cycleId,
        inputFingerprint: preview.inputFingerprint,
        lockRequestId,
        overrides: [],
      });
      if (source === "IN_PRODUCTION") {
        await service.changeStatus(
          OWNER_ID,
          scenario.cycleId,
          "IN_PRODUCTION",
        );
      }

      await expect(
        service.changeStatus(OWNER_ID, scenario.cycleId, target),
      ).resolves.toMatchObject({
        status: target,
        activePlanningSnapshotId: locked.id,
        lockedAt,
      });
      await expect(
        planningQueries.getGeneration(OWNER_ID, scenario.cycleId),
      ).resolves.toMatchObject({
        id: locked.id,
        generation: 1,
        status: "ACTIVE",
        lockedAt,
      });
    },
  );

  it("owner-scopes get, update, and status changes", async () => {
    const cycle = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      status: "OPEN",
    });

    await expect(service.get(OTHER_OWNER_ID, cycle.id)).rejects.toThrow(
      "Cycle not found",
    );
    await expect(
      service.update(OTHER_OWNER_ID, cycle.id, {
        ...BASE_INPUT,
        name: "Leaked update",
      }),
    ).rejects.toThrow("Cycle not found");
    await expect(
      service.changeStatus(OTHER_OWNER_ID, cycle.id, "CANCELLED"),
    ).rejects.toThrow("Cycle not found");
    await expect(service.get(OWNER_ID, cycle.id)).resolves.toMatchObject({
      name: BASE_INPUT.name,
      status: "OPEN",
    });
  });

  it("rejects invalid ISO calendar dates", async () => {
    await expect(
      service.create(OWNER_ID, {
        ...BASE_INPUT,
        status: "OPEN",
        targetProductionDate: "29/08/2026",
      }),
    ).rejects.toThrow("Invalid cycle");
    const cycle = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      status: "OPEN",
    });
    await expect(
      service.update(OWNER_ID, cycle.id, {
        ...BASE_INPUT,
        primaryDeliveryDate: "2026-02-30",
      }),
    ).rejects.toThrow("Invalid cycle");
  });
});
