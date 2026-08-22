import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("separates the complete desktop navigation from five phone destinations", () => {
    render(
      <AppShell currentPath="/dashboard">
        <div>content</div>
      </AppShell>,
    );

    const desktop = within(screen.getByRole("navigation", { name: "เมนูหลัก" }));
    for (const name of [
      "รอบผลิต",
      "ออเดอร์",
      "ลูกค้า",
      "วัตถุดิบ",
      "สินค้าและสูตร",
      "การจัดส่ง",
      "ตั้งค่าร้าน",
    ]) {
      expect(desktop.getByRole("link", { name })).toBeInTheDocument();
    }

    const mobile = within(
      screen.getByRole("navigation", { name: "เมนูมือถือ" }),
    );
    expect(
      mobile.getAllByRole("link").map((link) => link.getAttribute("aria-label")),
    ).toEqual(["หน้าหลัก", "รอบผลิต", "ออเดอร์", "วัตถุดิบ", "เพิ่มเติม"]);
  });

  it("marks nested cycles and secondary phone destinations as current", () => {
    const { rerender } = render(
      <AppShell currentPath="/cycles/11111111-1111-4111-8111-111111111111">
        <div>content</div>
      </AppShell>,
    );
    expect(
      within(screen.getByRole("navigation", { name: "เมนูหลัก" })).getByRole(
        "link",
        { name: "รอบผลิต" },
      ),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(screen.getByRole("navigation", { name: "เมนูมือถือ" })).getByRole(
        "link",
        { name: "รอบผลิต" },
      ),
    ).toHaveAttribute("aria-current", "page");

    rerender(
      <AppShell currentPath="/customers">
        <div>content</div>
      </AppShell>,
    );
    expect(
      within(screen.getByRole("navigation", { name: "เมนูหลัก" })).getByRole(
        "link",
        { name: "ลูกค้า" },
      ),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(screen.getByRole("navigation", { name: "เมนูมือถือ" })).getByRole(
        "link",
        { name: "เพิ่มเติม" },
      ),
    ).toHaveAttribute("aria-current", "page");
  });
});
