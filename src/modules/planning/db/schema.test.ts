import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OTHER_OWNER_ID, OWNER_ID } from "@tests/fixtures/owner";
import { createTestDatabase } from "@tests/helpers/test-db";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  inventoryItems,
  inventoryPrices,
} from "@/modules/inventory/db/schema";
import {
  cycleCostSnapshots,
  cycleInventoryPriceSnapshots,
  cyclePlanningSnapshots,
  cyclePlanningWarnings,
} from "./schema";

type Cycle = typeof bakeCycles.$inferSelect;

function snapshotValues(
  cycle: Cycle,
  overrides: Partial<typeof cyclePlanningSnapshots.$inferInsert> = {},
): typeof cyclePlanningSnapshots.$inferInsert {
  return {
    ownerId: cycle.ownerId,
    bakeCycleId: cycle.id,
    generation: 1,
    status: "ACTIVE",
    lockRequestId: "11111111-1111-4111-8111-111111111111",
    inputFingerprint: "a".repeat(64),
    cycleNumber: cycle.cycleNumber,
    cycleName: cycle.name,
    targetProductionDate: cycle.targetProductionDate,
    primaryDeliveryDate: cycle.primaryDeliveryDate,
    laborRateSatangPerHour: 12000,
    defaultWasteAllowancePercent: "3",
    timezone: "Asia/Bangkok",
    currency: "THB",
    costComplete: false,
    lockedAt: new Date("2026-08-23T03:00:00Z"),
    ...overrides,
  };
}

describe("Phase 3A planning schema", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => context.close());

  it("allows one owner-scoped active generation with missing price data", async () => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบส่ง 30 ส.ค.",
        status: "OPEN",
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
      })
      .returning();
    const [snapshot] = await context.db
      .insert(cyclePlanningSnapshots)
      .values(snapshotValues(cycle!))
      .returning();
    const [item] = await context.db
      .insert(inventoryItems)
      .values({
        ownerId: OWNER_ID,
        name: "แป้ง",
        category: "INGREDIENT",
        baseUnit: "g",
        purchaseUnitLabel: "ถุง",
        baseQuantityPerPurchasePack: "1000",
      })
      .returning();
    const [price] = await context.db
      .insert(cycleInventoryPriceSnapshots)
      .values({
        ownerId: OWNER_ID,
        planningSnapshotId: snapshot!.id,
        inventoryItemId: item!.id,
        inventoryItemName: "แป้ง",
        inventoryCategory: "INGREDIENT",
        baseUnit: "g",
      })
      .returning();

    expect(price).toMatchObject({
      packPriceSatang: null,
      unitCostSatang: null,
    });
  });

  it("rejects a second active generation for the same owner and cycle", async () => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบล็อกซ้ำ",
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
      })
      .returning();

    await context.db
      .insert(cyclePlanningSnapshots)
      .values(snapshotValues(cycle!));

    await expect(
      context.db.insert(cyclePlanningSnapshots).values(
        snapshotValues(cycle!, {
          generation: 2,
          lockRequestId: "22222222-2222-4222-8222-222222222222",
          inputFingerprint: "b".repeat(64),
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects child and source references that cross the owner boundary", async () => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบเจ้าของหลัก",
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
      })
      .returning();
    const [snapshot] = await context.db
      .insert(cyclePlanningSnapshots)
      .values(snapshotValues(cycle!))
      .returning();
    const [ownerItem] = await context.db
      .insert(inventoryItems)
      .values({
        ownerId: OWNER_ID,
        name: "แป้งของร้านหลัก",
        category: "INGREDIENT",
        baseUnit: "g",
        purchaseUnitLabel: "ถุง",
        baseQuantityPerPurchasePack: "1000",
      })
      .returning();
    const [foreignItem] = await context.db
      .insert(inventoryItems)
      .values({
        ownerId: OTHER_OWNER_ID,
        name: "แป้งของร้านอื่น",
        category: "INGREDIENT",
        baseUnit: "g",
        purchaseUnitLabel: "ถุง",
        baseQuantityPerPurchasePack: "1000",
      })
      .returning();
    const [foreignPrice] = await context.db
      .insert(inventoryPrices)
      .values({
        ownerId: OTHER_OWNER_ID,
        inventoryItemId: foreignItem!.id,
        packPriceSatang: 5000,
        packBaseQuantity: "1000",
        effectiveAt: new Date("2026-08-22T03:00:00Z"),
      })
      .returning();

    await expect(
      context.db.insert(cyclePlanningWarnings).values({
        ownerId: OTHER_OWNER_ID,
        planningSnapshotId: snapshot!.id,
        code: "MISSING_PRICE",
        scope: "INVENTORY_ITEM",
        message: "ไม่พบราคาวัตถุดิบ",
      }),
    ).rejects.toThrow();

    await expect(
      context.db.insert(cycleInventoryPriceSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: snapshot!.id,
        inventoryItemId: ownerItem!.id,
        inventoryItemName: ownerItem!.name,
        inventoryCategory: ownerItem!.category,
        baseUnit: ownerItem!.baseUnit,
        sourcePriceId: foreignPrice!.id,
        packPriceSatang: foreignPrice!.packPriceSatang,
        packBaseQuantity: foreignPrice!.packBaseQuantity,
        effectiveAt: foreignPrice!.effectiveAt,
        unitCostSatang: "5",
      }),
    ).rejects.toThrow();
  });

  it("keeps a recorded zero price distinct from missing price data", async () => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบราคาศูนย์",
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
      })
      .returning();
    const [snapshot] = await context.db
      .insert(cyclePlanningSnapshots)
      .values(snapshotValues(cycle!))
      .returning();
    const [item] = await context.db
      .insert(inventoryItems)
      .values({
        ownerId: OWNER_ID,
        name: "กล่องตัวอย่างฟรี",
        category: "PACKAGING",
        baseUnit: "piece",
        purchaseUnitLabel: "แพ็ก",
        baseQuantityPerPurchasePack: "100",
      })
      .returning();
    const [sourcePrice] = await context.db
      .insert(inventoryPrices)
      .values({
        ownerId: OWNER_ID,
        inventoryItemId: item!.id,
        packPriceSatang: 0,
        packBaseQuantity: "100",
        effectiveAt: new Date("2026-08-22T03:00:00Z"),
      })
      .returning();
    const [price] = await context.db
      .insert(cycleInventoryPriceSnapshots)
      .values({
        ownerId: OWNER_ID,
        planningSnapshotId: snapshot!.id,
        inventoryItemId: item!.id,
        inventoryItemName: item!.name,
        inventoryCategory: item!.category,
        baseUnit: item!.baseUnit,
        sourcePriceId: sourcePrice!.id,
        packPriceSatang: 0,
        packBaseQuantity: "100",
        effectiveAt: sourcePrice!.effectiveAt,
        unitCostSatang: "0",
      })
      .returning();

    expect(price).toMatchObject({
      sourcePriceId: sourcePrice!.id,
      packPriceSatang: 0,
      unitCostSatang: "0.000000000000",
    });
  });

  it("requires complete unlock metadata only on superseded generations", async () => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบประวัติ",
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
      })
      .returning();

    await expect(
      context.db.insert(cyclePlanningSnapshots).values(
        snapshotValues(cycle!, {
          status: "SUPERSEDED",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      context.db.insert(cyclePlanningSnapshots).values(
        snapshotValues(cycle!, {
          lockRequestId: "22222222-2222-4222-8222-222222222222",
          unlockedAt: new Date("2026-08-23T04:00:00Z"),
          unlockReason: "ต้องแก้ออเดอร์",
          unlockedFromStatus: "LOCKED",
        }),
      ),
    ).rejects.toThrow();

    const [superseded] = await context.db
      .insert(cyclePlanningSnapshots)
      .values(
        snapshotValues(cycle!, {
          status: "SUPERSEDED",
          lockRequestId: "33333333-3333-4333-8333-333333333333",
          unlockedAt: new Date("2026-08-23T04:00:00Z"),
          unlockReason: "ต้องแก้ออเดอร์",
          unlockedFromStatus: "LOCKED",
        }),
      )
      .returning();

    expect(superseded!.status).toBe("SUPERSEDED");
  });

  it("rejects an incomplete cycle cost with a non-null complete total", async () => {
    const [cycle] = await context.db
      .insert(bakeCycles)
      .values({
        ownerId: OWNER_ID,
        name: "รอบต้นทุนไม่ครบ",
        targetProductionDate: "2026-08-29",
        primaryDeliveryDate: "2026-08-30",
      })
      .returning();
    const [snapshot] = await context.db
      .insert(cyclePlanningSnapshots)
      .values(snapshotValues(cycle!))
      .returning();

    await expect(
      context.db.insert(cycleCostSnapshots).values({
        ownerId: OWNER_ID,
        planningSnapshotId: snapshot!.id,
        knownBaseIngredientCostSatang: 0,
        knownWasteCostSatang: 0,
        knownProductPackagingCostSatang: 0,
        knownDeliveryPackagingCostSatang: 0,
        laborCostSatang: 0,
        utilityCostSatang: 0,
        knownProductionCostSatang: 0,
        completeProductionCostSatang: 0,
        missingPriceCount: 1,
        costComplete: false,
      }),
    ).rejects.toThrow();
  });
});
