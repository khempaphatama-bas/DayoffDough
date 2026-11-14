import type { db } from "./client";

export type DatabaseClient = typeof db;
export type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
