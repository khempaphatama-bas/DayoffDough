import { describe, expect, it } from "vitest";
import { APP_CURRENCY, APP_NAME, APP_TIMEZONE } from "@/lib/app-meta";

describe("application metadata", () => {
  it("uses the approved bakery identity and locale defaults", () => {
    expect(APP_NAME).toBe("Day Off Dough OS");
    expect(APP_TIMEZONE).toBe("Asia/Bangkok");
    expect(APP_CURRENCY).toBe("THB");
  });
});
