import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/db/types";
import { shopSettings } from "@/modules/settings/db/schema";

export type ShopSettingsInput = Readonly<{
  laborRateSatangPerHour: number;
  timezone: "Asia/Bangkok";
  currency: "THB";
  defaultWasteAllowancePercent: string;
}>;

export type ShopSettings = ShopSettingsInput &
  Readonly<{
    ownerId: string;
    updatedAt: Date;
  }>;

const percentageSchema = z.string().refine(
  (value) => {
    try {
      const percentage = new Decimal(value);
      return percentage.gte(0) && percentage.lte(100) && percentage.decimalPlaces() <= 4;
    } catch {
      return false;
    }
  },
  { message: "Waste allowance must be between 0 and 100 with up to 4 decimals" },
);

const settingsSchema = z.object({
  laborRateSatangPerHour: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER),
  timezone: z.literal("Asia/Bangkok"),
  currency: z.literal("THB"),
  defaultWasteAllowancePercent: percentageSchema,
});

function toSettings(row: typeof shopSettings.$inferSelect): ShopSettings {
  return {
    ownerId: row.ownerId,
    laborRateSatangPerHour: row.laborRateSatangPerHour,
    timezone: "Asia/Bangkok",
    currency: "THB",
    defaultWasteAllowancePercent: row.defaultWasteAllowancePercent,
    updatedAt: row.updatedAt,
  };
}

export function createSettingsService(db: DatabaseClient) {
  return {
    async get(ownerId: string): Promise<ShopSettings | null> {
      const row = await db.query.shopSettings.findFirst({
        where: eq(shopSettings.ownerId, ownerId),
      });
      return row ? toSettings(row) : null;
    },

    async upsert(ownerId: string, input: ShopSettingsInput): Promise<ShopSettings> {
      const parsed = settingsSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error("Invalid shop settings");
      }
      const updatedAt = new Date();
      const [row] = await db
        .insert(shopSettings)
        .values({ ownerId, ...parsed.data, updatedAt })
        .onConflictDoUpdate({
          target: shopSettings.ownerId,
          set: { ...parsed.data, updatedAt },
        })
        .returning();
      if (!row) throw new Error("Failed to save shop settings");
      return toSettings(row);
    },
  };
}
