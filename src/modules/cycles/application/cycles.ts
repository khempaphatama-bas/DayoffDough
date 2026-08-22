import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { bakeCycles } from "@/modules/cycles/db/schema";

export type Phase2CycleStatus =
  | "DRAFT"
  | "OPEN"
  | "IN_PRODUCTION"
  | "COMPLETED"
  | "CANCELLED";

export type BakeCycleInput = Readonly<{
  name: string;
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string;
  notes?: string;
}>;

export type BakeCycle = Readonly<{
  id: string;
  ownerId: string;
  cycleNumber: number;
  name: string;
  status: Phase2CycleStatus;
  orderCutoffAt: Date | null;
  targetProductionDate: string;
  primaryDeliveryDate: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type BakeCycleFilters = Readonly<{
  query?: string;
  status?: Phase2CycleStatus;
}>;

const PHASE_2_STATUSES = [
  "DRAFT",
  "OPEN",
  "IN_PRODUCTION",
  "COMPLETED",
  "CANCELLED",
] as const satisfies ReadonlyArray<Phase2CycleStatus>;

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
const phase2StatusSchema = z.enum(PHASE_2_STATUSES);
const cycleFiltersSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: phase2StatusSchema.optional(),
});

function toBakeCycle(row: typeof bakeCycles.$inferSelect): BakeCycle {
  return {
    id: row.id,
    ownerId: row.ownerId,
    cycleNumber: row.cycleNumber,
    name: row.name,
    status: row.status as Phase2CycleStatus,
    orderCutoffAt: row.orderCutoffAt,
    targetProductionDate: row.targetProductionDate,
    primaryDeliveryDate: row.primaryDeliveryDate,
    notes: row.notes,
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
      const [row] = await db
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
          ),
        )
        .returning();
      if (!row) throw new Error("Cycle not found");
      return toBakeCycle(row);
    },

    async changeStatus(
      ownerId: string,
      cycleId: string,
      status: Phase2CycleStatus | "LOCKED",
    ): Promise<BakeCycle> {
      if (status === "LOCKED") {
        throw new Error("Cycle locking belongs to Phase 3");
      }
      const parsedOwnerId = uuidSchema.safeParse(ownerId);
      const parsedCycleId = uuidSchema.safeParse(cycleId);
      const parsedStatus = phase2StatusSchema.safeParse(status);
      if (
        !parsedOwnerId.success ||
        !parsedCycleId.success ||
        !parsedStatus.success
      ) {
        throw new Error("Invalid cycle status");
      }
      const [row] = await db
        .update(bakeCycles)
        .set({ status: parsedStatus.data, updatedAt: new Date() })
        .where(
          and(
            eq(bakeCycles.ownerId, parsedOwnerId.data),
            eq(bakeCycles.id, parsedCycleId.data),
          ),
        )
        .returning();
      if (!row) throw new Error("Cycle not found");
      return toBakeCycle(row);
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
