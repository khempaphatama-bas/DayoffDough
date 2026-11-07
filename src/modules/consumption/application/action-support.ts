import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";
import { inventoryItems, inventoryMovements } from "@/modules/inventory/db/schema";
import { consumptionOperations, consumptionRevisions, consumptionRevisionItems, cycleConsumptionContexts } from "../db/schema";
import { ConsumptionStateError, type ConsumptionActionState, type ConsumptionStateErrorKind } from "../domain/types";

type SafeFailure = Pick<ConsumptionActionState, "error" | "fieldErrors" | "stale" | "blockers">;
const MESSAGES: Readonly<Record<ConsumptionStateErrorKind, string>> = {
  NOT_FOUND: "ไม่พบข้อมูลการใช้สต๊อก",
  INVALID_INPUT: "กรุณาตรวจสอบข้อมูลการใช้สต๊อก",
  STALE_DATA: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด",
  INVALID_CYCLE_STATE: "สถานะรอบผลิตไม่อนุญาตให้บันทึกยอดใช้รายการนี้",
  STOCK_CHECK_REQUIRED: "กรุณายืนยันยอดนับสต๊อกในหน้าจัดซื้อของรอบก่อนเริ่มผลิต",
  PENDING_USE: "กรุณาบันทึกยอดใช้ในหน้าการใช้สต๊อกของรอบที่ค้างก่อนทำรายการต่อ",
  INSUFFICIENT_STOCK: "สต๊อกไม่เพียงพอ กรุณาตรวจสอบยอดใช้และยอดคงเหลือ",
  UNLOCK_BLOCKED: "ปลดล็อกไม่ได้ กรุณาตรวจสอบยอดใช้ที่ค้างและประวัติการใช้สต๊อกของรอบ",
  REQUEST_CONFLICT: "คำขอนี้เคยใช้กับข้อมูลอื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนลองใหม่",
};
function notFound(): never { throw new ConsumptionStateError("NOT_FOUND", "Consumption record not found"); }
function uniqueSorted(ids: readonly string[]) { return [...new Set(ids)].sort(); }

// Plain server-side application reads, not remotely callable Server Actions.
// Every caller must authenticate before constructing or using this support.
export function createConsumptionActionSupport(db: DatabaseClient) {
  return {
    async getCommittedTargets(ownerId: string, operationId: string): Promise<Readonly<{ cycleIds: readonly string[]; inventoryItemIds: readonly string[] }>> {
      const [receipt] = await db.select({ id: consumptionOperations.id, revisionIds: consumptionOperations.revisionIds, countMovementIds: consumptionOperations.countMovementIds })
        .from(consumptionOperations).where(and(eq(consumptionOperations.ownerId, ownerId), eq(consumptionOperations.id, operationId))).limit(1);
      if (!receipt) notFound();
      // Start at revisions, not revision items or the mutable current pointer:
      // explicitly empty revisions and superseded replay targets still have a Cycle.
      const revisions = receipt.revisionIds.length ? await db.select({ id: consumptionRevisions.id, cycleId: cycleConsumptionContexts.bakeCycleId })
        .from(consumptionRevisions).innerJoin(cycleConsumptionContexts, and(
          eq(cycleConsumptionContexts.ownerId, consumptionRevisions.ownerId), eq(cycleConsumptionContexts.id, consumptionRevisions.contextId),
        )).where(and(eq(consumptionRevisions.ownerId, ownerId), eq(consumptionRevisions.operationId, receipt.id), inArray(consumptionRevisions.id, receipt.revisionIds))) : [];
      if (revisions.length !== receipt.revisionIds.length) notFound();
      const revisionItems = revisions.length ? await db.select({ inventoryItemId: consumptionRevisionItems.inventoryItemId })
        .from(consumptionRevisionItems).where(and(eq(consumptionRevisionItems.ownerId, ownerId), inArray(consumptionRevisionItems.revisionId, revisions.map((row) => row.id)))) : [];
      const counts = receipt.countMovementIds.length ? await db.select({ inventoryItemId: inventoryMovements.inventoryItemId })
        .from(inventoryMovements).where(and(eq(inventoryMovements.ownerId, ownerId), eq(inventoryMovements.type, "COUNT"), inArray(inventoryMovements.id, receipt.countMovementIds))) : [];
      if (counts.length !== receipt.countMovementIds.length) notFound();
      return { cycleIds: uniqueSorted(revisions.map((row) => row.cycleId)), inventoryItemIds: uniqueSorted([...revisionItems, ...counts].map((row) => row.inventoryItemId)) };
    },

    async mapError(ownerId: string, error: unknown, sourceCycleId?: string): Promise<SafeFailure | null> {
      if (!(error instanceof ConsumptionStateError)) return null;
      // Never serialize error.message. IDs in details are filtered again under the
      // authenticated owner; sourceCycleId is only a candidate, never authority.
      const candidateCycleIds = uniqueSorted([
        ...(error.details.blockerCycleIds ?? []),
        ...(sourceCycleId && ["PENDING_USE", "STOCK_CHECK_REQUIRED", "UNLOCK_BLOCKED"].includes(error.kind) ? [sourceCycleId] : []),
      ]);
      const blockers = candidateCycleIds.length ? await db.select({ cycleId: bakeCycles.id, cycleName: bakeCycles.name })
        .from(bakeCycles).where(and(eq(bakeCycles.ownerId, ownerId), inArray(bakeCycles.id, candidateCycleIds))).orderBy(bakeCycles.id) : [];
      const shortages = error.kind === "INSUFFICIENT_STOCK" ? error.details.shortages ?? [] : [];
      const ownedItems = shortages.length ? await db.select({ id: inventoryItems.id, name: inventoryItems.name })
        .from(inventoryItems).where(and(eq(inventoryItems.ownerId, ownerId), inArray(inventoryItems.id, shortages.map((row) => row.inventoryItemId)))) : [];
      const fieldErrors: Record<string, string> = {};
      for (const item of ownedItems) {
        const shortage = shortages.find((row) => row.inventoryItemId === item.id)!;
        fieldErrors[`items.${item.id}.usedQuantity`] = `${item.name}: คงเหลือ ${shortage.availableQuantity} ต้องใช้ ${shortage.requiredQuantity}`;
      }
      return { error: MESSAGES[error.kind], fieldErrors, stale: error.kind === "STALE_DATA" || error.kind === "REQUEST_CONFLICT", blockers };
    },
  };
}
