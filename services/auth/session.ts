import crypto from "crypto";
import type { NextRequest } from "next/server";

export const CUSTOMER_SESSION_COOKIE_NAME = "megaska_customer_session";
export const CUSTOMER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getCustomerSessionCookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE_SECONDS,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function getSessionTokenFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() || "";
  const cookieToken = req.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.value?.trim() || "";

  return bearerToken || queryToken || cookieToken;
}
