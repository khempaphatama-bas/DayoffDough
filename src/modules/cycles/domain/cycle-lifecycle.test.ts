import { describe, expect, it } from "vitest";
import {
  BAKE_CYCLE_STATUS_TRANSITIONS,
  bakeCycleStatus,
} from "./cycle-lifecycle";

describe("cycle lifecycle", () => {
  it("defines every status and its authoritative manual transitions", () => {
    expect(bakeCycleStatus).toEqual([
      "DRAFT",
      "OPEN",
      "LOCKED",
      "IN_PRODUCTION",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(BAKE_CYCLE_STATUS_TRANSITIONS).toEqual({
      DRAFT: ["OPEN", "CANCELLED"],
      OPEN: ["DRAFT", "CANCELLED"],
      LOCKED: ["IN_PRODUCTION", "CANCELLED"],
      IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
      COMPLETED: [],
      CANCELLED: [],
    });
  });
});
