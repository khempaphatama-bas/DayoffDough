import { requireOwner } from "@/lib/auth/require-owner";
import { db } from "@/lib/db/client";
import { createSettingsService } from "@/modules/settings/application/settings";
import { SettingsForm } from "@/modules/settings/ui/settings-form";

export default async function SettingsPage() {
  const owner = await requireOwner();
  const settings = await createSettingsService(db).get(owner.id);
  const formValue = settings
    ? {
        laborRateSatangPerHour: settings.laborRateSatangPerHour,
        defaultWasteAllowancePercent: settings.defaultWasteAllowancePercent,
        timezone: settings.timezone,
        currency: settings.currency,
      }
    : null;

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-5 py-8">
      <header>
        <p className="mb-2 text-sm font-semibold text-amber-800">ข้อมูลตั้งต้น</p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">ตั้งค่าร้าน</h1>
        <p className="mt-2 text-stone-600">
          กำหนดค่าแรงและค่าเผื่อสูญเสียที่จะใช้คำนวณต้นทุนสูตร
        </p>
      </header>
      <SettingsForm settings={formValue} />
    </main>
  );
}
