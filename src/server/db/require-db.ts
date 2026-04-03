import { db } from "./index";

import type { Database } from "./index";

/** Use in server actions / Route Handlers that require a live database. */
export function requireDb(): Database {
  if (!db) {
    throw new Error("DATABASE_URL is not configured");
  }
  return db;
}
