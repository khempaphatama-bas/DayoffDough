import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionTemplateListView } from "@/modules/production/application/template-service";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), list: vi.fn(), templateList: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/production/application/template-service", () => ({ createProductionTemplateService: () => ({ list: mocks.list }) }));
vi.mock("@/modules/production/ui/template-list", () => ({ TemplateList: ({ view }: { view: ProductionTemplateListView }) => { mocks.templateList(view); return <div data-testid="template-list" />; } }));

import TemplatePage from "./page";

describe("TemplatePage", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireOwner.mockResolvedValue({ id: OWNER_ID }); mocks.list.mockResolvedValue({ cycleTemplates: [], productTemplates: [], productsMissingReadyTemplate: [] }); });
  it("authenticates before loading the owner-scoped template list", async () => {
    render(await TemplatePage());
    expect(mocks.list).toHaveBeenCalledWith(OWNER_ID);
    expect(screen.getByRole("heading", { name: "เทมเพลตการผลิต" })).toBeVisible();
  });
  it("does not query templates when authentication fails", async () => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(TemplatePage()).rejects.toThrow("Unauthorized");
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
