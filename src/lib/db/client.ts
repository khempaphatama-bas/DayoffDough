import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/lib/env/server";
import * as schema from "@/lib/db/schema";

const { SUPABASE_DATABASE_URL, SUPABASE_DATABASE_CA_PEM } = getServerEnv();
const queryClient = postgres(SUPABASE_DATABASE_URL, {
  prepare: false,
  ...(SUPABASE_DATABASE_CA_PEM && {
    ssl: { ca: SUPABASE_DATABASE_CA_PEM, rejectUnauthorized: true },
  }),
});
export const db = drizzle(queryClient, { schema });
