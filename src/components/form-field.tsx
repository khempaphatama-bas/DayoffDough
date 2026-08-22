import type { ReactNode } from "react";

export function FormField({
  label,
  hint,
  children,
}: Readonly<{ label: string; hint?: string; children: ReactNode }>) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-stone-700">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-stone-500">{hint}</span> : null}
    </label>
  );
}
