import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: auth.requireOwner,
}));
vi.mock("@/app/(app)/cycles/actions", () => ({
  createCycleAction: vi.fn(),
  updateCycleAction: vi.fn(),
}));

import NewCyclePage from "./page";

describe("NewCyclePage", () => {
  it("renders a 44px back-link hit area after authenticating", async () => {
    auth.requireOwner.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "owner@example.com",
    });

    render(await NewCyclePage());

    expect(auth.requireOwner).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "← รอบอบ" })).toHaveClass(
      "inline-flex",
      "min-h-11",
      "items-center",
    );
  });
});
