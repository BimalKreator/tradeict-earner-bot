"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  LOGIN_CHALLENGE_COOKIE,
  RESET_CHALLENGE_COOKIE,
} from "@/lib/constants-auth";
import { verifySessionToken } from "@/lib/session";

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  jar.delete(SESSION_COOKIE_NAME);
  jar.delete(LOGIN_CHALLENGE_COOKIE);
  jar.delete(RESET_CHALLENGE_COOKIE);

  if (session?.role === "admin") {
    redirect("/admin/login");
  }
  redirect("/login");
}
