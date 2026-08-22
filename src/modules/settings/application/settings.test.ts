import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { createSettingsService } from "./settings";

describe("shop settings", () => {
  let context: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    context = await createTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("upserts and returns exact costing defaults", async () => {
    const service = createSettingsService(context.db);
    await service.upsert("00000000-0000-4000-8000-000000000001", {
      laborRateSatangPerHour: 12000,
      timezone: "Asia/Bangkok",
      currency: "THB",
      defaultWasteAllowancePercent: "3.125",
    });

    expect(
      await service.get("00000000-0000-4000-8000-000000000001"),
    ).toMatchObject({
      laborRateSatangPerHour: 12000,
      timezone: "Asia/Bangkok",
      currency: "THB",
      defaultWasteAllowancePercent: "3.1250",
    });
  });

  it("keeps settings isolated by owner", async () => {
    const service = createSettingsService(context.db);
    await service.upsert("00000000-0000-4000-8000-000000000001", {
      laborRateSatangPerHour: 12000,
      timezone: "Asia/Bangkok",
      currency: "THB",
      defaultWasteAllowancePercent: "3",
    });

    expect(await service.get("00000000-0000-4000-8000-000000000002")).toBeNull();
  });

  it("rejects settings outside safe costing ranges", async () => {
    const service = createSettingsService(context.db);

    await expect(
      service.upsert("00000000-0000-4000-8000-000000000001", {
        laborRateSatangPerHour: -1,
        timezone: "Asia/Bangkok",
        currency: "THB",
        defaultWasteAllowancePercent: "100.0001",
      }),
    ).rejects.toThrow("Invalid shop settings");
  });
});
