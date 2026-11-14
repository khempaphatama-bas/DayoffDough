import { render, screen, waitFor, within } from "@testing-library/react";
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
  it("guides a blocked locked V1 cycle to stock check separately from pending production use", () => {
    const locked = render(<OperationsHeader view={READY_VIEW} />);
    const page = within(locked.container);
    expect(page.getByRole("button", { name: "เริ่มรอบผลิต" })).toBeDisabled();
    expect(page.getByRole("link", { name: "เช็กสต๊อกก่อนเริ่มผลิต" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/shopping`);
    locked.unmount();
    const production = render(<OperationsHeader view={{ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "IN_PRODUCTION" } }} />);
    expect(within(production.container).getByRole("link", { name: "บันทึกยอดใช้" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/consumption`);
    expect(within(production.container).getByText(/ยังไม่ได้บันทึกยอดใช้/)).toBeVisible();
    expect(within(production.container).queryByRole("link", { name: "เช็กสต๊อกก่อนเริ่มผลิต" })).toBeNull();
  });
  it("renders safe owned blocker guidance after a genuinely dispatched stale-page start", async () => {
    mocks.start.mockResolvedValueOnce({ error: "กรุณาตรวจสต๊อกก่อนเริ่มผลิต", kind: "STOCK_CHECK_REQUIRED", fieldErrors: {}, saved: false });
    render(<OperationsHeader view={{ ...READY_VIEW, consumption: { ...READY_VIEW.consumption, startBlockedByStockCheck: false } }} />);
    await userEvent.click(screen.getByRole("button", { name: "เริ่มรอบผลิต" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาตรวจสต๊อกก่อนเริ่มผลิต");
    expect(screen.getByRole("link", { name: "เช็กสต๊อกก่อนเริ่มผลิต" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/shopping`);
  });
  it("retains the pre-cutover start path without a V1 stock-check gate", () => {
    const { container } = render(<OperationsHeader view={{ ...READY_VIEW, consumption: { required: false, recorded: false, startBlockedByStockCheck: false } }} />);
    expect(within(container).getByRole("button", { name: "เริ่มรอบผลิต" })).toBeEnabled();
    expect(within(container).queryByRole("link", { name: "เช็กสต๊อกก่อนเริ่มผลิต" })).toBeNull();
  });
  it("switches one cycle at a time and starts only a ready locked cycle", async () => {
    const secondId = "72000000-0000-4000-8000-000000000020";
    render(<OperationsHeader view={{ ...READY_VIEW, consumption: { ...READY_VIEW.consumption, startBlockedByStockCheck: false }, cycleOptions: [...READY_VIEW.cycleOptions, { ...READY_VIEW.cycleOptions[0]!, id: secondId, name: "อีกรอบ" }] }} />);
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
    render(<OperationsHeader view={{ ...READY_VIEW, consumption: { ...READY_VIEW.consumption, startBlockedByStockCheck: false } }} />);
    await userEvent.click(screen.getByRole("button", { name: "เริ่มรอบผลิต" }));
    expect(screen.getByRole("button", { name: "กำลังเริ่มรอบผลิต…" })).toBeDisabled();
    resolve({ error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", kind: "STALE_DATA", fieldErrors: {}, saved: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูลมีการเปลี่ยนแปลง");
    expect(screen.getByRole("button", { name: "เริ่มรอบผลิต" })).toBeEnabled();
  });
});
