import { z } from "zod";

const schema = z.object({
  SUPABASE_DATABASE_URL: z.string().url(),
  SUPABASE_DATABASE_CA_PEM: z.string()
    .transform((pem) => pem.replace(/\\n/g, "\n").trim())
    .pipe(z.string().min(1))
    .optional(),
  OWNER_EMAIL: z.string().email().transform((email) => email.toLowerCase()),
});

export function getServerEnv() {
  return schema.parse({
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    SUPABASE_DATABASE_CA_PEM: process.env.SUPABASE_DATABASE_CA_PEM,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
  });
}
