import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { assertOwnerEmail } from "./owner-policy";

export type OwnerIdentity = Readonly<{
  id: string;
  email: string;
}>;

export async function requireOwner(): Promise<OwnerIdentity> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;
  const email = data?.claims?.email;
  if (error || typeof subject !== "string" || typeof email !== "string") {
    redirect("/login");
  }
  return { id: subject, email: assertOwnerEmail(email, getServerEnv().OWNER_EMAIL) };
}
