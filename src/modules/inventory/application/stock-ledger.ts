import { and, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/types";
import type { LedgerExpectation } from "@/modules/consumption/domain/types";
import { inventoryLedgerStates, inventoryMovements } from "@/modules/inventory/db/schema";

export type StockLedgerState = LedgerExpectation & Readonly<{ balance: string }>;
type Tx = DatabaseTransaction;

function ledgerQuery(reader: Pick<DatabaseClient, "select">, ownerId: string, inventoryItemIds: readonly string[]) {
  // Correlated SUM keeps the snapshot of balance and tokens in one statement,
  // and leaves the outer metadata rows lockable (no GROUP BY on that query).
  return reader.select({
    inventoryItemId: inventoryLedgerStates.inventoryItemId,
    ledgerRevision: sql<string>`${inventoryLedgerStates.ledgerRevision}::text`,
    countMovementId: inventoryLedgerStates.latestCountMovementId,
    balance: sql<string>`trim_scale(coalesce((SELECT sum(${inventoryMovements.quantityDeltaInBaseUnit})
      FROM ${inventoryMovements}
      WHERE ${inventoryMovements.ownerId} = ${inventoryLedgerStates.ownerId}
        AND ${inventoryMovements.inventoryItemId} = ${inventoryLedgerStates.inventoryItemId}), 0))::text`,
  }).from(inventoryLedgerStates).where(and(
    eq(inventoryLedgerStates.ownerId, ownerId),
    inArray(inventoryLedgerStates.inventoryItemId, [...inventoryItemIds]),
  )).orderBy(inventoryLedgerStates.inventoryItemId);
}

export async function readStockLedger(
  reader: Pick<DatabaseClient, "select">,
  ownerId: string,
  inventoryItemIds: readonly string[],
): Promise<readonly StockLedgerState[]> {
  if (inventoryItemIds.length === 0) return [];
  return ledgerQuery(reader, ownerId, inventoryItemIds);
}

// Caller must already hold the owned inventory-item locks, in sorted ID order.
export async function loadLockedStockLedger(
  tx: Tx,
  ownerId: string,
  inventoryItemIds: readonly string[],
): Promise<readonly StockLedgerState[]> {
  if (inventoryItemIds.length === 0) return [];
  return ledgerQuery(tx, ownerId, inventoryItemIds).for("update", { of: inventoryLedgerStates });
}
