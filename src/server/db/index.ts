import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Reuse one postgres.js client in dev to avoid connection storms during HMR.
 * In production, a single pool per Node process is appropriate for this VPS deployment.
 */
const globalForDb = globalThis as unknown as {
  postgresClient: ReturnType<typeof postgres> | undefined;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.postgresClient) {
    globalForDb.postgresClient = postgres(url, { max: 10 });
  }
  return globalForDb.postgresClient;
}

const client = createClient();

/** Null when DATABASE_URL is unset (e.g. CI build without secrets). */
export const db = client ? drizzle(client, { schema }) : null;

export type Database = NonNullable<typeof db>;
