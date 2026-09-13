import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MorePage from "./page";

describe("MorePage", () => {
  it("offers every secondary phone destination with touch-sized links", () => {
    render(<MorePage />);

    const destinations = [
      ["ลูกค้า", "/customers"],
      ["สินค้าและสูตร", "/products"],
      ["เทมเพลตการผลิต", "/production/templates"],
      ["การจัดส่ง", "/delivery"],
      ["ตั้งค่าร้าน", "/settings"],
    ] as const;
    for (const [name, href] of destinations) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveClass("min-h-11");
    }
  });

  it("describes production templates by their planning purpose", () => {
    render(<MorePage />);

    expect(
      screen.getByRole("link", { name: "เทมเพลตการผลิต" }),
    ).toHaveTextContent("กำหนดขั้นตอนและเวลาเทียบกับวันส่ง");
  });
});
