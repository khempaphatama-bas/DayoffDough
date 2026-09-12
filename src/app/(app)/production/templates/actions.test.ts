import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateActionState } from "./actions";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const service = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), duplicate: vi.fn(), setActive: vi.fn() }));
const next = vi.hoisted(() => ({ revalidatePath: vi.fn(), redirect: vi.fn() }));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: auth.requireOwner }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/modules/production/application/template-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/production/application/template-service")>()),
  createProductionTemplateService: () => service,
}));
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: next.redirect }));

import { TemplateStateError, TemplateValidationError } from "@/modules/production/application/template-service";
import { duplicateProductionTemplateAction, saveProductionTemplateAction, setProductionTemplateActiveAction } from "./actions";

const INITIAL: TemplateActionState = { status: "IDLE", message: null, fieldErrors: {}, values: {} };
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  data.set("templateId", TEMPLATE_ID);
  data.set("name", "ฟอคคาเซียชุดใหม่");
  data.set("scope", "PRODUCT");
  data.set("productId", PRODUCT_ID);
  data.set("activities", JSON.stringify([{ id: null, name: "ผสมแป้ง", offsetDaysFromDelivery: -1, defaultTime: "08:00", estimatedDurationMinutes: 30, sequence: 1, notes: null, active: true }]));
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

describe("production template actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    next.redirect.mockImplementation((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
  });

  it("authenticates before parsing or calling the template service", async () => {
    auth.requireOwner.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(saveProductionTemplateAction(INITIAL, new FormData())).rejects.toThrow("Unauthorized");
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });

  it("derives owner solely from the verified session and revalidates before redirecting a save", async () => {
    service.update.mockResolvedValue({ id: TEMPLATE_ID });
    const data = form({ ownerId: "99999999-9999-4999-8999-999999999999" });
    await expect(saveProductionTemplateAction(INITIAL, data)).rejects.toThrow(`NEXT_REDIRECT:/production/templates/${TEMPLATE_ID}`);
    expect(service.update).toHaveBeenCalledWith(OWNER_ID, TEMPLATE_ID, expect.objectContaining({ productId: PRODUCT_ID }));
    expect(JSON.stringify(service.update.mock.calls)).not.toContain("99999999");
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/production/templates"],
      ["/production/templates/[id]", "page"],
      ["/cycles/[id]/planning", "page"],
    ]);
  });

  it("returns Thai validation errors with submitted values and hides raw SQL", async () => {
    service.create.mockRejectedValueOnce(new TemplateValidationError("SELECT * FROM secret"));
    const result = await saveProductionTemplateAction(INITIAL, form({ templateId: "" }));
    expect(result).toMatchObject({ status: "ERROR", message: "กรุณาตรวจสอบข้อมูลเทมเพลต" });
    expect(JSON.stringify(result)).not.toContain("SELECT");
    expect(result.values.name).toBe("ฟอคคาเซียชุดใหม่");
  });

  it("duplicates and changes active state with verified owner then refreshes template and planning views", async () => {
    service.duplicate.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" });
    const duplicateData = new FormData(); duplicateData.set("templateId", TEMPLATE_ID);
    await expect(duplicateProductionTemplateAction(duplicateData)).rejects.toThrow("NEXT_REDIRECT:/production/templates/44444444-4444-4444-8444-444444444444");
    expect(service.duplicate).toHaveBeenCalledWith(OWNER_ID, TEMPLATE_ID);
    vi.clearAllMocks(); auth.requireOwner.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    service.setActive.mockResolvedValue({ id: TEMPLATE_ID });
    const activeData = new FormData(); activeData.set("templateId", TEMPLATE_ID); activeData.set("active", "true");
    await expect(setProductionTemplateActiveAction(activeData)).rejects.toThrow("NEXT_REDIRECT:/production/templates");
    expect(service.setActive).toHaveBeenCalledWith(OWNER_ID, TEMPLATE_ID, true);
    expect(next.revalidatePath.mock.calls).toEqual([
      ["/production/templates"],
      ["/production/templates/[id]", "page"],
      ["/cycles/[id]/planning", "page"],
    ]);
  });

  it("maps an inaccessible or invalid action to Thai-safe state", async () => {
    service.create.mockRejectedValueOnce(new TemplateStateError("Template not found"));
    await expect(saveProductionTemplateAction(INITIAL, form({ templateId: "" }))).resolves.toMatchObject({
      status: "ERROR", message: "ไม่พบเทมเพลตที่ต้องการ",
    });
  });
});
