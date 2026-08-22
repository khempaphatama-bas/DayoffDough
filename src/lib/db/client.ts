import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/lib/env/server";
import * as schema from "@/lib/db/schema";

const queryClient = postgres(getServerEnv().SUPABASE_DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient, { schema });
