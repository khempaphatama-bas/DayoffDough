import { describe, expect, it } from "vitest";
import {
  buildCycleTaskDrafts,
  scheduleTaskAt,
  sortCycleTasks,
} from "./task-generation";
import type { CycleTaskDraft, ProductionTemplateSource } from "./types";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const cycleTemplate: ProductionTemplateSource = {
  id: "cycle-template",
  name: "งานทั้งรอบ",
  scope: "CYCLE",
  productId: null,
  active: true,
  activities: [
    {
      id: "cycle-activity",
      name: "จัดเตรียมครัว",
      offsetDaysFromDelivery: -1,
      defaultTime: "08:00",
      estimatedDurationMinutes: 30,
      sequence: 2,
      notes: "ตรวจอุปกรณ์",
    },
  ],
};

const productTemplateWithTwoActivities: ProductionTemplateSource = {
  id: "product-template",
  name: "งานฟอคคาเซีย",
  scope: "PRODUCT",
  productId: PRODUCT_ID,
  active: true,
  activities: [
    {
      id: "mix",
      name: "ผสมแป้ง",
      offsetDaysFromDelivery: -1,
      defaultTime: "22:30",
      estimatedDurationMinutes: 45,
      sequence: 1,
      notes: "พักแป้ง",
    },
    {
      id: "bake",
      name: "อบ",
      offsetDaysFromDelivery: 0,
      defaultTime: "06:00",
      estimatedDurationMinutes: 30,
      sequence: 2,
      notes: null,
    },
  ],
};

describe("scheduleTaskAt", () => {
  it("uses Bangkok calendar days before converting to UTC", () => {
    expect(
      scheduleTaskAt({
        primaryDeliveryDate: "2026-09-12",
        offsetDaysFromDelivery: -1,
        defaultTime: "22:30",
        timezone: "Asia/Bangkok",
      }).toISOString(),
    ).toBe("2026-09-11T15:30:00.000Z");
  });

  it.each([
    [-1, "2026-09-10T17:00:00.000Z"],
    [0, "2026-09-11T17:00:00.000Z"],
    [1, "2026-09-12T17:00:00.000Z"],
  ])("supports calendar offset %i", (offsetDaysFromDelivery, expected) => {
    expect(
      scheduleTaskAt({
        primaryDeliveryDate: "2026-09-12",
        offsetDaysFromDelivery,
        defaultTime: "00:00",
        timezone: "Asia/Bangkok",
      }).toISOString(),
    ).toBe(expected);
  });

  it.each([
    ["0001-01-01", 0, "10:00", "0001-01-01T03:00:00.000Z"],
    ["0099-12-31", 1, "08:30", "0100-01-01T01:30:00.000Z"],
  ])("keeps the literal low delivery year %s while validating and scheduling offsets", (primaryDeliveryDate, offsetDaysFromDelivery, defaultTime, expected) => {
    expect(
      scheduleTaskAt({
        primaryDeliveryDate,
        offsetDaysFromDelivery,
        defaultTime,
        timezone: "Asia/Bangkok",
      }).toISOString(),
    ).toBe(expected);
  });

  it.each([
    ["invalid date", { primaryDeliveryDate: "2026-02-29" }],
    ["non-canonical date", { primaryDeliveryDate: "2026-9-12" }],
    ["invalid time", { defaultTime: "24:00" }],
    ["non-canonical time", { defaultTime: "8:00" }],
    ["unsupported timezone", { timezone: "UTC" }],
  ])("rejects an %s", (_case, change) => {
    expect(() =>
      scheduleTaskAt({
        primaryDeliveryDate: "2026-09-12",
        offsetDaysFromDelivery: 0,
        defaultTime: "08:00",
        timezone: "Asia/Bangkok",
        ...change,
      }),
    ).toThrow();
  });
});

describe("buildCycleTaskDrafts", () => {
  it("creates one product task per activity and keeps decimal batch count", () => {
    const tasks = buildCycleTaskDrafts({
      primaryDeliveryDate: "2026-09-12",
      timezone: "Asia/Bangkok",
      templates: [productTemplateWithTwoActivities],
      products: [
        {
          productId: PRODUCT_ID,
          productName: "ฟอคคาเซีย",
          selectedBatchCount: "1.666667",
        },
      ],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.batchCount)).toEqual([
      "1.666667",
      "1.666667",
    ]);
  });

  it("expands a cycle activity once and product activities only for matching plans", () => {
    const tasks = buildCycleTaskDrafts({
      primaryDeliveryDate: "2026-09-12",
      timezone: "Asia/Bangkok",
      templates: [cycleTemplate, productTemplateWithTwoActivities],
      products: [
        {
          productId: PRODUCT_ID,
          productName: "ฟอคคาเซีย",
          selectedBatchCount: "1",
        },
        {
          productId: SECOND_PRODUCT_ID,
          productName: "บาแก็ต",
          selectedBatchCount: "2",
        },
      ],
    });

    expect(tasks).toHaveLength(3);
    expect(tasks.filter((task) => task.sourceTemplateScope === "CYCLE")).toEqual([
      expect.objectContaining({
        productId: null,
        productName: null,
        batchCount: null,
        sourceProductId: null,
      }),
    ]);
    expect(tasks.filter((task) => task.sourceTemplateScope === "PRODUCT")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: PRODUCT_ID,
          productName: "ฟอคคาเซีย",
          sourceProductName: "ฟอคคาเซีย",
        }),
      ]),
    );
  });

  it("keeps duplicate names as separate source rows", () => {
    const duplicateTemplate: ProductionTemplateSource = {
      ...productTemplateWithTwoActivities,
      id: "duplicate-template",
      activities: [
        {
          ...productTemplateWithTwoActivities.activities[0]!,
          id: "duplicate-activity",
        },
      ],
    };
    const tasks = buildCycleTaskDrafts({
      primaryDeliveryDate: "2026-09-12",
      timezone: "Asia/Bangkok",
      templates: [productTemplateWithTwoActivities, duplicateTemplate],
      products: [
        {
          productId: PRODUCT_ID,
          productName: "ฟอคคาเซีย",
          selectedBatchCount: "1",
        },
      ],
    });

    expect(tasks.filter((task) => task.sourceActivityName === "ผสมแป้ง")).toEqual([
      expect.objectContaining({ sourceTemplateId: "duplicate-template" }),
      expect.objectContaining({ sourceTemplateId: "product-template" }),
    ]);
  });
});

describe("sortCycleTasks", () => {
  it("orders drafts by schedule, sequence, product name, and stable source ids", () => {
    const scheduledAt = new Date("2026-09-11T15:30:00.000Z");
    const draft = (overrides: Partial<CycleTaskDraft>): CycleTaskDraft => ({
      origin: "TEMPLATE",
      sourceTemplateId: "template-b",
      sourceActivityId: "activity-b",
      sourceTemplateScope: "PRODUCT",
      sourceProductId: PRODUCT_ID,
      sourceTemplateName: "งาน",
      sourceActivityName: "กิจกรรม",
      sourceProductName: "ฟอคคาเซีย",
      title: "กิจกรรม",
      productId: PRODUCT_ID,
      productName: "ฟอคคาเซีย",
      batchCount: "1",
      scheduledAt,
      estimatedDurationMinutes: 10,
      notes: null,
      sequence: 1,
      status: "PENDING",
      skipReason: null,
      ...overrides,
    });
    const drafts = [
      draft({ sourceActivityId: "activity-z" }),
      draft({ sourceActivityId: "activity-a" }),
      draft({ productName: "บาแก็ต", sourceActivityId: "activity-m" }),
      draft({ sequence: 2, sourceActivityId: "activity-q" }),
      draft({ scheduledAt: new Date("2026-09-11T14:30:00.000Z") }),
    ];

    expect([...drafts].sort(sortCycleTasks).map((item) => item.sourceActivityId)).toEqual([
      "activity-b",
      "activity-m",
      "activity-a",
      "activity-z",
      "activity-q",
    ]);
  });
});
