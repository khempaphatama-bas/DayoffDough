import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { products } from "@/modules/products/db/schema";
import {
  createProductionTemplateService,
  TemplateStateError,
  TemplateValidationError,
} from "./template-service";
import {
  productionTemplateActivities,
  productionTemplates,
} from "../db/schema";
import type { ProductionTemplateInput } from "../domain/types";

const PRODUCT_ID = "61000000-0000-4000-8000-000000000001";
const OTHER_PRODUCT_ID = "61000000-0000-4000-8000-000000000002";
const INACTIVE_PRODUCT_ID = "61000000-0000-4000-8000-000000000003";
const FIXED_NOW = new Date("2026-09-12T03:00:00.000Z");

function activity(): ProductionTemplateInput["activities"][number] {
  return {
    id: null,
    name: "  เตรียมอุปกรณ์  ",
    offsetDaysFromDelivery: -1,
    defaultTime: "08:00",
    estimatedDurationMinutes: 30,
    sequence: 1,
    notes: "  ตรวจเตา  ",
    active: true,
  };
}

function cycleInput(
  overrides: Partial<ProductionTemplateInput> = {},
): ProductionTemplateInput {
  return {
    name: "  เตรียมรอบผลิต  ",
    scope: "CYCLE",
    productId: null,
    activities: [activity()],
    ...overrides,
  };
}

function productInput(
  overrides: Partial<ProductionTemplateInput> = {},
): ProductionTemplateInput {
  return {
    ...cycleInput(),
    name: "  ฟอคคาเซีย  ",
    scope: "PRODUCT",
    productId: PRODUCT_ID,
    ...overrides,
  };
}

describe("production template service", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: ReturnType<typeof createProductionTemplateService>;

  beforeEach(async () => {
    context = await createTestDatabase();
    service = createProductionTemplateService(context.db, { now: () => FIXED_NOW });
    await context.db.insert(products).values([
      {
        id: PRODUCT_ID,
        ownerId: OWNER_ID,
        name: "ฟอคคาเซีย",
        sellingUnit: "piece",
        defaultUnitPriceSatang: 22000,
      },
      {
        id: OTHER_PRODUCT_ID,
        ownerId: OTHER_OWNER_ID,
        name: "Foreign product",
        sellingUnit: "piece",
        defaultUnitPriceSatang: 22000,
      },
      {
        id: INACTIVE_PRODUCT_ID,
        ownerId: OWNER_ID,
        name: "สินค้าหยุดขาย",
        sellingUnit: "piece",
        defaultUnitPriceSatang: 22000,
        active: false,
      },
    ]);
  });

  afterEach(async () => context.close());

  it("lists owner-scoped templates and active products that lack a ready template", async () => {
    const template = await service.create(OWNER_ID, productInput());
    await service.setActive(OWNER_ID, template.id, true);
    await context.db.insert(products).values({
      id: "61000000-0000-4000-8000-000000000004",
      ownerId: OWNER_ID,
      name: "ครัวซองต์",
      sellingUnit: "piece",
      defaultUnitPriceSatang: 25000,
    });
    await service.create(OTHER_OWNER_ID, {
      ...productInput({ productId: OTHER_PRODUCT_ID }),
      name: "Foreign template",
    });

    const listed = await service.list(OWNER_ID);

    expect(listed.cycleTemplates).toEqual([]);
    expect(listed.productTemplates).toEqual([
      expect.objectContaining({
        id: template.id,
        name: "ฟอคคาเซีย",
        productId: PRODUCT_ID,
        productName: "ฟอคคาเซีย",
        active: true,
        activeActivityCount: 1,
      }),
    ]);
    expect(listed.productsMissingReadyTemplate).toEqual([
      { id: "61000000-0000-4000-8000-000000000004", name: "ครัวซองต์" },
    ]);
  });

  it("returns activities in stable sequence order", async () => {
    const template = await service.create(
      OWNER_ID,
      cycleInput({
        activities: [
          { ...activity(), name: "ลำดับสอง", sequence: 2 },
          { ...activity(), name: "ลำดับหนึ่ง", sequence: 1 },
        ],
      }),
    );

    const detail = await service.get(OWNER_ID, template.id);

    expect(detail.activities.map((activity) => activity.name)).toEqual([
      "ลำดับหนึ่ง",
      "ลำดับสอง",
    ]);
  });

  it("rejects product templates for a foreign or inactive product before writing", async () => {
    await expect(
      service.create(OWNER_ID, productInput({ productId: OTHER_PRODUCT_ID })),
    ).rejects.toBeInstanceOf(TemplateValidationError);
    await expect(
      service.create(OWNER_ID, productInput({ productId: INACTIVE_PRODUCT_ID })),
    ).rejects.toBeInstanceOf(TemplateValidationError);

    const rows = await context.db
      .select()
      .from(productionTemplates)
      .where(eq(productionTemplates.ownerId, OWNER_ID));
    expect(rows).toEqual([]);
  });

  it("does not disclose or mutate another owner's template", async () => {
    const foreignTemplate = await service.create(
      OTHER_OWNER_ID,
      productInput({ productId: OTHER_PRODUCT_ID }),
    );

    await expect(service.get(OWNER_ID, foreignTemplate.id)).rejects.toBeInstanceOf(
      TemplateStateError,
    );
    await expect(
      service.update(OWNER_ID, foreignTemplate.id, cycleInput()),
    ).rejects.toBeInstanceOf(TemplateStateError);
    await expect(service.duplicate(OWNER_ID, foreignTemplate.id)).rejects.toBeInstanceOf(
      TemplateStateError,
    );
  });

  it("archives removed activities without deleting lineage rows", async () => {
    const template = await service.create(
      OWNER_ID,
      cycleInput({
        activities: [
          { ...activity(), name: "เก็บไว้เป็น lineage", sequence: 1 },
          { ...activity(), name: "ยังใช้งาน", sequence: 2 },
        ],
      }),
    );
    const firstActivity = template.activities[0]!;
    const secondActivity = template.activities[1]!;

    await service.update(OWNER_ID, template.id, {
      ...cycleInput(),
      activities: [{ ...secondActivity, name: "ยังใช้งาน" }],
    });

    const rows = await context.db
      .select()
      .from(productionTemplateActivities)
      .where(
        and(
          eq(productionTemplateActivities.ownerId, OWNER_ID),
          eq(productionTemplateActivities.productionTemplateId, template.id),
        ),
      );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstActivity.id, active: false }),
        expect.objectContaining({ id: secondActivity.id, active: true }),
      ]),
    );
  });

  it("rejects activity ids that belong to a different template", async () => {
    const first = await service.create(OWNER_ID, cycleInput());
    const second = await service.create(OWNER_ID, cycleInput({ name: "อีกชุด" }));

    await expect(
      service.update(OWNER_ID, second.id, {
        ...cycleInput({ name: "อีกชุด" }),
        activities: [{ ...first.activities[0]!, name: "ย้ายผิดชุด" }],
      }),
    ).rejects.toBeInstanceOf(TemplateValidationError);
  });

  it("does not archive the last active activity from an active template", async () => {
    const template = await service.create(OWNER_ID, cycleInput());
    await service.setActive(OWNER_ID, template.id, true);

    await expect(
      service.update(OWNER_ID, template.id, {
        ...cycleInput(),
        activities: [{ ...template.activities[0]!, active: false }],
      }),
    ).rejects.toBeInstanceOf(TemplateStateError);

    await expect(service.get(OWNER_ID, template.id)).resolves.toMatchObject({
      active: true,
      activities: [expect.objectContaining({ id: template.activities[0]!.id, active: true })],
    });
  });

  it("duplicates every activity with fresh ids and leaves the copy inactive", async () => {
    const original = await service.create(
      OWNER_ID,
      cycleInput({
        activities: [
          { ...activity(), name: "ขั้นตอนแรก", sequence: 1 },
          { ...activity(), name: "ขั้นตอนเก่า", sequence: 2, active: false },
        ],
      }),
    );

    const copy = await service.duplicate(OWNER_ID, original.id);

    expect(copy).toMatchObject({
      name: "เตรียมรอบผลิต สำเนา",
      active: false,
    });
    expect(copy.id).not.toBe(original.id);
    expect(copy.activities.map((activity) => activity.id)).not.toEqual(
      original.activities.map((activity) => activity.id),
    );
    expect(copy.activities.map((activity) => activity.active)).toEqual([true, false]);
  });

  it("does not activate a template without an active activity", async () => {
    const template = await service.create(
      OWNER_ID,
      cycleInput({ activities: [{ ...activity(), active: false }] }),
    );

    await expect(service.setActive(OWNER_ID, template.id, true)).rejects.toBeInstanceOf(
      TemplateStateError,
    );
    await expect(service.get(OWNER_ID, template.id)).resolves.toMatchObject({ active: false });
  });

  it("activates the selected product template and deactivates the previous one atomically", async () => {
    const first = await service.create(OWNER_ID, productInput());
    const second = await service.create(
      OWNER_ID,
      productInput({ name: "ฟอคคาเซีย เวอร์ชันใหม่" }),
    );

    await service.setActive(OWNER_ID, first.id, true);
    await service.setActive(OWNER_ID, second.id, true);

    await expect(service.get(OWNER_ID, first.id)).resolves.toMatchObject({ active: false });
    await expect(service.get(OWNER_ID, second.id)).resolves.toMatchObject({ active: true });
  });
});
