import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const actionMocks = vi.hoisted(() => ({ delete: vi.fn(async (_previous: unknown, _data: FormData) => ({ error: null as string | null, fieldErrors: {} as Record<string, string>, values: {} as Record<string, string>, saved: true })), update: vi.fn(async (_previous: unknown, _data: FormData) => ({ error: null as string | null, fieldErrors: {} as Record<string, string>, values: {} as Record<string, string>, saved: true })) }));
vi.mock("@/app/(app)/cycles/[id]/production/actions", () => ({
  deleteManualCycleTaskAction: actionMocks.delete,
  updateCycleTaskAction: actionMocks.update,
}));
import type { CycleProductionView, CycleTaskView } from "@/modules/production/domain/types";
import { CycleTaskList } from "./cycle-task-list";

const CYCLE_ID = "72000000-0000-4000-8000-000000000001";
const GENERATION_ID = "72000000-0000-4000-8000-000000000002";

const currentView = {
  kind: "CURRENT" as const,
  writable: true as const,
  cycle: { cycleId: CYCLE_ID, cycleNumber: 12, cycleName: "รอบส่ง 12 ก.ย.", cycleStatus: "LOCKED" as const },
  generation: {
    id: GENERATION_ID,
    cycleId: CYCLE_ID,
    planningSnapshotId: "72000000-0000-4000-8000-000000000003",
    generation: 2,
    primaryDeliveryDate: "2026-09-12",
    timezone: "Asia/Bangkok",
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    planningStatus: "ACTIVE" as const,
  },
  generations: [],
  products: [
    { id: "72000000-0000-4000-8000-000000000004", name: "ฟอคคาเซีย" },
    { id: "72000000-0000-4000-8000-000000000005", name: "บริยอช" },
  ],
  tasks: [
    {
      id: "72000000-0000-4000-8000-000000000010",
      taskGenerationId: GENERATION_ID,
      origin: "TEMPLATE" as const,
      sourceTemplateName: "ฟอคคาเซียประจำรอบ",
      sourceActivityName: "พักแป้ง",
      title: "พักแป้ง",
      productId: "72000000-0000-4000-8000-000000000004",
      productName: "ฟอคคาเซีย",
      batchCount: "2.000000",
      scheduledAt: new Date("2026-09-10T17:30:00.000Z"),
      estimatedDurationMinutes: 45,
      notes: null,
      sequence: 1,
      status: "PENDING" as const,
      skipReason: null,
    },
    {
      id: "72000000-0000-4000-8000-000000000011",
      taskGenerationId: GENERATION_ID,
      origin: "TEMPLATE" as const,
      sourceTemplateName: "บริยอชประจำรอบ",
      sourceActivityName: "พักแป้ง",
      title: "พักแป้ง",
      productId: "72000000-0000-4000-8000-000000000005",
      productName: "บริยอช",
      batchCount: "1.500000",
      scheduledAt: new Date("2026-09-10T17:40:00.000Z"),
      estimatedDurationMinutes: 30,
      notes: "ตรวจอุณหภูมิ",
      sequence: 2,
      status: "PENDING" as const,
      skipReason: null,
    },
  ],
} satisfies CycleProductionView;

describe("CycleTaskList", () => {
  it("groups by Bangkok local day and keeps same activity names as separate cards", () => {
    render(<CycleTaskList view={currentView} />);
    expect(screen.getByRole("heading", { name: "11 กันยายน 2569" })).toBeVisible();
    expect(screen.getAllByRole("article", { name: /พักแป้ง/ })).toHaveLength(2);
    expect(screen.getByText("ฟอคคาเซีย · 2 แบตช์")).toBeVisible();
    expect(screen.getByText("บริยอช · 1.5 แบตช์")).toBeVisible();
  });

  it("keeps literal years 0001 and 0099 when reconstructing Bangkok day headings", () => {
    render(<CycleTaskList view={{
      ...currentView,
      tasks: [
        {
          ...currentView.tasks[0]!,
          id: "72000000-0000-4000-8000-000000000014",
          title: "งานปีหนึ่ง",
          scheduledAt: new Date("0001-01-01T03:00:00.000Z"),
        },
        {
          ...currentView.tasks[1]!,
          id: "72000000-0000-4000-8000-000000000015",
          title: "งานปีเก้าสิบเก้า",
          scheduledAt: new Date("0099-12-31T03:00:00.000Z"),
        },
      ],
    }} />);

    expect(screen.getByRole("heading", { name: "3 มกราคม 544" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2 มกราคม 643" })).toBeVisible();
  });

  it("renders history without mutation controls", () => {
    render(<CycleTaskList view={{ ...currentView, kind: "HISTORY", writable: false, generation: { ...currentView.generation, planningStatus: "SUPERSEDED" } }} />);
    expect(screen.queryByRole("button", { name: "แก้ไขงาน" })).not.toBeInTheDocument();
    expect(screen.getByText("อ่านอย่างเดียว")).toBeVisible();
  });

  it("offers quick status choices and only shows skip reason for skipped tasks", () => {
    const skippedTask: CycleTaskView = { ...currentView.tasks[0]!, status: "SKIPPED", skipReason: "ไม่มีวัตถุดิบ" };
    render(<CycleTaskList view={{ ...currentView, tasks: [skippedTask] }} />);
    expect(screen.getByRole("button", { name: "ทำเสร็จแล้ว" })).toBeVisible();
    expect(screen.getByText("เหตุผลที่ข้าม: ไม่มีวัตถุดิบ")).toBeVisible();
    expect(screen.getByRole("button", { name: "แก้ไขงาน" })).toBeVisible();
  });

  it("allows deleting only a pending manual card", () => {
    const manual: CycleTaskView = { ...currentView.tasks[0]!, id: "72000000-0000-4000-8000-000000000012", origin: "MANUAL", sourceTemplateName: null, sourceActivityName: null };
    const generated: CycleTaskView = { ...manual, id: "72000000-0000-0000-0000-000000000013", origin: "TEMPLATE", sourceTemplateName: "generated", sourceActivityName: "generated" };
    render(<CycleTaskList view={{ ...currentView, tasks: [manual, generated] }} />);
    expect(screen.getByRole("button", { name: "ลบงาน" })).toBeVisible();
    expect(screen.getAllByRole("article")[1]).not.toHaveTextContent("ลบงาน");
  });

  it("shows quick status and delete failures visibly", async () => {
    actionMocks.update.mockResolvedValueOnce({ error: "สถานะล้มเหลว", fieldErrors: {}, values: {}, saved: false });
    actionMocks.delete.mockResolvedValueOnce({ error: "ลบไม่สำเร็จ", fieldErrors: {}, values: {}, saved: false });
    const user = (await import("@testing-library/user-event")).default.setup();
    const manual: CycleTaskView = { ...currentView.tasks[0]!, id: "72000000-0000-0000-0000-000000000012", origin: "MANUAL", sourceTemplateName: null, sourceActivityName: null };
    render(<CycleTaskList view={{ ...currentView, tasks: [manual] }} />);
    await user.click(screen.getByRole("button", { name: "ทำเสร็จแล้ว" }));
    expect(await screen.findByText("สถานะล้มเหลว")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "ลบงาน" }));
    expect(await screen.findByText("ลบไม่สำเร็จ")).toBeVisible();
  });
});
