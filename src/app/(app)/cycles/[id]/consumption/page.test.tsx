import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSUMPTION_IDS as ids, HISTORY_USAGE, LEGACY_USAGE, PENDING_USAGE } from "@tests/fixtures/consumption-views";
import { ConsumptionStateError } from "@/modules/consumption/domain/types";

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), getCycleConsumption: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/consumption/application/consumption-queries", () => ({ createConsumptionQueryService: () => ({ getCycleConsumption: mocks.getCycleConsumption }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("./actions", () => ({ confirmUseAction: vi.fn(), correctUseAction: vi.fn() }));
import ConsumptionPage from "./page";

describe("ConsumptionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: "owned-user" });
    mocks.getCycleConsumption.mockResolvedValue(PENDING_USAGE);
  });
  it("authenticates before the owner-scoped read and renders the real confirmation form", async () => {
    const tree = await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) });
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(tree, { container, baseElement: container });
    expect(mocks.getCycleConsumption).toHaveBeenCalledWith("owned-user", ids.cycle, undefined);
    expect(mocks.requireOwner.mock.invocationCallOrder[0]!).toBeLessThan(mocks.getCycleConsumption.mock.invocationCallOrder[0]!);
    expect(ui.getByRole("heading", { name: "บันทึกยอดใช้การผลิต" })).toBeInTheDocument();
    expect(ui.getByRole("button", { name: "ยืนยันยอดใช้" })).toBeInTheDocument();
  });
  it("never queries when authentication fails", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) })).rejects.toThrow("Unauthorized");
    expect(mocks.getCycleConsumption).not.toHaveBeenCalled();
  });
  it("awaits the selected generation and renders readonly immutable history", async () => {
    mocks.getCycleConsumption.mockResolvedValueOnce(HISTORY_USAGE);
    const tree = await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ generation: "2" }) });
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(tree, { container, baseElement: container });
    expect(mocks.getCycleConsumption).toHaveBeenCalledWith("owned-user", ids.cycle, 2);
    expect(ui.getByRole("heading", { name: "บันทึกครั้งที่ 1" })).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
  it.each(["", "0", "01", "-1", "1.0", "1e2", "9007199254740992", ["1", "2"]])("404s malformed generation %j before read", async (generation) => {
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }), searchParams: Promise.resolve({ generation }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCycleConsumption).not.toHaveBeenCalled();
  });
  it.each([
    { name: "invalid cycle", cycleId: "not-a-uuid", generation: undefined },
    { name: "unknown cycle", cycleId: "40000000-0000-4000-8000-000000000001", generation: undefined },
    { name: "foreign cycle", cycleId: "40000000-0000-4000-8000-000000000002", generation: undefined },
    { name: "unknown generation", cycleId: ids.cycle, generation: "9" },
  ])("404s an owned-query NOT_FOUND for $name", async ({ cycleId, generation }) => {
    mocks.getCycleConsumption.mockRejectedValueOnce(new ConsumptionStateError("NOT_FOUND", "Consumption record not found"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: cycleId }), searchParams: Promise.resolve(generation === undefined ? {} : { generation }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCycleConsumption).toHaveBeenCalledWith("owned-user", cycleId, generation ? 9 : undefined);
  });
  it("does not disguise an unexpected failure as 404", async () => {
    mocks.getCycleConsumption.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) })).rejects.toThrow("read unavailable");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
  it("renders legacy as readonly without inventing ledger controls", async () => {
    mocks.getCycleConsumption.mockResolvedValueOnce(LEGACY_USAGE);
    const container = document.createElement("div");
    document.body.append(container);
    const ui = render(await ConsumptionPage({ params: Promise.resolve({ id: ids.cycle }) }), { container, baseElement: container });
    expect(ui.getByText(/รอบเดิม.*อ่านอย่างเดียว/)).toBeInTheDocument();
    expect(ui.queryByRole("button")).toBeNull();
  });
});
