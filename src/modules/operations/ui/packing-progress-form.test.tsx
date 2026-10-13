import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("@/app/(app)/cycles/[id]/operations/actions", () => ({ setPackedQuantityAction: vi.fn() }));
import { CYCLE_ID, ITEM } from "@tests/fixtures/operations";
import { ERROR, operationAction, payloadOf } from "@tests/helpers/operations-ui";
import { PackingProgressForm } from "./packing-progress-form";

it("submits an absolute packed target and retains it after error", async () => {
  const action = operationAction().mockResolvedValue(ERROR); const user = userEvent.setup();
  render(<PackingProgressForm cycleId={CYCLE_ID} item={ITEM} action={action} />);
  const input = screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia");
  await user.clear(input); await user.type(input, "6"); await user.click(screen.getByRole("button", { name: "บันทึกจำนวนแพ็ก Focaccia" }));
  await screen.findByRole("alert"); expect(payloadOf(action)).toEqual({ cycleId: CYCLE_ID, orderItemId: ITEM.id, packedQuantity: 6, expectedPackedQuantity: 2 }); expect(input).toHaveValue(6);
});
it("keeps steppers local and enforces integer boundaries", async () => {
  const action = operationAction(); const user = userEvent.setup(); render(<PackingProgressForm cycleId={CYCLE_ID} item={{ ...ITEM, packedQuantity: 0 }} action={action} />);
  expect(screen.getByRole("button", { name: "ลดจำนวนแพ็ก Focaccia" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "เพิ่มจำนวนแพ็ก Focaccia" })); expect(action).not.toHaveBeenCalled();
  const input = screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia"); await user.clear(input); await user.type(input, "10"); expect(screen.getByRole("button", { name: "เพิ่มจำนวนแพ็ก Focaccia" })).toBeDisabled();
  await user.clear(input); await user.type(input, "11"); expect(screen.getByRole("button", { name: "บันทึกจำนวนแพ็ก Focaccia" })).toBeDisabled();
  await user.clear(input); await user.type(input, "1.5"); expect(screen.getByRole("button", { name: "บันทึกจำนวนแพ็ก Focaccia" })).toBeDisabled();
});
it("disables all packing controls pending server confirmation", async () => {
  let resolve!: (value: typeof ERROR) => void; const action = operationAction().mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<PackingProgressForm cycleId={CYCLE_ID} item={ITEM} action={action} />); await userEvent.click(screen.getByRole("button", { name: "บันทึกจำนวนแพ็ก Focaccia" }));
  expect(screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia")).toBeDisabled(); resolve(ERROR); await waitFor(() => expect(screen.getByLabelText("จำนวนที่แพ็กแล้ว Focaccia")).toBeEnabled());
});
