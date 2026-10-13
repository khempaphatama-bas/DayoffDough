import { vi } from "vitest";
import type { OperationsActionState } from "@/app/(app)/cycles/[id]/operations/actions";

export const SUCCESS: OperationsActionState = { error: null, kind: null, fieldErrors: {}, saved: true };
export const ERROR: OperationsActionState = { error: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่", kind: "STALE_DATA", fieldErrors: {}, saved: false };
export function operationAction() { return vi.fn<(_previous: OperationsActionState, data: FormData) => Promise<OperationsActionState>>().mockImplementation(async () => ({ ...SUCCESS })); }
export function payloadOf(action: ReturnType<typeof operationAction>, index = -1) { return JSON.parse(String(action.mock.calls.at(index)![1].get("payload"))); }
