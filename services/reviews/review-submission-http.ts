import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest, hashSessionToken } from "../auth/session.ts";
import { prisma } from "../db/prisma.ts";
import { isVerifiedInternalAppProxyRequest } from "../shopify/app-proxy.ts";
import { requireStorefrontShopFromRequest } from "../shopify/shop.ts";

const hits = new Map<string, { count: number; expiresAt: number }>();
export const secureHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export function reply(payload: unknown, status = 200) { return NextResponse.json(payload, { status, headers: secureHeaders }); }
export async function requireReviewProxy(request: NextRequest) {
  if (request.headers.get("x-megaska-app-proxy") !== "1" || !isVerifiedInternalAppProxyRequest(request)) return null;
  return requireStorefrontShopFromRequest(request);
}
export async function parseJson(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 16_384) return null;
  const text = await request.text();
  if (text.length > 16_384) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
}
export function allowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host || origin.endsWith(`://${request.headers.get("host")}`); } catch { return false; }
}
export function rateLimit(request: NextRequest, scope: string, limit: number, windowMs: number) {
  const key = `${scope}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous"}`;
  const now = Date.now(); const current = hits.get(key);
  if (!current || current.expiresAt <= now) { hits.set(key, { count: 1, expiresAt: now + windowMs }); return true; }
  current.count += 1; return current.count <= limit;
}
export async function activeSessionCustomerId(request: NextRequest, now = new Date()) {
  const token = getSessionTokenFromRequest(request); if (!token) return null;
  const session = await prisma.authSession.findFirst({ where: { sessionTokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { gt: now } }, select: { customerProfileId: true } });
  return session?.customerProfileId || null;
}
