import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BakeCycle } from "@/modules/cycles/application/cycles";
import type {
  PlanningGenerationSummary,
  PlanningGenerationView,
} from "@/modules/planning/application/planning-queries";
import type { PlanningPreview } from "@/modules/planning/domain/types";

const mocks = vi.hoisted(() => ({
  cycleGet: vi.fn(),
  generationView: vi.fn(),
  getGeneration: vi.fn(),
  listGenerations: vi.fn(),
  notFound: vi.fn(),
  preview: vi.fn(),
  previewForm: vi.fn(),
  requireOwner: vi.fn(),
  unlockForm: vi.fn(),
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
    getGeneration: mocks.getGeneration,
    listGenerations: mocks.listGenerations,
    preview: mocks.preview,
  }),
}));
vi.mock("@/modules/planning/ui/planning-generation-view", () => ({
  PlanningGenerationView: ({
    generation,
    generations,
  }: {
    generation: PlanningGenerationView;
    generations: ReadonlyArray<PlanningGenerationSummary>;
  }) => {
    mocks.generationView(generation, generations);
    return <div data-testid="planning-generation">รุ่น {generation.generation}</div>;
  },
}));
vi.mock("@/modules/planning/ui/planning-preview-form", () => ({
  PlanningPreviewForm: ({ preview }: { preview: PlanningPreview }) => {
    mocks.previewForm(preview);
    return <div data-testid="planning-preview">{preview.inputFingerprint}</div>;
  },
}));
vi.mock("@/modules/planning/ui/unlock-cycle-form", () => ({
  UnlockCycleForm: ({ cycleId, status }: { cycleId: string; status: string }) => {
    mocks.unlockForm(cycleId, status);
    return <div data-testid="unlock-cycle">ปลดล็อกรอบ</div>;
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

const GENERATION_VIEW: PlanningGenerationView = {
  ...GENERATIONS[0]!,
  cycleNumber: 7,
  cycleName: "ชื่อรอบที่คัดลอกตอนล็อก",
  warnings: [],
  orders: [],
  productPlans: [],
  recipePlans: [],
  materialRequirements: [],
  packagingRequirements: [],
  productCosts: [],
  cycleCost: PREVIEW.cycleCost,
};

describe("PlanningPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.cycleGet.mockResolvedValue(CYCLE);
    mocks.listGenerations.mockResolvedValue([]);
    mocks.getGeneration.mockResolvedValue(GENERATION_VIEW);
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
    expect(mocks.unlockForm).not.toHaveBeenCalled();
  });

  it("asks a DRAFT cycle to open before planning and never builds a preview", async () => {
    mocks.cycleGet.mockResolvedValueOnce({ ...CYCLE, status: "DRAFT" });

    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));

    expect(screen.getByText("กรุณาเปิดรอบผลิตก่อน")).toBeInTheDocument();
    expect(screen.queryByTestId("planning-preview")).toBeNull();
    expect(mocks.listGenerations).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("loads the active-pointer generation for a frozen cycle", async () => {
    mocks.cycleGet.mockResolvedValueOnce({
      ...CYCLE,
      status: "LOCKED",
      activePlanningSnapshotId: SNAPSHOT_ID,
      lockedAt: GENERATIONS[0]!.lockedAt,
    });
    mocks.listGenerations.mockResolvedValueOnce(GENERATIONS);

    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));

    expect(screen.getByTestId("planning-generation")).toHaveTextContent("รุ่น 1");
    expect(screen.queryByTestId("planning-preview")).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.getGeneration).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    expect(mocks.generationView).toHaveBeenCalledWith(
      GENERATION_VIEW,
      GENERATIONS,
    );
    expect(screen.getByTestId("unlock-cycle")).toBeInTheDocument();
    expect(mocks.unlockForm).toHaveBeenCalledWith(CYCLE_ID, "LOCKED");
  });

  it("renders unlock controls for IN_PRODUCTION but not a terminal cycle", async () => {
    mocks.cycleGet.mockResolvedValueOnce({
      ...CYCLE,
      status: "IN_PRODUCTION",
      activePlanningSnapshotId: SNAPSHOT_ID,
    });
    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    expect(mocks.unlockForm).toHaveBeenCalledWith(CYCLE_ID, "IN_PRODUCTION");

    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.cycleGet.mockResolvedValue({
      ...CYCLE,
      status: "COMPLETED",
      activePlanningSnapshotId: SNAPSHOT_ID,
    });
    mocks.listGenerations.mockResolvedValue(GENERATIONS);
    mocks.getGeneration.mockResolvedValue(GENERATION_VIEW);
    render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    expect(mocks.unlockForm).not.toHaveBeenCalled();
  });

  it("opens an explicitly selected historical generation instead of an OPEN live preview", async () => {
    mocks.listGenerations.mockResolvedValueOnce(GENERATIONS);

    render(
      await PlanningPage({
        params: Promise.resolve({ id: CYCLE_ID }),
        searchParams: Promise.resolve({ generation: "1" }),
      }),
    );

    expect(screen.getByTestId("planning-generation")).toBeInTheDocument();
    expect(screen.queryByTestId("planning-preview")).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.getGeneration).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID, 1);
    expect(
      screen.getByRole("link", { name: `← ${GENERATION_VIEW.cycleName}` }),
    ).toHaveAttribute("href", `/cycles/${CYCLE_ID}`);
    expect(screen.getByText("รอบ #7")).toBeInTheDocument();
    expect(screen.queryByText(`รอบ #${CYCLE.cycleNumber}`)).toBeNull();
  });

  it.each(["0", "-1", "1.5", "1e2", "9007199254740992"])(
    "rejects invalid generation search input %s before immutable reads",
    async (generation) => {
      await expect(
        PlanningPage({
          params: Promise.resolve({ id: CYCLE_ID }),
          searchParams: Promise.resolve({ generation }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(mocks.notFound).toHaveBeenCalledOnce();
      expect(mocks.getGeneration).not.toHaveBeenCalled();
      expect(mocks.preview).not.toHaveBeenCalled();
    },
  );

  it.each(["COMPLETED", "CANCELLED"] as const)(
    "renders a legitimate no-plan state for a terminal %s cycle without an active pointer",
    async (status) => {
      mocks.cycleGet.mockResolvedValueOnce({
        ...CYCLE,
        status,
        activePlanningSnapshotId: null,
      });

      render(await PlanningPage({ params: Promise.resolve({ id: CYCLE_ID }) }));

      expect(screen.getByText("รอบนี้ไม่มีแผนที่ล็อกไว้")).toBeInTheDocument();
      expect(mocks.getGeneration).not.toHaveBeenCalled();
      expect(mocks.preview).not.toHaveBeenCalled();
    },
  );

  it("uses an explicit generation even when a terminal cycle has no active pointer", async () => {
    mocks.cycleGet.mockResolvedValueOnce({
      ...CYCLE,
      status: "CANCELLED",
      activePlanningSnapshotId: null,
    });
    mocks.listGenerations.mockResolvedValueOnce(GENERATIONS);

    render(
      await PlanningPage({
        params: Promise.resolve({ id: CYCLE_ID }),
        searchParams: Promise.resolve({ generation: "1" }),
      }),
    );

    expect(screen.getByTestId("planning-generation")).toBeInTheDocument();
    expect(mocks.getGeneration).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID, 1);
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
