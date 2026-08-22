import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import {
  type BakeCycleInput,
  createCycleService,
  type Phase2CycleStatus,
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

  it("updates metadata without changing status", async () => {
    const created = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      status: "OPEN",
    });
    await service.changeStatus(OWNER_ID, created.id, "IN_PRODUCTION");

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
      status: "IN_PRODUCTION",
      orderCutoffAt: null,
      targetProductionDate: "2026-08-28",
      primaryDeliveryDate: "2026-08-31",
      notes: "อบเช้ากว่าปกติ",
    });
  });

  it("allows every Phase 2 status", async () => {
    const cycle = await service.create(OWNER_ID, {
      ...BASE_INPUT,
      status: "OPEN",
    });
    const statuses: ReadonlyArray<Phase2CycleStatus> = [
      "DRAFT",
      "OPEN",
      "IN_PRODUCTION",
      "COMPLETED",
      "CANCELLED",
    ];

    for (const status of statuses) {
      await expect(service.changeStatus(OWNER_ID, cycle.id, status)).resolves
        .toMatchObject({ id: cycle.id, status });
    }
  });

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
