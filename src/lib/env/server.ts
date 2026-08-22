import { z } from "zod";

const schema = z.object({
  SUPABASE_DATABASE_URL: z.string().url(),
  OWNER_EMAIL: z.string().email().transform((email) => email.toLowerCase()),
});

export function getServerEnv() {
  return schema.parse({
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
  });
}
