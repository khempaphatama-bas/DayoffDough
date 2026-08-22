import type { ReactNode } from "react";
import { requireOwner } from "@/lib/auth/require-owner";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireOwner();
  return children;
}
