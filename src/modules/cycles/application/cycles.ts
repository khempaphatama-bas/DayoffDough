import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { lockOwnedBakeCycle } from "@/lib/db/row-locks";
import { bakeCycles } from "@/modules/cycles/db/schema";
import {
  BAKE_CYCLE_STATUS_TRANSITIONS,
  bakeCycleStatus,
  type BakeCycle,
  type BakeCycleStatus,
} from "@/modules/cycles/domain/cycle-lifecycle";

export { BAKE_CYCLE_STATUS_TRANSITIONS } from "@/modules/cycles/domain/cycle-lifecycle";
export type {
  BakeCycle,
  BakeCycleStatus,
} from "@/modules/cycles/domain/cycle-lifecycle";

export type BakeCycleInput = Readonly<{
  name: string;
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string;
  notes?: string;
}>;

export type BakeCycleFilters = Readonly<{
  query?: string;
  status?: BakeCycleStatus;
}>;

const uuidSchema = z.string().uuid();
const cycleInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  orderCutoffAt: z.date().nullable(),
  targetProductionDate: z.iso.date(),
  primaryDeliveryDate: z.iso.date(),
  notes: z.string().trim().max(2000).optional(),
});
const cycleCreateSchema = cycleInputSchema.extend({
  status: z.enum(["DRAFT", "OPEN"]),
});
const bakeCycleStatusSchema = z.enum(bakeCycleStatus);
const cycleFiltersSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: bakeCycleStatusSchema.optional(),
});

function toBakeCycle(row: typeof bakeCycles.$inferSelect): BakeCycle {
  return {
    id: row.id,
    ownerId: row.ownerId,
    cycleNumber: row.cycleNumber,
    name: row.name,
    status: row.status,
    orderCutoffAt: row.orderCutoffAt,
    targetProductionDate: row.targetProductionDate,
    primaryDeliveryDate: row.primaryDeliveryDate,
    notes: row.notes,
    lockedAt: row.lockedAt,
    activePlanningSnapshotId: row.activePlanningSnapshotId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createCycleService(db: DatabaseClient) {
  return {
    async create(
      ownerId: string,
      input: BakeCycleInput & Readonly<{ status: "DRAFT" | "OPEN" }>,
    ): Promise<BakeCycle> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsed = cycleCreateSchema.safeParse(input);
      if (!parsedOwnerId.success || !parsed.success) {
        throw new Error("Invalid cycle");
      }
      const [row] = await db
        .insert(bakeCycles)
        .values({
          ownerId: parsedOwnerId.data,
          ...parsed.data,
          notes: parsed.data.notes ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to create cycle");
      return toBakeCycle(row);
    },

    async update(
      ownerId: string,
      cycleId: string,
      input: BakeCycleInput,
    ): Promise<BakeCycle> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      const parsed = cycleInputSchema.safeParse(input);
      if (!parsedOwnerId.success || !parsedCycleId.success || !parsed.success) {
        throw new Error("Invalid cycle");
      }
      return db.transaction(async (tx) => {
        const existing = await lockOwnedBakeCycle(
          tx,
          parsedOwnerId.data,
          parsedCycleId.data,
        );
        if (!existing) throw new Error("Cycle not found");
        if (existing.status !== "DRAFT" && existing.status !== "OPEN") {
          throw new Error("Cycle must be open for editing");
        }
        const [row] = await tx
          .update(bakeCycles)
          .set({
            ...parsed.data,
            notes: parsed.data.notes ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bakeCycles.ownerId, parsedOwnerId.data),
              eq(bakeCycles.id, parsedCycleId.data),
              eq(bakeCycles.status, existing.status),
            ),
          )
          .returning();
        if (!row) throw new Error("Cycle must be open for editing");
        return toBakeCycle(row);
      });
    },

    async changeStatus(
      ownerId: string,
      cycleId: string,
      status: BakeCycleStatus,
    ): Promise<BakeCycle> {
      if (status === "LOCKED") {
        throw new Error("Cycle locking belongs to Phase 3");
      }
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      const parsedStatus = bakeCycleStatusSchema.safeParse(status);
      if (
        !parsedOwnerId.success ||
        !parsedCycleId.success ||
        !parsedStatus.success
      ) {
        throw new Error("Invalid cycle status");
      }
      return db.transaction(async (tx) => {
        const existing = await lockOwnedBakeCycle(
          tx,
          parsedOwnerId.data,
          parsedCycleId.data,
        );
        if (!existing) throw new Error("Cycle not found");
        const allowed = BAKE_CYCLE_STATUS_TRANSITIONS[existing.status] as
          readonly BakeCycleStatus[];
        if (!allowed.includes(parsedStatus.data)) {
          throw new Error("Invalid cycle status transition");
        }

        const [row] = await tx
          .update(bakeCycles)
          .set({ status: parsedStatus.data, updatedAt: new Date() })
          .where(
            and(
              eq(bakeCycles.ownerId, parsedOwnerId.data),
              eq(bakeCycles.id, parsedCycleId.data),
              eq(bakeCycles.status, existing.status),
            ),
          )
          .returning();
        if (!row) throw new Error("Cycle not found");
        return toBakeCycle(row);
      });
    },

    async get(ownerId: string, cycleId: string): Promise<BakeCycle> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      if (!parsedOwnerId.success || !parsedCycleId.success) {
        throw new Error("Cycle not found");
      }
      const [row] = await db
        .select()
        .from(bakeCycles)
        .where(
          and(
            eq(bakeCycles.ownerId, parsedOwnerId.data),
            eq(bakeCycles.id, parsedCycleId.data),
          ),
        )
        .limit(1);
      if (!row) throw new Error("Cycle not found");
      return toBakeCycle(row);
    },

    async list(
      ownerId: string,
      filters: BakeCycleFilters = {},
    ): Promise<ReadonlyArray<BakeCycle>> {
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedFilters = cycleFiltersSchema.safeParse(filters);
      if (!parsedOwnerId.success || !parsedFilters.success) {
        throw new Error("Invalid cycle filters");
      }
      const query = parsedFilters.data.query;
      const rows = await db
        .select()
        .from(bakeCycles)
        .where(
          and(
            eq(bakeCycles.ownerId, parsedOwnerId.data),
            parsedFilters.data.status
              ? eq(bakeCycles.status, parsedFilters.data.status)
              : undefined,
            query ? ilike(bakeCycles.name, `%${query}%`) : undefined,
          ),
        )
        .orderBy(
          desc(bakeCycles.primaryDeliveryDate),
          desc(bakeCycles.cycleNumber),
        );
      return rows.map(toBakeCycle);
    },
  };
}
