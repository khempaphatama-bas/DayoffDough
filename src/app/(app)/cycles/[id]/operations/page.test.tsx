import { render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CYCLE_ID, NO_GENERATION_VIEW, ORDER, READY_VIEW, TASK } from "../../../../../../tests/fixtures/operations";
import { OperationsStateError } from "@/modules/operations/domain/types";

const mocks = vi.hoisted(() => ({ get: vi.fn(), requireOwner: vi.fn(), notFound: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/operations/application/operations-queries", () => ({ createOperationsQueryService: () => ({ getCycleOperations: mocks.get }) }));
vi.mock("./actions", () => ({ startCycleAction: vi.fn(), confirmOrdersAction: vi.fn(), startOrdersAction: vi.fn(), deliverOrdersAction: vi.fn(), setPackedQuantityAction: vi.fn(), confirmOrderPackedAction: vi.fn(), reopenOrderPackingAction: vi.fn(), setOrderAmountPaidAction: vi.fn(), completeCycleAction: vi.fn() }));
vi.mock("@/app/(app)/cycles/[id]/production/actions", () => ({ updateCycleTaskAction: vi.fn(), createManualCycleTaskAction: vi.fn(), deleteManualCycleTaskAction: vi.fn() }));

import OperationsPage from "./page";
const OWNER_ID = "72000000-0000-4000-8000-000000000009";

describe("OperationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ id: OWNER_ID });
    mocks.get.mockResolvedValue({ ...READY_VIEW, orders: [{ ...ORDER, fulfillmentStatus: "PACKED" }] });
    mocks.notFound.mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
  });

  it("awaits Next 16 params, loads the owner-scoped view, and renders all sections", async () => {
    const { container } = render(await OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    const page = within(container);
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledWith(OWNER_ID, CYCLE_ID);
    for (const name of ["Operations", "ต้องทำอะไรต่อ", "เตรียมและแพ็กออเดอร์", "รับชำระเงิน", "พร้อมจัดส่ง"]) expect(page.getByRole("heading", { name })).toBeVisible();
    const headings = page.getAllByRole("heading").map(x => x.textContent);
    expect(headings.indexOf("ต้องทำอะไรต่อ")).toBeLessThan(headings.indexOf("เตรียมและแพ็กออเดอร์"));
  });

  it("offers Planning/Production links and no mutation controls without a generation", async () => {
    mocks.get.mockResolvedValue(NO_GENERATION_VIEW);
    const { container } = render(await OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    const page = within(container);
    expect(page.getByText("รอบนี้ยังไม่มี Operations generation กรุณาตรวจแผนการผลิต")).toBeVisible();
    expect(page.getByRole("link", { name: "แผนการผลิต" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/planning`);
    expect(page.getByRole("link", { name: "Production Timeline" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/production`);
    expect(page.queryByRole("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("keeps completed legacy work read-only, its integrity warning visible, and Payment active", async () => {
    mocks.get.mockResolvedValue({ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "COMPLETED" }, orders: [ORDER], completion: { ...READY_VIEW.completion, remainingOrderCount: 1 } });
    const { container } = render(await OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    const page = within(container);
    expect(page.getByRole("alert")).toHaveTextContent("ข้อมูลรอบที่จบแล้วไม่สอดคล้อง");
    expect(within(page.getByRole("region", { name: "งานตามเวลา" })).queryByRole("button")).toBeNull();
    expect(within(page.getByRole("region", { name: "เตรียมและแพ็กออเดอร์" })).queryByRole("button")).toBeNull();
    expect(within(page.getByRole("region", { name: "รับชำระเงิน" })).getByRole("button", { name: "ชำระครบ" })).toBeEnabled();
    expect(page.queryByRole("button", { name: "จบรอบผลิต" })).toBeNull();
  });

  it("renders a cancelled Cycle fully read-only", async () => {
    mocks.get.mockResolvedValue({ ...READY_VIEW, cycle: { ...READY_VIEW.cycle, status: "CANCELLED" }, orders: [ORDER] });
    const { container } = render(await OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    expect(within(container).getByRole("heading", { name: "รับชำระเงิน" })).toBeVisible();
    expect(within(within(container).getByRole("region", { name: "รับชำระเงิน" })).getByRole("heading", { name: ORDER.customerName })).toBeVisible();
    expect(within(container).queryByRole("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(within(container).getByRole("link", { name: "บันทึกยอดใช้" })).toHaveAttribute("href", `/cycles/${CYCLE_ID}/consumption`);
  });

  it("keeps another switcher Cycle out of this Cycle timeline", async () => {
    const otherId = "72000000-0000-4000-8000-000000000008";
    mocks.get.mockResolvedValue({ ...READY_VIEW, cycleOptions: [...READY_VIEW.cycleOptions, { ...READY_VIEW.cycleOptions[0], id: otherId, name: "อีกรอบ" }] });
    const { container } = render(await OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) }));
    const timeline = within(within(container).getByRole("region", { name: "งานตามเวลา" }));
    expect(timeline.getByText(TASK.title)).toBeVisible();
    expect(timeline.queryByText(/อีกรอบ/)).toBeNull();
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(container.querySelector(`input[value="${otherId}"]`)).toBeNull();
  });

  it("maps typed not-found and propagates unexpected failures", async () => {
    mocks.get.mockRejectedValueOnce(new OperationsStateError("NOT_FOUND", "Operations record not found"));
    await expect(OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
    mocks.get.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(OperationsPage({ params: Promise.resolve({ id: CYCLE_ID }) })).rejects.toThrow("database unavailable");
  });
});
