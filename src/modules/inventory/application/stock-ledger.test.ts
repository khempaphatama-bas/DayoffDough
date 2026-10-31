import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { loadLockedStockLedger, readStockLedger } from "./stock-ledger";
import { lockOwnedInventoryItems } from "@/lib/db/row-locks";

const owner = "81000000-0000-4000-8000-000000000001";
const other = "81000000-0000-4000-8000-000000000002";
describe("applied stock ledger", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let item: string;
  const queries: string[] = [];
  beforeEach(async () => {
    fixture = await createTestDatabase({ logger: { logQuery(query) { queries.push(query); } } });
    const [row] = await fixture.db.insert(inventoryItems).values({ ownerId: owner, name: "Flour", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000" }).returning();
    item = row!.id;
    queries.length = 0;
  });
  afterEach(async () => fixture?.close());

  it("reads balance and applied tokens in one statement, scoped to owned requested items", async () => {
    expect(await readStockLedger(fixture.db, owner, [item])).toEqual([{ inventoryItemId: item, balance: "0", ledgerRevision: "0", countMovementId: null }]);
    expect(queries).toHaveLength(1);
    expect(await readStockLedger(fixture.db, other, [item])).toEqual([]);
    queries.length = 0;
    expect(await readStockLedger(fixture.db, owner, [])).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("advances COUNT → PURCHASE → zero COUNT by application order, not timestamps", async () => {
    const insert = async (type: "COUNT" | "PURCHASE", delta: string, date: string, countedQuantity: string | null) => {
      const [movement] = await fixture.db.insert(inventoryMovements).values({ ownerId: owner, inventoryItemId: item, type, quantityDeltaInBaseUnit: delta, countedQuantityInBaseUnit: countedQuantity, occurredAt: new Date(date) }).returning();
      return movement!.id;
    };
    const first = await insert("COUNT", "8", "2026-10-24", "8");
    expect(await readStockLedger(fixture.db, owner, [item])).toEqual([{ inventoryItemId: item, balance: "8", ledgerRevision: "1", countMovementId: first }]);
    await insert("PURCHASE", "2", "2026-10-24", null);
    expect(await readStockLedger(fixture.db, owner, [item])).toEqual([{ inventoryItemId: item, balance: "10", ledgerRevision: "2", countMovementId: first }]);
    const last = await insert("COUNT", "0", "2020-01-01", "10");
    await fixture.db.transaction(async (tx) => {
      await tx.select().from(inventoryItems).where(and(eq(inventoryItems.ownerId, owner), eq(inventoryItems.id, item))).for("update");
      expect(await loadLockedStockLedger(tx, owner, [item])).toEqual([{ inventoryItemId: item, balance: "10", ledgerRevision: "3", countMovementId: last }]);
    });
  });

  it.each(["read", "locked"])("%s keeps distinct item balances isolated from other owners' movements", async (mode) => {
    const [boxes, foreign] = await fixture.db.insert(inventoryItems).values([
      { ownerId: owner, name: "Boxes", category: "PACKAGING", baseUnit: "piece", purchaseUnitLabel: "pack", baseQuantityPerPurchasePack: "12" },
      { ownerId: other, name: "Foreign flour", category: "INGREDIENT", baseUnit: "g", purchaseUnitLabel: "bag", baseQuantityPerPurchasePack: "1000" },
    ]).returning();
    await fixture.db.insert(inventoryMovements).values([
      { ownerId: owner, inventoryItemId: item, type: "PURCHASE", quantityDeltaInBaseUnit: "150", occurredAt: new Date() },
      { ownerId: owner, inventoryItemId: boxes!.id, type: "PURCHASE", quantityDeltaInBaseUnit: "12", occurredAt: new Date() },
      { ownerId: other, inventoryItemId: foreign!.id, type: "PURCHASE", quantityDeltaInBaseUnit: "900", occurredAt: new Date() },
    ]);
    const result = mode === "read" ? await readStockLedger(fixture.db, owner, [item, boxes!.id, foreign!.id]) : await fixture.db.transaction(async (tx) => {
      await lockOwnedInventoryItems(tx, owner, [item, boxes!.id]);
      return loadLockedStockLedger(tx, owner, [item, boxes!.id, foreign!.id]);
    });
    expect(result.map((row) => ({ ...row })).sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId))).toEqual([
      { inventoryItemId: item, balance: "150", ledgerRevision: "1", countMovementId: null },
      { inventoryItemId: boxes!.id, balance: "12", ledgerRevision: "1", countMovementId: null },
    ].sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId)));
  });

  it("preserves exact signed and large SUM balances without the nonnegative input parser", async () => {
    await fixture.db.insert(inventoryMovements).values({ ownerId: owner, inventoryItemId: item, type: "CORRECTION", quantityDeltaInBaseUnit: "-999999999999.999999", occurredAt: new Date() });
    expect((await readStockLedger(fixture.db, owner, [item]))[0]!.balance).toBe("-999999999999.999999");
    await fixture.db.insert(inventoryMovements).values(Array.from({ length: 3 }, () => ({ ownerId: owner, inventoryItemId: item, type: "PURCHASE" as const, quantityDeltaInBaseUnit: "999999999999.999999", occurredAt: new Date() })));
    expect((await readStockLedger(fixture.db, owner, [item]))[0]!.balance).toBe("1999999999999.999998");
  });
});
