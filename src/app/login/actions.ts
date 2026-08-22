"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { assertOwnerEmail } from "@/lib/auth/owner-policy";
import { getServerEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";

export type LoginState = Readonly<{ error: string | null }>;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function loginOwner(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const input = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!input.success) return { error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" };
  try {
    assertOwnerEmail(input.data.email, getServerEnv().OWNER_EMAIL);
  } catch {
    return { error: "บัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(input.data);
  if (error) return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  redirect("/dashboard");
}
