import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthenticatedError from "./error";

describe("AuthenticatedError", () => {
  it("offers Thai recovery without leaking the original error", () => {
    const retry = vi.fn();

    render(
      <AuthenticatedError
        error={new Error("DATABASE_URL=secret")}
        retry={retry}
      />,
    );

    expect(screen.getByText("เปิดข้อมูลไม่สำเร็จ")).toBeInTheDocument();
    expect(
      screen.getByText(
        "กรุณาลองอีกครั้ง หากยังไม่สำเร็จให้ตรวจการเชื่อมต่อแล้วรีเฟรชหน้า",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/DATABASE_URL/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
