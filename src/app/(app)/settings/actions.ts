"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { parseBahtToSatang } from "@/modules/money/domain/money";
import { createSettingsService } from "@/modules/settings/application/settings";

export type SettingsActionState = Readonly<{
  error: string | null;
  saved: boolean;
}>;

const formSchema = z.object({
  laborRateBaht: z.string().min(1),
  defaultWasteAllowancePercent: z.string().min(1),
  timezone: z.literal("Asia/Bangkok"),
  currency: z.literal("THB"),
});

export async function saveSettings(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const owner = await requireOwner();
  const parsed = formSchema.safeParse({
    laborRateBaht: formData.get("laborRateBaht"),
    defaultWasteAllowancePercent: formData.get("defaultWasteAllowancePercent"),
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) {
    return { error: "กรุณาตรวจสอบข้อมูลการตั้งค่าร้าน", saved: false };
  }

  try {
    const service = createSettingsService(db);
    await service.upsert(owner.id, {
      laborRateSatangPerHour: parseBahtToSatang(parsed.data.laborRateBaht),
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
      defaultWasteAllowancePercent: parsed.data.defaultWasteAllowancePercent,
    });
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { error: null, saved: true };
  } catch {
    return { error: "บันทึกไม่สำเร็จ กรุณาตรวจสอบจำนวนเงินและเปอร์เซ็นต์", saved: false };
  }
}
