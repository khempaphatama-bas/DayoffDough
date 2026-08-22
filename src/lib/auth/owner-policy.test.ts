import { describe, expect, it } from "vitest";
import { assertOwnerEmail, OwnerAccessError } from "./owner-policy";

describe("assertOwnerEmail", () => {
  it("normalizes and accepts the configured owner", () => {
    expect(assertOwnerEmail(" OWNER@EXAMPLE.COM ", "owner@example.com")).toBe(
      "owner@example.com",
    );
  });

  it("rejects every other account", () => {
    expect(() => assertOwnerEmail("staff@example.com", "owner@example.com")).toThrow(
      OwnerAccessError,
    );
  });
});
