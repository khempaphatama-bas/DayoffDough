import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient, DatabaseTransaction } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { inventoryItems } from "@/modules/inventory/db/schema";
import type { PlanningGenerationSummary } from "@/modules/planning/application/planning-queries";
import { cyclePlanningSnapshots } from "@/modules/planning/db/schema";
import { StorageDecimal } from "@/modules/shopping/domain/storage";
import type { StockRequirementCategory } from "@/modules/shopping/domain/types";
import type { UnitCode } from "@/modules/units/domain/units";
import { consumptionRevisionItems, consumptionRevisions, cycleConsumptionContexts, cycleConsumptionItems } from "../db/schema";
import { calculateUseEffect, canonicalQuantity } from "../domain/rules";
import { ConsumptionStateError, type ConsumptionContextView, type ConsumptionCycleHeader,
  type ConsumptionRequirement, type ConsumptionRevisionView, type ConsumptionStockView,
  type ConsumptionUsageItemView, type CycleConsumptionView, type LedgerExpectation, type SettlementPreview } from "../domain/types";
import { findPendingConsumption } from "./count-barrier";
import { loadConsumptionSource } from "./load-consumption-source";

type Tx = DatabaseTransaction;
type Cycle = typeof bakeCycles.$inferSelect;
type Snapshot = typeof cyclePlanningSnapshots.$inferSelect;
type Context = typeof cycleConsumptionContexts.$inferSelect;
const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const snapshotOptions = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

function notFound(): never {
  throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found");
}

function toCycle(cycle: Cycle, snapshot: Snapshot | null): ConsumptionCycleHeader {
  return { cycleId: cycle.id, cycleNumber: snapshot?.cycleNumber ?? cycle.cycleNumber,
    cycleName: snapshot?.cycleName ?? cycle.name, cycleStatus: cycle.status,
    consumptionPolicy: cycle.consumptionPolicy, planningSnapshotId: snapshot?.id ?? null,
    generation: snapshot?.generation ?? null, planningStatus: snapshot?.status ?? null };
}

function toGeneration(row: Snapshot): PlanningGenerationSummary {
  return { id: row.id, cycleId: row.bakeCycleId, generation: row.generation, status: row.status,
    costComplete: row.costComplete, lockedAt: row.lockedAt, unlockedAt: row.unlockedAt,
    unlockReason: row.unlockReason, unlockedFromStatus: row.unlockedFromStatus === "LOCKED" || row.unlockedFromStatus === "IN_PRODUCTION" ? row.unlockedFromStatus : null };
}

function toContext(row: Context): ConsumptionContextView {
  return { id: row.id, taskGenerationId: row.taskGenerationId, currentRevisionId: row.currentRevisionId, createdAt: row.createdAt };
}

function toRequirement(row: typeof cycleConsumptionItems.$inferSelect): ConsumptionRequirement {
  return { inventoryItemId: row.inventoryItemId, inventoryItemName: row.inventoryItemName,
    inventoryCategory: row.inventoryCategory as StockRequirementCategory, baseUnit: row.baseUnit as UnitCode,
    priceSnapshotId: row.priceSnapshotId, plannedQuantity: canonicalQuantity(row.plannedQuantity) };
}

function toExpectations(stock: readonly ConsumptionStockView[]): readonly LedgerExpectation[] {
  return stock.map(({ inventoryItemId, ledgerRevision, countMovementId }) => ({ inventoryItemId, ledgerRevision, countMovementId }));
}

// One batch per immutable table for the whole context set. No live master labels,
// recipe recomputation, or per-context/per-revision ledger lookups.
async function readContexts(tx: Tx, ownerId: string, contexts: readonly Context[]) {
  const contextIds = contexts.map((context) => context.id);
  const requirements = new Map<string, ConsumptionRequirement[]>();
  const history = new Map<string, ConsumptionRevisionView[]>();
  if (!contextIds.length) return { requirements, history };
  const [itemRows, revisions, revisionItems] = await Promise.all([
    tx.select().from(cycleConsumptionItems).where(and(eq(cycleConsumptionItems.ownerId, ownerId),
      inArray(cycleConsumptionItems.contextId, contextIds))).orderBy(cycleConsumptionItems.contextId, cycleConsumptionItems.inventoryItemId),
    tx.select().from(consumptionRevisions).where(and(eq(consumptionRevisions.ownerId, ownerId),
      inArray(consumptionRevisions.contextId, contextIds))).orderBy(consumptionRevisions.contextId, consumptionRevisions.revisionNumber),
    tx.select().from(consumptionRevisionItems).where(and(eq(consumptionRevisionItems.ownerId, ownerId),
      inArray(consumptionRevisionItems.contextId, contextIds))).orderBy(consumptionRevisionItems.revisionId, consumptionRevisionItems.inventoryItemId),
  ]);
  for (const row of itemRows) {
    const items = requirements.get(row.contextId) ?? [];
    items.push(toRequirement(row));
    requirements.set(row.contextId, items);
  }
  const itemsByRevision = new Map<string, typeof revisionItems>();
  for (const item of revisionItems) {
    const items = itemsByRevision.get(item.revisionId) ?? [];
    items.push(item);
    itemsByRevision.set(item.revisionId, items);
  }
  for (const revision of revisions) {
    const source = requirements.get(revision.contextId) ?? [];
    const rows = history.get(revision.contextId) ?? [];
    rows.push({ id: revision.id, contextId: revision.contextId, operationId: revision.operationId,
      revisionNumber: revision.revisionNumber, previousRevisionId: revision.previousRevisionId,
      reason: revision.reason, confirmedAt: revision.confirmedAt,
      items: (itemsByRevision.get(revision.id) ?? []).map((item) => {
        const requirement = source.find((row) => row.inventoryItemId === item.inventoryItemId);
        if (!requirement) notFound();
        return { ...requirement, usedQuantity: canonicalQuantity(item.usedQuantity), basis: item.basis,
          reason: item.reason, mode: item.mode, quantityDelta: new StorageDecimal(item.quantityDelta).toFixed(),
          initialCountMovementId: item.initialCountMovementId, movementId: item.movementId,
          settlementCountMovementId: item.settlementCountMovementId };
      }),
    });
    history.set(revision.contextId, rows);
  }
  return { requirements, history };
}

function draftItems(requirements: readonly ConsumptionRequirement[], cycle: Cycle,
  current: ConsumptionRevisionView | null, stock: readonly ConsumptionStockView[],
  countedItemIds: readonly string[] = []): readonly ConsumptionUsageItemView[] {
  return requirements.map((requirement) => {
    const previous = current?.items.find((item) => item.inventoryItemId === requirement.inventoryItemId);
    const usedQuantity = previous?.usedQuantity ?? (cycle.status === "CANCELLED" ? null : requirement.plannedQuantity);
    const countSettled = countedItemIds.includes(requirement.inventoryItemId);
    const ledger = stock.find((row) => row.inventoryItemId === requirement.inventoryItemId);
    if (!ledger) notFound();
    const effect = usedQuantity === null
      ? { mode: countSettled ? "COUNT_SETTLED" as const : "DIRECT" as const, delta: countSettled ? "0" : null }
      : calculateUseEffect({ previousUsed: previous?.usedQuantity ?? null, newUsed: usedQuantity,
        initialCountMovementId: previous?.initialCountMovementId ?? null,
        currentCountMovementId: ledger.countMovementId, countSettled });
    return { ...requirement, usedQuantity, basis: previous?.basis ?? (cycle.status === "CANCELLED" ? "OWNER_REPORTED" : "PLANNED"),
      reason: previous?.reason ?? null, mode: effect.mode, quantityDelta: effect.delta };
  });
}

async function readOwnedStock(tx: Tx, ownerId: string, itemIds: readonly string[]) {
  const stock = await readStockLedger(tx, ownerId, itemIds);
  if (stock.length !== itemIds.length) notFound();
  // Preserve the exact signed/large historical SUM string from the ledger reader.
  return stock;
}

export function createConsumptionQueryService(db: DatabaseClient) {
  return {
    async getCycleConsumption(ownerId: string, cycleId: string, generation?: number): Promise<CycleConsumptionView> {
      const owner = uuidSchema.safeParse(ownerId);
      const id = uuidSchema.safeParse(cycleId);
      if (!owner.success || !id.success || (generation !== undefined && (!Number.isSafeInteger(generation) || generation <= 0))) notFound();
      return db.transaction(async (tx): Promise<CycleConsumptionView> => {
        const [cycle] = await tx.select().from(bakeCycles).where(and(eq(bakeCycles.ownerId, owner.data), eq(bakeCycles.id, id.data))).limit(1);
        if (!cycle) notFound();
        const snapshots = await tx.select().from(cyclePlanningSnapshots).where(and(eq(cyclePlanningSnapshots.ownerId, owner.data),
          eq(cyclePlanningSnapshots.bakeCycleId, cycle.id))).orderBy(desc(cyclePlanningSnapshots.generation));
        const snapshot = generation === undefined ? snapshots.find((row) => row.id === cycle.activePlanningSnapshotId) : snapshots.find((row) => row.generation === generation);
        if ((generation !== undefined || cycle.activePlanningSnapshotId !== null) && !snapshot) notFound();
        const base = { cycle: toCycle(cycle, snapshot ?? null), generations: snapshots.map(toGeneration), source: null, context: null,
          currentRevision: null, history: [], requirements: [], items: [], stock: [], expectedLedger: [] };
        if (cycle.consumptionPolicy === "LEGACY") return { ...base, kind: "LEGACY", canConfirm: false, canCorrect: false };
        if (!snapshot) return { ...base, kind: "NO_PLAN", canConfirm: false, canCorrect: false };
        const [context] = await tx.select().from(cycleConsumptionContexts).where(and(eq(cycleConsumptionContexts.ownerId, owner.data),
          eq(cycleConsumptionContexts.bakeCycleId, cycle.id), eq(cycleConsumptionContexts.planningSnapshotId, snapshot.id))).limit(1);
        const projection = await readContexts(tx, owner.data, context ? [context] : []);
        const requirements = context ? projection.requirements.get(context.id) ?? [] : await loadConsumptionSource(tx, owner.data, snapshot.id);
        const stock = await readOwnedStock(tx, owner.data, requirements.map((item) => item.inventoryItemId));
        const history = context ? projection.history.get(context.id) ?? [] : [];
        const currentRevision = history.find((revision) => revision.id === context?.currentRevisionId) ?? null;
        if (context?.currentRevisionId && !currentRevision) notFound();
        const data = { ...base, requirements, stock, history, currentRevision,
          context: context ? toContext(context) : null,
          source: context ? { cycleId: cycle.id, planningSnapshotId: snapshot.id, contextId: context.id } : null,
          expectedLedger: toExpectations(stock), items: draftItems(requirements, cycle, currentRevision, stock) };
        const active = snapshot.status === "ACTIVE" && cycle.activePlanningSnapshotId === snapshot.id;
        if (!active) return { ...data, kind: "HISTORY", canConfirm: false, canCorrect: false };
        if (!context) return { ...data, kind: "NOT_STARTED", canConfirm: false, canCorrect: false };
        if (currentRevision) return { ...data, kind: "RECORDED", canConfirm: false, canCorrect: ["IN_PRODUCTION", "COMPLETED", "CANCELLED"].includes(cycle.status) };
        return { ...data, kind: "PENDING_USE", canConfirm: ["IN_PRODUCTION", "CANCELLED"].includes(cycle.status), canCorrect: false };
      }, snapshotOptions);
    },

    async getSettlementPreview(ownerId: string, countedItemIds: readonly string[]): Promise<SettlementPreview> {
      const owner = uuidSchema.safeParse(ownerId);
      const ids = z.array(uuidSchema).safeParse(countedItemIds);
      if (!owner.success || !ids.success || new Set(ids.data).size !== ids.data.length) notFound();
      if (!ids.data.length) throw new ConsumptionStateError("INVALID_INPUT", "Select stock items to count");
      const counted = [...ids.data].sort();
      return db.transaction(async (tx): Promise<SettlementPreview> => {
        const owned = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.ownerId, owner.data), inArray(inventoryItems.id, counted)));
        if (owned.length !== counted.length) notFound();
        // Closure is deliberately discovered ONLY from selected COUNT items.
        const pending = await findPendingConsumption(tx, owner.data, counted);
        const rows = pending.length ? await tx.select({ context: cycleConsumptionContexts, cycle: bakeCycles, snapshot: cyclePlanningSnapshots })
          .from(cycleConsumptionContexts).innerJoin(bakeCycles, and(eq(bakeCycles.ownerId, cycleConsumptionContexts.ownerId), eq(bakeCycles.id, cycleConsumptionContexts.bakeCycleId)))
          .innerJoin(cyclePlanningSnapshots, and(eq(cyclePlanningSnapshots.ownerId, cycleConsumptionContexts.ownerId),
            eq(cyclePlanningSnapshots.bakeCycleId, cycleConsumptionContexts.bakeCycleId), eq(cyclePlanningSnapshots.id, cycleConsumptionContexts.planningSnapshotId)))
          .where(and(eq(cycleConsumptionContexts.ownerId, owner.data), inArray(cycleConsumptionContexts.id, pending.map((row) => row.contextId))))
          .orderBy(bakeCycles.id, cycleConsumptionContexts.id) : [];
        if (rows.length !== pending.length) notFound();
        const projection = await readContexts(tx, owner.data, rows.map((row) => row.context));
        const touched = [...new Set([...counted, ...[...projection.requirements.values()].flat().map((item) => item.inventoryItemId)])].sort();
        const stock = await readOwnedStock(tx, owner.data, touched);
        return { countedItemIds: counted, counts: counted.map((inventoryItemId) => ({ inventoryItemId, remainingQuantity: null, mode: "COUNT", quantityDelta: null })),
          contexts: rows.map(({ context, cycle, snapshot }) => ({ source: { cycleId: cycle.id, planningSnapshotId: snapshot.id, contextId: context.id },
            cycle: toCycle(cycle, snapshot), context: toContext(context),
            items: draftItems(projection.requirements.get(context.id) ?? [], cycle, null, stock, counted) })),
          stock, expectedLedger: toExpectations(stock) };
      }, snapshotOptions);
    },
  };
}
