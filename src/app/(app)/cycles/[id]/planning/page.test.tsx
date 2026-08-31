import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import type {
  PlanningGenerationSummary,
} from "@/modules/planning/application/planning-queries";
import type { PlanningPreview } from "@/modules/planning/domain/types";

const mocks = vi.hoisted(() => ({
  cycleGet: vi.fn(),
  listGenerations: vi.fn(),
  notFound: vi.fn(),
  preview: vi.fn(),
  previewForm: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/cycles/application/cycles", () => ({
  createCycleService: () => ({ get: mocks.cycleGet }),
}));
vi.mock("@/modules/planning/application/planning-queries", () => ({
  createPlanningQueryService: () => ({
    listGenerations: mocks.listGenerations,
    preview: mocks.preview,
  }),
}));
vi.mock("@/modules/planning/ui/planning-preview-form", () => ({
  PlanningPreviewForm: ({ preview }: { preview: PlanningPreview }) => {
    mocks.previewForm(preview);
    return <div data-testid="planning-preview">{preview.inputFingerprint}</div>;
  },
}));

import PlanningPage from "./page";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const FINGERPRINT = "a".repeat(64);

const CYCLE: BakeCycle = {
  id: CYCLE_ID,
  ownerId: OWNER_ID,
  cycleNumber: 12,
  name: "รอบส่ง 30 ส.ค.",
  status: "OPEN",
  orderCutoffAt: new Date("2026-08-27T05:00:00.000Z"),
  targetProductionDate: "2026-08-29",
  primaryDeliveryDate: "2026-08-30",
  notes: null,
  lockedAt: null,
  activePlanningSnapshotId: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

const PREVIEW: PlanningPreview = {
  calculatedAt: new Date("2026-08-29T00:00:00.000Z"),
  cycle: {
    id: CYCLE_ID,
    cycleNumber: CYCLE.cycleNumber,
    name: CYCLE.name,
    status: "OPEN",
    orderCutoffAt: CYCLE.orderCutoffAt,
    targetProductionDate: CYCLE.targetProductionDate,
    primaryDeliveryDate: CYCLE.primaryDeliveryDate,
  },
  inputFingerprint: FINGERPRINT,
  blockers: [],
  warnings: [],
  orderSnapshots: [],
  productPlans: [],
  recipePlans: [],
  inventoryPrices: [],
  materialRequirements: [],
  packagingRequirements: [],
  productCosts: [],
  cycleCost: {
    knownBaseIngredientCostSatang: 0,
    knownWasteCostSatang: 0,
    knownProductPackagingCostSatang: 0,
    knownDeliveryPackagingCostSatang: 0,
    laborCostSatang: 0,
    utilityCostSatang: 0,
    knownProductionCostSatang: 0,
    completeProductionCostSatang: 0,
    costComplete: true,
    missingPriceCount: 0,
  },
};

const GENERATIONS: ReadonlyArray<PlanningGenerationSummary> = [
  {
    id: SNAPSHOT_ID,
    cycleId: CYCLE_ID,
    generation: 1,
    status: "ACTIVE",
    costComplete: true,
    lockedAt: new Date("2026-08-29T06:00:00.000Z"),
    unlockedAt: null,
    unlockReason: null,
    unlockedFromStatus: null,
  },
];

describe("PlanningPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.cycleGet.mockResolvedValue(CYCLE);
    mocks.listGenerations.mockResolvedValue([]);
    mocks.preview.mockResolvedValue(PREVIEW);
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("loads an OPEN preview and generation summaries with the verified owner", async () => {
    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));

    expect(screen.getByRole("heading", { name: "วางแผนการผลิต" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `← ${CYCLE.name}` })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE_ID}`,
    );
    expect(screen.getByTestId("planning-preview")).toHaveTextContent(FINGERPRINT);
    expect(mocks.cycleGet).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    expect(mocks.listGenerations).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    expect(mocks.preview).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    expect(mocks.previewForm).toHaveBeenCalledWith(PREVIEW);
  });

  it("asks a DRAFT cycle to open before planning and never builds a preview", async () => {
    mocks.cycleGet.mockResolvedValueOnce({ ...CYCLE, status: "DRAFT" });

    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));

    expect(screen.getByText("กรุณาเปิดรอบผลิตก่อน")).toBeInTheDocument();
    expect(screen.queryByTestId("planning-preview")).toBeNull();
    expect(mocks.listGenerations).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("leaves active and historical generation rendering for the next UI step", async () => {
    mocks.cycleGet.mockResolvedValueOnce({
      ...CYCLE,
      status: "LOCKED",
      activePlanningSnapshotId: SNAPSHOT_ID,
      lockedAt: GENERATIONS[0]!.lockedAt,
    });
    mocks.listGenerations.mockResolvedValueOnce(GENERATIONS);

    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));

    expect(screen.getByText("มีแผนที่ล็อกไว้ 1 รุ่น")).toBeInTheDocument();
    expect(screen.queryByTestId("planning-preview")).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it.each([
    ["cycle", mocks.cycleGet, "Cycle not found"],
    ["generation", mocks.listGenerations, "Planning generation not found"],
  ])("turns only an exact owner-scoped %s miss into not found", async (_label, method, message) => {
    method.mockRejectedValueOnce(new Error(message));

    await expect(
      PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("rethrows unknown failures instead of disguising them as not found", async () => {
    mocks.listGenerations.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    ).rejects.toThrow("database unavailable");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("authenticates before any owner-scoped route query", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }),
    ).rejects.toThrow("Unauthorized");
    expect(mocks.cycleGet).not.toHaveBeenCalled();
    expect(mocks.listGenerations).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
