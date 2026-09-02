import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ changeCycleStatusAction: vi.fn() }));

vi.mock("@/app/(app)/cycles/actions", () => ({
  changeCycleStatusAction: actions.changeCycleStatusAction,
}));

import { CycleStatusForm } from "./cycle-status-form";

describe("CycleStatusForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["DRAFT", ["", "OPEN", "CANCELLED"]],
    ["OPEN", ["", "DRAFT", "CANCELLED"]],
    ["LOCKED", ["", "IN_PRODUCTION", "CANCELLED"]],
    ["IN_PRODUCTION", ["", "COMPLETED", "CANCELLED"]],
  ] as const)("offers only legal transitions from %s", (current, expected) => {
    render(
      <CycleStatusForm
        cycleId="11111111-1111-4111-8111-111111111111"
        status={current}
      />,
    );

    const status = screen.getByLabelText("เปลี่ยนสถานะ");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).toEqual(
      expected,
    );
    expect(options[0]).toBeDisabled();
    expect(status.querySelector('option[value="LOCKED"]')).toBeNull();
  });

  it.each(["COMPLETED", "CANCELLED"] as const)(
    "renders no mutation form for terminal %s",
    (status) => {
      render(
        <CycleStatusForm
          cycleId="11111111-1111-4111-8111-111111111111"
          status={status}
        />,
      );

      expect(
        screen.queryByRole("form", { name: "เปลี่ยนสถานะรอบผลิต" }),
      ).toBeNull();
      expect(screen.queryByLabelText("เปลี่ยนสถานะ")).toBeNull();
    },
  );

  it("renders the serialized Thai action error without offering LOCKED", async () => {
    actions.changeCycleStatusAction.mockResolvedValue({
      error: "อัปเดตสถานะรอบอบไม่สำเร็จ กรุณาลองอีกครั้ง",
      saved: false,
    });
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(
      <CycleStatusForm
        cycleId="11111111-1111-4111-8111-111111111111"
        status="OPEN"
      />,
    );

    const status = screen.getByLabelText("เปลี่ยนสถานะ");
    expect(status.querySelector('option[value="LOCKED"]')).toBeNull();
    await user.selectOptions(status, "CANCELLED");
    await user.click(screen.getByRole("button", { name: "อัปเดตสถานะ" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(actions.changeCycleStatusAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "อัปเดตสถานะ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "อัปเดตสถานะรอบอบไม่สำเร็จ กรุณาลองอีกครั้ง",
    );
    expect(actions.changeCycleStatusAction).toHaveBeenCalledOnce();
  });
});
