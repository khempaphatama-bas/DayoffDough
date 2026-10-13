import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";
const mocks = vi.hoisted(() => ({ push: vi.fn(), start: vi.fn<(_previous: OperationsActionState, data: FormData) => Promise<OperationsActionState>>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ startCycleAction: mocks.start }));
import { CYCLE_ID, NO_GENERATION_VIEW, READY_VIEW } from "@tests/fixtures/operations";
import { OperationsHeader } from "./operations-header";

describe("OperationsHeader", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.start.mockResolvedValue({ error: null, kind: null, fieldErrors: {}, saved: true }); });
  it("switches one cycle at a time and starts only a ready locked cycle", async () => {
    const secondId = "72000000-0000-4000-8000-000000000020";
    render(<OperationsHeader view={{ ...READY_VIEW, cycleOptions: [...READY_VIEW.cycleOptions, { ...READY_VIEW.cycleOptions[0]!, id: secondId, name: "อีกรอบ" }] }} />);
    expect(screen.getByLabelText("เลือกรอบผลิต")).toHaveValue(CYCLE_ID);
    expect(screen.getByLabelText("เลือกรอบผลิต")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "เริ่มรอบผลิต" })).toHaveClass("min-h-12");
    expect(screen.queryByRole("button", { name: "จบรอบผลิต" })).toBeNull();
    expect(screen.getByText("รุ่นงานปัจจุบัน 2")).toBeVisible();
    expect(screen.getByText("11 กันยายน 2569")).toBeVisible();
    expect(screen.getByText("12 กันยายน 2569")).toBeVisible();
    expect(screen.getByText("งานค้าง 1 งาน · ออเดอร์ยังไม่ส่ง 0 ใบ")).toBeVisible();
    expect(screen.getByRole("link", { name: "Production Timeline" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/production`);
    expect(screen.getByRole("link", { name: "แผนการผลิต" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/planning`);
    await userEvent.selectOptions(screen.getByLabelText("เลือกรอบผลิต"), secondId);
    expect(mocks.push).toHaveBeenCalledWith(`/cycles/${secondId}/operations`);
    await userEvent.click(screen.getByRole("button", { name: "เริ่มรอบผลิต" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(mocks.start.mock.calls[0]![1].get("payload")))).toEqual({ cycleId: CYCLE_ID });
  });
  it.each(["IN_PRODUCTION", "COMPLETED", "CANCELLED"] as const)("hides start for %s and keeps terminal selection", (status) => {
    render(<OperationsHeader view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status }, cycleOptions: [{ ...READY_VIEW.cycleOptions[0]!, status }] }} />);
    expect(screen.getByLabelText("เลือกรอบผลิต")).toHaveValue(CYCLE_ID);
    expect(screen.queryByRole("button", { name: "เริ่มรอบผลิต" })).toBeNull();
    if (status !== "IN_PRODUCTION") expect(screen.getByText("อ่านอย่างเดียว")).toBeVisible();
  });
  it("exposes no start control without a generation even while locked", () => {
    render(<OperationsHeader view={NO_GENERATION_VIEW} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("shows errors and pending state without claiming success before server confirmation", async () => {
    let resolve!: (value: OperationsActionState) => void;
    mocks.start.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<OperationsHeader view={READY_VIEW} />);
    await userEvent.click(screen.getByRole("button", { name: "เริ่มรอบผลิต" }));
    expect(screen.getByRole("button", { name: "กำลังเริ่มรอบผลิต…" })).toBeDisabled();
    resolve({ error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", kind: "STALE_DATA", fieldErrors: {}, saved: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูลมีการเปลี่ยนแปลง");
    expect(screen.getByRole("button", { name: "เริ่มรอบผลิต" })).toBeEnabled();
  });
});
