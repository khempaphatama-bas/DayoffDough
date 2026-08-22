import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("exposes all Phase 1 destinations with accessible names", () => {
    render(
      <AppShell currentPath="/dashboard">
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getAllByRole("link", { name: "หน้าหลัก" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "วัตถุดิบ" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "สินค้าและสูตร" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "การจัดส่ง" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "ตั้งค่าร้าน" }).length).toBeGreaterThan(0);
  });

  it("marks the current destination for assistive technology", () => {
    render(
      <AppShell currentPath="/inventory">
        <div>content</div>
      </AppShell>,
    );
    for (const link of screen.getAllByRole("link", { name: "วัตถุดิบ" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });
});
