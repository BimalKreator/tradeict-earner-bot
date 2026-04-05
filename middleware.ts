import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  isPhase1StubToken,
  verifySessionToken,
} from "@/lib/session";

/**
 * Protects /user/* and /admin/* (except /admin/login).
 * User JWT → /user only; admin JWT → /admin only.
 *
 * `AUTH_PHASE1_BYPASS` relaxes **user** routes only — admin always requires a real
 * admin JWT (stub cookie is never accepted under `/admin/*`).
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAdminArea = path.startsWith("/admin");
  const isUserArea = path.startsWith("/user");

  if (path === "/admin/login") {
    return NextResponse.next();
  }

  if (process.env.AUTH_PHASE1_BYPASS === "true" && isUserArea) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    if (isAdminArea) {
      const u = request.nextUrl.clone();
      u.pathname = "/admin/login";
      return NextResponse.redirect(u);
    }
    return redirectUserLogin(request);
  }

  if (isPhase1StubToken(token)) {
    const allowStub =
      process.env.NODE_ENV !== "production" ||
      process.env.AUTH_PHASE1_ALLOW_STUB === "true";
    if (isAdminArea) {
      const u = request.nextUrl.clone();
      u.pathname = "/admin/login";
      return NextResponse.redirect(u);
    }
    if (allowStub) {
      return NextResponse.next();
    }
    return redirectUserLogin(request);
  }

  const session = await verifySessionToken(token);
  if (!session) {
    if (isAdminArea) {
      const u = request.nextUrl.clone();
      u.pathname = "/admin/login";
      return NextResponse.redirect(u);
    }
    return redirectUserLogin(request);
  }

  if (isAdminArea) {
    if (session.role === "user") {
      const u = request.nextUrl.clone();
      u.pathname = "/user/dashboard";
      return NextResponse.redirect(u);
    }
    if (session.role !== "admin") {
      const u = request.nextUrl.clone();
      u.pathname = "/admin/login";
      return NextResponse.redirect(u);
    }
  }

  if (isUserArea) {
    if (session.role !== "user") {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      u.searchParams.set("error", "user");
      return NextResponse.redirect(u);
    }
  }

  return NextResponse.next();
}

function redirectUserLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/user/:path*", "/admin/:path*"],
};
