import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionRole = "user" | "admin";

export type VerifiedSession = {
  userId: string;
  role: SessionRole;
};

/**
 * HS256 secret — min 32 chars in production (`AUTH_SECRET` in `.env`).
 * Development falls back to a fixed dev secret so local `next dev` works without .env noise.
 */
export function getJwtSecretBytes(): Uint8Array | null {
  const s = process.env.AUTH_SECRET?.trim();
  if (s && s.length >= 32) {
    return new TextEncoder().encode(s);
  }
  if (process.env.NODE_ENV !== "production") {
    return new TextEncoder().encode(
      "dev-only-tradeict-earner-auth-secret-key-32b",
    );
  }
  return null;
}

export async function signUserSession(userId: string): Promise<string | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  return new SignJWT({ role: "user" satisfies SessionRole })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function signAdminSession(adminId: string): Promise<string | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  return new SignJWT({ role: "admin" satisfies SessionRole })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<VerifiedSession | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const role = payload.role;
    if (!sub || (role !== "user" && role !== "admin")) {
      return null;
    }
    return { userId: sub, role };
  } catch {
    return null;
  }
}

export function isPhase1StubToken(
  token: string | undefined | null,
): boolean {
  return token === "phase1-stub";
}
