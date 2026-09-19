import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProductionTemplateListView } from "@/modules/production/application/template-service";

vi.mock("@/app/(app)/production/templates/actions", () => ({
  duplicateProductionTemplateAction: vi.fn(),
  setProductionTemplateActiveAction: vi.fn(),
}));
import { TemplateList } from "./template-list";

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

const VIEW: ProductionTemplateListView = {
  cycleTemplates: [],
  productTemplates: [
    { id: TEMPLATE_ID, name: "ฟอคคาเซียชุดใหม่", scope: "PRODUCT", productId: PRODUCT_ID, productName: "ฟอคคาเซีย", active: false, activeActivityCount: 2 },
    { id: ACTIVE_ID, name: "ชุดเดิม", scope: "PRODUCT", productId: PRODUCT_ID, productName: "ฟอคคาเซีย", active: true, activeActivityCount: 1 },
  ],
  productsMissingReadyTemplate: [{ id: "44444444-4444-4444-8444-444444444444", name: "ครัวซองต์" }],
};

describe("TemplateList", () => {
  it("requires a visible confirmation and only activates after accepting replacement", async () => {
    const activate = vi.fn();
    const user = userEvent.setup();
    render(<TemplateList view={VIEW} onSetActive={activate} onDuplicate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" }));
    expect(screen.getByRole("dialog", { name: "ยืนยันการเปลี่ยนเทมเพลตที่ใช้งาน" })).toBeVisible();
    expect(activate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันการเปิดใช้" }));
    expect(activate).toHaveBeenCalledWith(TEMPLATE_ID, true);
  });

  it("stacks the replacement confirmation above the shell chrome", async () => {
    const user = userEvent.setup();
    render(<TemplateList view={VIEW} onSetActive={vi.fn()} onDuplicate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" }));

    expect(screen.getByRole("dialog", { name: "ยืนยันการเปลี่ยนเทมเพลตที่ใช้งาน" })).toHaveClass("z-40");
  });

  it("groups cycle and product templates and highlights products without a ready template", () => {
    render(<TemplateList view={VIEW} onSetActive={vi.fn()} onDuplicate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "เทมเพลตต่อสินค้า" })).toBeVisible();
    expect(screen.getByText(/2 กิจกรรมที่ใช้งาน/)).toBeVisible();
    expect(screen.getByText("ครัวซองต์")).toBeVisible();
    expect(screen.getByRole("link", { name: "แก้ไข ฟอคคาเซียชุดใหม่" })).toHaveAttribute("href", `/production/templates/${TEMPLATE_ID}`);
  });

  it("activates a product template immediately when only another product has an active template", async () => {
    const activate = vi.fn();
    const user = userEvent.setup();
    render(<TemplateList view={{ ...VIEW, productTemplates: [
      VIEW.productTemplates[0]!,
      { ...VIEW.productTemplates[1]!, productId: "55555555-5555-4555-8555-555555555555", productName: "ครัวซองต์" },
    ] }} onSetActive={activate} onDuplicate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activate).toHaveBeenCalledWith(TEMPLATE_ID, true);
  });

  it("moves focus into the replacement modal, traps Tab, cancels with Escape, and restores the opener focus", async () => {
    const user = userEvent.setup();
    render(<TemplateList view={VIEW} onSetActive={vi.fn()} onDuplicate={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" });

    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "ยืนยันการเปลี่ยนเทมเพลตที่ใช้งาน" });
    const cancel = screen.getByRole("button", { name: "ยกเลิก" });
    const confirm = screen.getByRole("button", { name: "ยืนยันการเปิดใช้" });
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(confirm).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("shows Thai-safe duplicate and activation failures without raw service details", async () => {
    const duplicate = vi.fn().mockResolvedValue({ error: "ทำสำเนาเทมเพลตไม่สำเร็จ กรุณาลองอีกครั้ง" });
    const activate = vi.fn().mockResolvedValue({ error: "ไม่สามารถเปิดใช้เทมเพลตนี้ได้ กรุณาตรวจสอบกิจกรรมที่ใช้งาน" });
    const user = userEvent.setup();
    render(<TemplateList view={{ ...VIEW, productTemplates: [VIEW.productTemplates[0]!] }} onSetActive={activate} onDuplicate={duplicate} />);

    await user.click(screen.getByRole("button", { name: "ทำสำเนา" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ทำสำเนาเทมเพลตไม่สำเร็จ กรุณาลองอีกครั้ง");
    expect(screen.queryByText(/SELECT|secret/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "เปิดใช้เทมเพลต ฟอคคาเซียชุดใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถเปิดใช้เทมเพลตนี้ได้ กรุณาตรวจสอบกิจกรรมที่ใช้งาน");
  });
});
