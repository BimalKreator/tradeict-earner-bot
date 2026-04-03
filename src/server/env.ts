import { z } from "zod";

/**
 * Server-only environment validation. Import this from server modules (Route Handlers,
 * server components that only read env indirectly via db/auth helpers, etc.).
 * Client components must use NEXT_PUBLIC_* only (none defined yet for Phase 1).
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  /** When true, middleware does not enforce session cookies on /user and /admin routes. */
  AUTH_PHASE1_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Allows POST /api/auth/stub outside development when explicitly enabled. */
  AUTH_PHASE1_ALLOW_STUB: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TZ: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_PHASE1_BYPASS: process.env.AUTH_PHASE1_BYPASS,
    AUTH_PHASE1_ALLOW_STUB: process.env.AUTH_PHASE1_ALLOW_STUB,
    TZ: process.env.TZ,
  });

  if (!parsed.success) {
    console.error("Invalid server environment:", parsed.error.flatten());
    throw new Error("Invalid server environment variables");
  }

  return parsed.data;
}

/** Lazily validated singleton — throws only when first read and vars are invalid. */
let cached: ServerEnv | null = null;
export function serverEnv(): ServerEnv {
  if (!cached) cached = getServerEnv();
  return cached;
}
