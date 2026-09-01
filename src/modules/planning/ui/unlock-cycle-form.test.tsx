import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  unlockCycleAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/app/(app)/cycles/[id]/planning/actions", () => ({
  unlockCycleAction: mocks.unlockCycleAction,
}));

import { UnlockCycleForm } from "./unlock-cycle-form";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";

describe("UnlockCycleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.unlockCycleAction.mockResolvedValue({ error: null, saved: true });
  });

  it.each(["DRAFT", "OPEN", "COMPLETED", "CANCELLED"] as const)(
    "renders no unlock controls for %s",
    (status) => {
      render(<UnlockCycleForm cycleId={CYCLE_ID} status={status} />);
      expect(screen.queryByRole("button", { name: "ปลดล็อกรอบ" })).toBeNull();
    },
  );

  it("requires a non-empty reason and the exact confirmation word", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <UnlockCycleForm cycleId={CYCLE_ID} status="LOCKED" />,
    );

    const reason = screen.getByLabelText("เหตุผลที่ปลดล็อก");
    const confirmation = screen.getByLabelText("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน");
    const submit = screen.getByRole("button", { name: "ปลดล็อกรอบ" });
    expect(reason).toBeRequired();
    expect(confirmation).toBeRequired();
    expect(submit).toBeDisabled();
    expect(
      container.querySelector<HTMLInputElement>('input[name="cycleId"]'),
    ).toHaveValue(CYCLE_ID);

    await user.type(reason, "เพิ่มยอดสั่งด่วน");
    await user.type(confirmation, "unlock");
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mocks.unlockCycleAction).not.toHaveBeenCalled();

    await user.clear(confirmation);
    await user.type(confirmation, "ปลดล็อก");
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(mocks.unlockCycleAction).toHaveBeenCalledOnce());
    const submitted = mocks.unlockCycleAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("cycleId")).toBe(CYCLE_ID);
    expect(submitted.get("reason")).toBe("เพิ่มยอดสั่งด่วน");
    expect(submitted.get("confirmation")).toBe("ปลดล็อก");
  });

  it("warns about production rollback and retains controlled inputs after a safe error", async () => {
    mocks.unlockCycleAction.mockResolvedValue({
      error: "ปลดล็อกรอบนี้ไม่ได้",
      saved: false,
    });
    const user = userEvent.setup();
    render(<UnlockCycleForm cycleId={CYCLE_ID} status="IN_PRODUCTION" />);

    expect(
      screen.getByText(
        "รอบนี้เริ่มผลิตแล้ว การปลดล็อกจะคืนรอบไปวางแผนใหม่",
      ),
    ).toBeInTheDocument();
    const reason = screen.getByLabelText("เหตุผลที่ปลดล็อก");
    const confirmation = screen.getByLabelText("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน");
    await user.type(reason, "พบยอดผิด");
    await user.type(confirmation, "ปลดล็อก");
    await user.click(screen.getByRole("button", { name: "ปลดล็อกรอบ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ปลดล็อกรอบนี้ไม่ได้",
    );
    expect(reason).toHaveValue("พบยอดผิด");
    expect(confirmation).toHaveValue("ปลดล็อก");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("returns to the cycle and refreshes after a successful unlock", async () => {
    const user = userEvent.setup();
    render(<UnlockCycleForm cycleId={CYCLE_ID} status="LOCKED" />);

    await user.type(screen.getByLabelText("เหตุผลที่ปลดล็อก"), "แก้จำนวน");
    await user.type(
      screen.getByLabelText("พิมพ์คำว่า ปลดล็อก เพื่อยืนยัน"),
      "ปลดล็อก",
    );
    await user.click(screen.getByRole("button", { name: "ปลดล็อกรอบ" }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(`/cycles/${CYCLE_ID}`);
      expect(mocks.refresh).toHaveBeenCalledOnce();
    });
    expect(mocks.push.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0]!,
    );
  });
});
