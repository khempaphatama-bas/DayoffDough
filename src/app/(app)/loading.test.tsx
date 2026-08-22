import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuthenticatedLoading from "./loading";

describe("AuthenticatedLoading", () => {
  it("announces a Thai loading state", () => {
    render(<AuthenticatedLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("กำลังโหลดข้อมูล");
  });
});
