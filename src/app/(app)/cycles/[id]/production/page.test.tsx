import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleProductionView } from "@/modules/production/domain/types";

const mocks = vi.hoisted(() => ({ get: vi.fn(), notFound: vi.fn(), requireOwner: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/production/application/production-queries", () => ({ createProductionQueryService: () => ({ getCycleProduction: mocks.get }) }));
vi.mock("@/modules/production/ui/cycle-task-list", () => ({ CycleTaskList: ({ view }: { view: CycleProductionView }) => <div data-testid="timeline">{view.kind}</div>, ProductionGenerationLinks: () => <div data-testid="generation-links" /> }));

import ProductionPage from "./page";

const CYCLE_ID = "72000000-0000-4000-8000-000000000001";
const OWNER_ID = "72000000-0000-4000-8000-000000000009";
const VIEW = { kind: "CURRENT", writable: true, cycle: { cycleId: CYCLE_ID, cycleNumber: 1, cycleName: "รอบส่ง", cycleStatus: "LOCKED" }, generation: { id: "72000000-0000-4000-8000-000000000002", cycleId: CYCLE_ID, planningSnapshotId: "72000000-0000-4000-8000-000000000003", generation: 1, primaryDeliveryDate: "2026-09-12", timezone: "Asia/Bangkok", createdAt: new Date(), planningStatus: "ACTIVE" }, generations: [], tasks: [], products: [] } as unknown as Extract<CycleProductionView, { kind: "CURRENT" }>;

describe("ProductionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID });
    mocks.get.mockResolvedValue(VIEW);
    mocks.notFound.mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
  });

  it("links only the current generation to Operations, preserving history navigation", async () => {
    const current = render(await ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    expect(within(current.container).getByRole("link", { name: "เปิด Operations" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/operations`);
    current.unmount();
    mocks.get.mockResolvedValueOnce({ ...VIEW, kind: "HISTORY", writable: false });
    const history = render(await ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }), searchParams: Promise.resolve({ generation: "1" }) }));
    expect(within(history.container).queryByRole("link", { name: /Operations/ })).toBeNull();
  });

  it("awaits promised route props and loads the clean active generation", async () => {
    render(await ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }), searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("timeline")).toHaveTextContent("CURRENT");
    expect(mocks.get).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID, undefined);
    expect(screen.getByText("วันส่งหลัก: 2026-09-12")).toBeInTheDocument();
  });

  it("loads an explicit positive history generation", async () => {
    mocks.get.mockResolvedValueOnce({ ...VIEW, kind: "HISTORY", writable: false });
    render(await ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }), searchParams: Promise.resolve({ generation: "2" }) }));
    expect(mocks.get).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID, 2);
  });

  it.each(["0", "-1", "1.5", "1e2", "9007199254740992"])("not-found invalid generation %s", async (generation) => {
    await expect(ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }), searchParams: Promise.resolve({ generation }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("renders lifecycle-appropriate no-plan and legacy copy", async () => {
    mocks.get.mockResolvedValueOnce({ kind: "NO_GENERATION", reason: "NO_PLAN", writable: false, cycle: { cycleId: CYCLE_ID, cycleNumber: 1, cycleName: "รอบส่ง", cycleStatus: "OPEN" }, selectedPlanningGeneration: null, generations: [] });
    render(await ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    expect(screen.getByText("รอบนี้ยังไม่มีแผน Production Timeline")).toBeInTheDocument();
    expect(screen.queryByText("ปลดล็อก/ล็อกแผนใหม่ได้จากหน้าแผนการผลิต")).not.toBeInTheDocument();
  });

  it("guides both locked and in-production cycles toward unlock/re-lock", async () => {
    for (const cycleStatus of ["LOCKED", "IN_PRODUCTION"] as const) {
      mocks.get.mockResolvedValueOnce({ ...VIEW, cycle: { ...VIEW.cycle, cycleStatus }, generation: { ...VIEW.generation, planningStatus: "ACTIVE" } });
      const result = await ProductionPage({ params: Promise.resolve({ id: CYCLE_ID }) });
      const { container } = render(result);
      expect(within(container).getByText("ปลดล็อกเพื่อสร้างรุ่นใหม่ได้จากหน้าแผนการผลิต")).toBeInTheDocument();
    }
  });
});
