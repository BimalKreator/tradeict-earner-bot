import { SignJWT, jwtVerify } from "jose";

import { getJwtSecretBytes } from "./session";

export async function signLoginChallengeJwt(
  userId: string,
  email: string,
): Promise<string | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  return new SignJWT({ typ: "login-otp", email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyLoginChallengeJwt(token: string): Promise<{
  userId: string;
  email: string;
} | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (
      payload.typ !== "login-otp" ||
      typeof payload.email !== "string" ||
      !payload.sub
    ) {
      return null;
    }
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function signPasswordResetChallengeJwt(
  userId: string,
): Promise<string | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  return new SignJWT({ typ: "pwd-reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyPasswordResetChallengeJwt(
  token: string,
): Promise<{ userId: string } | null> {
  const secret = getJwtSecretBytes();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (payload.typ !== "pwd-reset" || !payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
