"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  label,
  pendingLabel = "กำลังบันทึก…",
}: Readonly<{ label: string; pendingLabel?: string }>) {
  const { pending } = useFormStatus();
  return (
    <button
      className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
