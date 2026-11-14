import { fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@tests/helpers/test-db";
import { prepareConsumptionFixture, seedConsumptionScenario, seedSharedConsumptionScenario } from "@tests/fixtures/consumption";
import { OWNER_ID } from "@tests/fixtures/owner";
import { createCycleService } from "@/modules/cycles/application/cycles";
import { readStockLedger } from "@/modules/inventory/application/stock-ledger";
import { createConsumptionCommandService } from "../application/consumption-commands";
import { createConsumptionQueryService } from "../application/consumption-queries";
import type { DatabaseClient } from "@/lib/db/types";
import type { CorrectUseInput, SettleUseInput } from "../domain/types";
import { SettlementForm } from "./settlement-form";
import { UsageForm } from "./usage-form";

// Only external framework/session boundaries are replaced. The actual query,
// strict action parser/error mapping/receipt lookup, commands and SQL all run.
const boundary = vi.hoisted(() => ({ db: null as DatabaseClient | null }));
vi.mock("@/lib/db/client", () => ({ get db() { return boundary.db; } }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: async () => ({ id: "00000000-0000-4000-8000-000000000001" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
import { confirmUseAction, correctUseAction, settleUseAction } from "@/app/(app)/cycles/[id]/consumption/actions";

describe("durable consumption form workflows", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => { fixture = await createTestDatabase(); boundary.db = fixture.db; });
  afterEach(async () => { boundary.db = null; await fixture?.close(); });
  const change = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });

  // Removing the mixed guard (or silently narrowing its manifest) breaks this
  // reachable refreshed selection; the explicit GET must then really commit.
  it("blocks refreshed mixed selection and commits only the explicitly refreshed pending-only GET", async () => {
    const s = await seedSharedConsumptionScenario(fixture.db, "100");
    const queries = createConsumptionQueryService(fixture.db);
    const commands = createConsumptionCommandService(fixture.db);
    const before = await queries.getSettlementPreview(OWNER_ID, s.itemIds);
    expect(before.contexts).toHaveLength(3);
    // Two regular recordings in another tab leave only the boxes-only source.
    for (const source of s.contexts.slice(0, 2)) {
      const { input } = await prepareConsumptionFixture(fixture.db, OWNER_ID, source.cycleId);
      await commands.confirmUse(OWNER_ID, { ...input, items: input.items.map(item => ({ ...item,
        usedQuantity: "1", basis: "OWNER_REPORTED", reason: "Measured production use" })) });
    }
    const mixed = await queries.getSettlementPreview(OWNER_ID, s.itemIds);
    expect(mixed.contexts).toHaveLength(1);
    expect(mixed.contexts[0]!.items.map(item => item.inventoryItemId)).toEqual([s.itemIds[1]]);
    expect(mixed.countedItemIds).toEqual([...s.itemIds].sort());
    const ui = render(<SettlementForm preview={mixed} action={settleUseAction} />);
    for (const count of mixed.counts) {
      const field = document.getElementById(`settle-count-${count.inventoryItemId}`)!;
      change(field, "7");
    }
    change(ui.getByLabelText("เหตุผลการนับและเคลียร์ยอดใช้"), "Count remaining after production");
    fireEvent.click(ui.getByLabelText("ยืนยันว่าของเหลือเป็นยอดหลังใช้ทุกรายการที่แสดง และผลิตเสร็จแล้ว"));
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    const form = ui.getByRole("form", { name: "นับของเหลือและเคลียร์ยอดใช้" }) as HTMLFormElement;
    const original = JSON.parse(String(new FormData(form).get("payload"))) as SettleUseInput;
    expect(original.counts.map(item => item.inventoryItemId)).toEqual(mixed.countedItemIds);
    expect(original.expectedLedger).toEqual(mixed.expectedLedger);
    expect(ui.getByRole("alert")).toHaveTextContent(/ไม่มีรอบค้างยอดใช้/);
    const flour = mixed.counts.find(row => row.inventoryItemId === s.itemIds[0])!;
    expect(ui.getByRole("link", { name: new RegExp(`นับสต๊อกปัจจุบัน ${flour.inventoryItemName}`) })).toHaveAttribute("href", `/inventory/${s.itemIds[0]}`);
    fireEvent.click(ui.getByLabelText(`นับของเหลือ ${flour.inventoryItemName}`));
    expect(new FormData(form).has("payload")).toBe(false);
    expect(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" })).toBeDisabled();
    const selector = ui.getByRole("form", { name: "เลือกรายการนับของเหลือ" }) as HTMLFormElement;
    expect(selector).toHaveAttribute("method", "get");
    const get = new URLSearchParams([...new FormData(selector)].map(([key, value]) => [key, String(value)]));
    expect(get.get("mode")).toBe("settle");
    expect(get.getAll("countItem")).toEqual([s.itemIds[1]]);
    // jsdom cannot navigate: use the real GET data to load the real fresh query,
    // then adopt it just as the route does, not a manually repaired POST.
    const fresh = await queries.getSettlementPreview(OWNER_ID, get.getAll("countItem"));
    ui.rerender(<SettlementForm preview={fresh} action={settleUseAction} />);
    expect(document.getElementById(`settle-count-${s.itemIds[1]}`)).toHaveValue("");
    change(document.getElementById(`settle-count-${s.itemIds[1]}`)!, "7");
    change(ui.getByLabelText("เหตุผลการนับและเคลียร์ยอดใช้"), "Count remaining after production");
    fireEvent.click(ui.getByLabelText("ยืนยันว่าของเหลือเป็นยอดหลังใช้ทุกรายการที่แสดง และผลิตเสร็จแล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "บันทึกยอดใช้และของเหลือพร้อมกัน" }));
    await waitFor(() => expect(ui.getByRole("status")).toHaveTextContent("บันทึกยอดใช้ 1 รอบ และยอดนับ 1 รายการแล้ว"));
    const recorded = await queries.getCycleConsumption(OWNER_ID, s.contexts[2]!.cycleId);
    expect(recorded.currentRevision!.items).toHaveLength(1);
    // One product package plus one delivery package from the shared fixture.
    expect(recorded.currentRevision!.items[0]).toMatchObject({ inventoryItemId: s.itemIds[1], usedQuantity: "2", basis: "PLANNED", mode: "COUNT_SETTLED", quantityDelta: "0" });
    const ledger = await readStockLedger(fixture.db, OWNER_ID, s.itemIds);
    expect(ledger.find(row => row.inventoryItemId === s.itemIds[1])!.balance).toBe("7");
    expect(ledger.find(row => row.inventoryItemId === s.itemIds[0])!.ledgerRevision).toBe(mixed.expectedLedger.find(row => row.inventoryItemId === s.itemIds[0])!.ledgerRevision);
  });

  // Omitting prior-PLANNED options or auto-promoting unchanged lines breaks
  // native/payload agreement and the real cancelled correction's provenance.
  it("records PLANNED, cancels normally, then attests every correction line including unchanged quantity", async () => {
    const s = await seedConsumptionScenario(fixture.db);
    const queries = createConsumptionQueryService(fixture.db);
    const pending = await queries.getCycleConsumption(OWNER_ID, s.cycleId);
    const ui = render(<UsageForm view={pending} mode="CONFIRM" action={confirmUseAction} />);
    fireEvent.click(ui.getByLabelText("ยืนยันว่าผลิตเสร็จและนำรายการนี้ออกจากสต๊อกที่ใช้ได้แล้ว"));
    fireEvent.click(ui.getByRole("button", { name: "ยืนยันยอดใช้" }));
    await waitFor(() => expect(ui.getByRole("status")).toHaveTextContent("บันทึกยอดใช้แล้ว"));
    await createCycleService(fixture.db).changeStatus(OWNER_ID, s.cycleId, "CANCELLED");
    const cancelled = await queries.getCycleConsumption(OWNER_ID, s.cycleId);
    expect(cancelled.items.map(row => row.basis)).toEqual(["PLANNED", "PLANNED"]);
    const firstRevision = cancelled.currentRevision!;
    ui.rerender(<UsageForm view={cancelled} mode="CORRECT" action={correctUseAction} />);
    const form = ui.getByRole("form", { name: "แก้ไขยอดใช้การผลิต" }) as HTMLFormElement;
    const payload = () => JSON.parse(String(new FormData(form).get("payload"))) as CorrectUseInput;
    const bases = cancelled.items.map(item => ui.getByLabelText(`ที่มาของยอดใช้ ${item.inventoryItemName}`));
    for (const select of bases) {
      expect(select).toHaveValue("PLANNED");
      expect((select as HTMLSelectElement).selectedOptions[0]!.textContent).toContain("ยังไม่ยืนยันใช้จริง");
    }
    change(ui.getByLabelText("เหตุผลการแก้ไข"), "Measured after cancellation");
    expect(payload().items.map(row => row.basis)).toEqual(["PLANNED", "PLANNED"]);
    expect(ui.getByRole("button", { name: "บันทึกการแก้ไข" })).toBeDisabled();
    change(ui.getByLabelText(`จำนวนใช้ ${cancelled.items[0]!.inventoryItemName}`), "2100");
    change(ui.getByLabelText(`เหตุผล ${cancelled.items[0]!.inventoryItemName}`), "Measured flour");
    expect(bases[0]).toHaveValue("OWNER_REPORTED");
    expect(bases[1]).toHaveValue("PLANNED");
    expect(payload().items.map(row => row.basis)).toEqual(["OWNER_REPORTED", "PLANNED"]);
    expect(ui.getByRole("button", { name: "บันทึกการแก้ไข" })).toBeDisabled();
    await userEvent.selectOptions(bases[1]!, "OWNER_REPORTED");
    expect(ui.getByLabelText(`จำนวนใช้ ${cancelled.items[1]!.inventoryItemName}`)).toHaveValue("14");
    expect(payload().items.map(row => row.basis)).toEqual(["OWNER_REPORTED", "OWNER_REPORTED"]);
    expect(ui.getByRole("button", { name: "บันทึกการแก้ไข" })).toBeEnabled();
    fireEvent.click(ui.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await waitFor(() => expect(ui.getByRole("status")).toHaveTextContent("บันทึกยอดใช้แล้ว"));
    const corrected = await queries.getCycleConsumption(OWNER_ID, s.cycleId);
    expect(corrected.history).toHaveLength(2);
    expect(corrected.history[0]).toEqual(firstRevision);
    expect(corrected.history[0]!.items.map(row => row.basis)).toEqual(["PLANNED", "PLANNED"]);
    expect(corrected.currentRevision!.items.map(row => [row.usedQuantity, row.basis, row.quantityDelta])).toEqual([
      ["2100", "OWNER_REPORTED", "100"], ["14", "OWNER_REPORTED", "0"],
    ]);
    expect(corrected.cycle.cycleStatus).toBe("CANCELLED");
  });
});
