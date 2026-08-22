import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireOwner } from "@/lib/auth/require-owner";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireOwner();
  return <AppShell>{children}</AppShell>;
}
