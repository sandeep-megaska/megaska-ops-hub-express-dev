import type { NextRequest } from "next/server";
import type { Prisma } from "../../generated/prisma";
import { prisma } from "../db/prisma";
import { getSessionTokenFromRequest, hashSessionToken } from "../auth/session";

// Event/dimension vocabularies mirror the Prisma enums
// (CheckoutFunnelEventType / CheckoutFunnelSource / CheckoutFunnelDevice).
const EVENT_TYPES = new Set([
  "CART_ADD",
  "DRAWER_OPEN",
  "EXPRESS_CLICK",
  "OTP_OPEN",
  "OTP_SUCCESS",
  "MODAL_OPEN",
]);
const SOURCES = new Set(["DRAWER", "CART_PAGE", "PRODUCT", "UNKNOWN"]);
const DEVICES = new Set(["MOBILE", "DESKTOP", "UNKNOWN"]);

const MAX_EVENTS_PER_BEACON = 20;
const MAX_STRING = 256;
const MAX_METADATA_BYTES = 2048;
// Guard against absurd client clocks: accept an event timestamp only if it is
// within a day of server time, otherwise stamp it server-side.
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

type IncomingEvent = {
  t?: unknown; // eventType
  src?: unknown; // source
  dev?: unknown; // device (client hint; server UA wins when client is UNKNOWN)
  sid?: unknown; // funnelSessionId
  cart?: unknown; // cartToken
  val?: unknown; // cartValuePaise
  ts?: unknown; // occurredAt (client epoch ms)
  meta?: unknown; // metadata
};

function str(value: unknown, max = MAX_STRING): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function intOrNull(value: unknown, min = 0, max = 1_000_000_000): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function deviceFromUserAgent(userAgent: string | null): "MOBILE" | "DESKTOP" | "UNKNOWN" {
  if (!userAgent) return "UNKNOWN";
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(userAgent) ? "MOBILE" : "DESKTOP";
}

function occurredAtFrom(value: unknown, now: number): Date {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(ms) && Math.abs(now - ms) <= MAX_CLOCK_SKEW_MS) return new Date(ms);
  return new Date(now);
}

function safeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_METADATA_BYTES) return null;
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Records storefront express-checkout funnel events from the app-proxy beacon.
 * Best-effort and non-throwing at the call site: analytics must never break the
 * storefront. The logged-in customer (if any) is resolved server-side from the
 * httpOnly session cookie — the client never sends identity.
 */
export async function recordFunnelEventsFromBeacon(
  request: NextRequest,
  shopId: string,
  body: unknown,
): Promise<{ inserted: number }> {
  const rawEvents = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: unknown[] }).events as IncomingEvent[])
    : [];
  if (!rawEvents.length) return { inserted: 0 };

  // Resolve the logged-in customer once for the whole beacon (best-effort).
  let customerProfileId: string | null = null;
  let sessionTokenHash: string | null = null;
  const token = getSessionTokenFromRequest(request);
  if (token) {
    sessionTokenHash = hashSessionToken(token);
    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        customer: { shopId },
      },
      select: { customerProfileId: true },
    });
    customerProfileId = session?.customerProfileId ?? null;
  }

  const uaDevice = deviceFromUserAgent(request.headers.get("user-agent"));
  const now = Date.now();

  const rows = rawEvents
    .slice(0, MAX_EVENTS_PER_BEACON)
    .map((event) => {
      const eventType = str(event.t);
      const funnelSessionId = str(event.sid, 128);
      if (!eventType || !EVENT_TYPES.has(eventType) || !funnelSessionId) return null;

      const source = str(event.src);
      const clientDevice = str(event.dev);
      const device =
        clientDevice && DEVICES.has(clientDevice) && clientDevice !== "UNKNOWN"
          ? clientDevice
          : uaDevice;

      return {
        shopId,
        funnelSessionId,
        eventType: eventType as
          | "CART_ADD"
          | "DRAWER_OPEN"
          | "EXPRESS_CLICK"
          | "OTP_OPEN"
          | "OTP_SUCCESS"
          | "MODAL_OPEN",
        source: source && SOURCES.has(source) ? (source as "DRAWER" | "CART_PAGE" | "PRODUCT" | "UNKNOWN") : null,
        device: device as "MOBILE" | "DESKTOP" | "UNKNOWN",
        customerProfileId,
        sessionTokenHash,
        cartToken: str(event.cart),
        cartValuePaise: intOrNull(event.val),
        metadata: (safeMetadata(event.meta) ?? undefined) as Prisma.InputJsonValue | undefined,
        occurredAt: occurredAtFrom(event.ts, now),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (!rows.length) return { inserted: 0 };

  const result = await prisma.checkoutFunnelEvent.createMany({ data: rows });
  return { inserted: result.count };
}
