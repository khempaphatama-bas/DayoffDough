"use client";

import { activateRecipeVersionAction } from "@/app/(app)/products/actions";

export function ActivateVersionButton({
  productId,
  versionId,
}: Readonly<{ productId: string; versionId: string }>) {
  return (
    <form
      action={activateRecipeVersionAction}
      onSubmit={(event) => {
        if (!window.confirm("ยืนยันเปิดใช้เวอร์ชันสูตรนี้?")) event.preventDefault();
      }}
    >
      <input name="productId" type="hidden" value={productId} />
      <input name="versionId" type="hidden" value={versionId} />
      <button className="min-h-11 rounded-xl border border-amber-800 px-4 font-semibold text-amber-900 hover:bg-amber-50" type="submit">เปิดใช้เวอร์ชันนี้</button>
    </form>
  );
}
