import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth";

import { verifySessionToken } from "./session";

export async function readSessionFromCookies() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
