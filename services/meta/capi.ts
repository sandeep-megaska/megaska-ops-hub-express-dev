import crypto from "crypto";
import { normalizeShopifyPhone } from "../shopify/shopify-phone-normalization.ts";

// Meta (Facebook) Conversions API — server-side conversion signal.
//
// Why this exists: the browser Pixel alone loses 30–50% of conversions to
// iOS/ITP/ad-blockers, and Meta's ad optimization is only as good as the signal
// it receives. Sending Purchase / AddToCart / InitiateCheckout server-to-server
// — with SHA-256 hashed customer data and an event_id that matches the Pixel —
// recovers measured conversions and improves ROAS without touching a single ad.
//
// Design mirrors services/ai/openai-client.ts:
//   * dependency-free (REST via fetch),
//   * feature-flagged on env (returns a `disabled` result when unconfigured),
//   * NEVER throws — this runs inside order webhooks and analytics paths, so a
//     Meta outage or misconfig must degrade to a no-op, never break checkout.
//
// Multi-tenant seam ("own store now, SaaS later"): every send takes an explicit
// `MetaCapiConfig`. Today `resolveMetaCapiConfig()` reads process.env for the
// single megaska store; later a per-shop resolver (reading encrypted tokens
// from the DB, like services/shopify/admin-token.ts) drops in with zero changes
// to callers.

const DEFAULT_GRAPH_API_VERSION = "v21.0";
const DEFAULT_TIMEOUT_MS = 8_000;
// Meta rejects events older than 7 days; clamp defensively.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type MetaCapiConfig = {
  pixelId: string;
  accessToken: string;
  graphApiVersion: string;
  /** Optional: routes events to Test Events in Events Manager instead of live. */
  testEventCode?: string;
};

/** Raw, UNHASHED customer + browser identifiers. Hashing happens here, once. */
export type MetaUserData = {
  email?: string | null;
  phone?: string | null;
  /** Two-letter ISO country for phone normalization (defaults to IN). */
  phoneCountry?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  /** Stable per-customer id (e.g. Shopify customer GID). Hashed before send. */
  externalId?: string | null;
  // Browser-captured, sent RAW (Meta matches on these — hashing breaks them):
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  fbc?: string | null; // _fbc cookie (click id)
  fbp?: string | null; // _fbp cookie (browser id)
};

export type MetaEventInput = {
  eventName:
    | "Purchase"
    | "AddToCart"
    | "InitiateCheckout"
    | "AddPaymentInfo"
    | "ViewContent"
    | "Search"
    | "Lead"
    | "CompleteRegistration"
    | (string & {});
  /**
   * MUST equal the Pixel's event_id for the same event so Meta deduplicates.
   * For server-authoritative events (Purchase), derive it deterministically
   * from the order id via `deterministicEventId` so retries stay idempotent.
   */
  eventId: string;
  /** Epoch milliseconds; clamped into Meta's 7-day window. Defaults to now. */
  eventTimeMs?: number;
  /** The page URL where the event occurred (required for website events). */
  eventSourceUrl?: string | null;
  actionSource?: "website" | "app" | "phone_call" | "chat" | "email" | "other";
  user: MetaUserData;
  customData?: {
    currency?: string; // ISO 4217, e.g. "INR"
    value?: number; // major units (rupees), NOT paise
    contentIds?: string[];
    contentType?: "product" | "product_group";
    contents?: Array<{ id: string; quantity?: number; item_price?: number }>;
    numItems?: number;
    orderId?: string;
    [key: string]: unknown;
  };
};

export type MetaCapiResult = {
  ok: boolean;
  /** True when Meta CAPI is not configured — caller should treat as no-op. */
  disabled: boolean;
  /** HTTP status from the Graph API, when a request was actually made. */
  status?: number;
  /** Count Meta reports as received (events_received), when available. */
  eventsReceived?: number;
  /** Non-sensitive Meta trace id for support, when available. */
  fbTraceId?: string;
  error?: string;
};

export function isMetaCapiConfigured(source: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    String(source.META_PIXEL_ID || "").trim() && String(source.META_CAPI_ACCESS_TOKEN || "").trim(),
  );
}

/**
 * Single-tenant resolver (megaska's own store). Returns null when unconfigured
 * so callers degrade to a no-op. The SaaS-later per-shop resolver has the same
 * signature shape and returns a config built from decrypted per-shop tokens.
 */
export function resolveMetaCapiConfig(source: Record<string, string | undefined> = process.env): MetaCapiConfig | null {
  const pixelId = String(source.META_PIXEL_ID || "").trim();
  const accessToken = String(source.META_CAPI_ACCESS_TOKEN || "").trim();
  if (!pixelId || !accessToken) return null;
  return {
    pixelId,
    accessToken,
    graphApiVersion: String(source.META_GRAPH_API_VERSION || "").trim() || DEFAULT_GRAPH_API_VERSION,
    testEventCode: String(source.META_CAPI_TEST_EVENT_CODE || "").trim() || undefined,
  };
}

/**
 * Deterministic event id for dedup + idempotency. The SAME logical event
 * (e.g. Purchase for order 12345) must always yield the SAME id so that (a) the
 * Pixel and CAPI copies collapse into one, and (b) webhook retries don't
 * double-count. Not security-sensitive — just a stable, collision-resistant tag.
 */
export function deterministicEventId(eventName: string, sourceId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${eventName}:${sourceId}`)
    .digest("hex")
    .slice(0, 32);
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Lowercase + trim + strip internal whitespace, then hash. Meta's rule for
 *  names/city/state/country. Returns undefined for empty input. */
function hashNormalized(value: string | null | undefined): string | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return normalized ? sha256Hex(normalized) : undefined;
}

function hashEmail(value: string | null | undefined): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  // Cheap sanity gate — never hash a non-email into the em field.
  if (!normalized || !normalized.includes("@")) return undefined;
  return sha256Hex(normalized);
}

/** Meta wants phone as digits-only WITH country code, no '+'. We first coerce
 *  to E.164 via the shared Shopify normalizer, then strip non-digits. */
function hashPhone(value: string | null | undefined, country: string | null | undefined): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const normalized = normalizeShopifyPhone({ phone: raw, countryCode: country ?? "IN" });
  const e164 = normalized.ok ? normalized.phoneE164 : raw;
  const digits = e164.replace(/\D/g, "");
  return digits ? sha256Hex(digits) : undefined;
}

/** Zip: lowercase, trim, drop spaces (keep as-is otherwise) then hash. */
function hashZip(value: string | null | undefined): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return normalized ? sha256Hex(normalized) : undefined;
}

/** Build Meta's `user_data`: PII fields hashed, browser identifiers raw. Only
 *  present keys are emitted — Meta improves match rate with more fields but
 *  never requires all of them. */
export function buildUserData(user: MetaUserData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, val: string | undefined) => {
    if (val) out[key] = [val]; // Meta expects arrays for hashed multi-value keys
  };

  set("em", hashEmail(user.email));
  set("ph", hashPhone(user.phone, user.phoneCountry));
  set("fn", hashNormalized(user.firstName));
  set("ln", hashNormalized(user.lastName));
  set("ct", hashNormalized(user.city));
  set("st", hashNormalized(user.state));
  set("zp", hashZip(user.zip));
  set("country", hashNormalized(user.country));
  if (user.externalId) out.external_id = [sha256Hex(String(user.externalId).trim().toLowerCase())];

  // Raw (unhashed) — Meta matches directly on these.
  if (user.clientIpAddress) out.client_ip_address = user.clientIpAddress;
  if (user.clientUserAgent) out.client_user_agent = user.clientUserAgent;
  if (user.fbc) out.fbc = user.fbc;
  if (user.fbp) out.fbp = user.fbp;

  return out;
}

function clampEventTimeSeconds(eventTimeMs: number | undefined, now: number): number {
  const ms = typeof eventTimeMs === "number" && Number.isFinite(eventTimeMs) ? eventTimeMs : now;
  const floor = now - MAX_EVENT_AGE_MS;
  const clamped = Math.min(now, Math.max(floor, ms));
  return Math.floor(clamped / 1000);
}

// Meta's custom_data uses snake_case keys. Callers get an ergonomic camelCase
// API (contentIds, numItems, …); translate the known keys here and pass any
// other custom keys through untouched so nothing is silently dropped on the wire.
const CUSTOM_DATA_KEY_MAP: Record<string, string> = {
  contentIds: "content_ids",
  contentType: "content_type",
  numItems: "num_items",
  orderId: "order_id",
};

function normalizeCustomData(customData: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customData)) {
    if (value === undefined) continue;
    out[CUSTOM_DATA_KEY_MAP[key] ?? key] = value;
  }
  return out;
}

/** Shape a single event into Meta's server-event schema. Exported for testing
 *  and for callers that want to batch-build before sending. */
export function buildServerEvent(event: MetaEventInput, now: number = Date.now()): Record<string, unknown> {
  const customData = event.customData ? normalizeCustomData(event.customData) : undefined;
  const payload: Record<string, unknown> = {
    event_name: event.eventName,
    event_time: clampEventTimeSeconds(event.eventTimeMs, now),
    event_id: event.eventId,
    action_source: event.actionSource || "website",
    user_data: buildUserData(event.user),
  };
  if (event.eventSourceUrl) payload.event_source_url = event.eventSourceUrl;
  if (customData) payload.custom_data = customData;
  return payload;
}

/**
 * Send one or more events to Meta's Conversions API. Never throws: returns a
 * structured result the caller can log. A `disabled` result means CAPI is not
 * configured (treat as a successful no-op).
 */
export async function sendCapiEvents(
  events: MetaEventInput[],
  options: { config?: MetaCapiConfig | null; timeoutMs?: number; now?: number } = {},
): Promise<MetaCapiResult> {
  const config = options.config ?? resolveMetaCapiConfig();
  if (!config) return { ok: true, disabled: true };
  if (!events.length) return { ok: true, disabled: false, eventsReceived: 0 };

  const now = options.now ?? Date.now();
  const url =
    `https://graph.facebook.com/${config.graphApiVersion}/${config.pixelId}/events` +
    `?access_token=${encodeURIComponent(config.accessToken)}`;

  const body: Record<string, unknown> = { data: events.map((e) => buildServerEvent(e, now)) };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as
      | { events_received?: number; fbtrace_id?: string; error?: { message?: string } }
      | null;

    if (!response.ok) {
      // Never surface the access token; Meta echoes only its own error text.
      return {
        ok: false,
        disabled: false,
        status: response.status,
        fbTraceId: data?.fbtrace_id,
        error: data?.error?.message || `Meta CAPI request failed (${response.status})`,
      };
    }

    return {
      ok: true,
      disabled: false,
      status: response.status,
      eventsReceived: data?.events_received,
      fbTraceId: data?.fbtrace_id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, disabled: false, error: `Meta CAPI transport error: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convenience wrapper for the highest-value event: a completed purchase. Derives
 * a deterministic, retry-safe event_id from the order id (pass the SAME id to
 * the browser Pixel to dedupe). `valueRupees` is major units, not paise.
 */
export async function trackPurchase(input: {
  orderId: string;
  valueRupees: number;
  currency?: string;
  user: MetaUserData;
  contents?: Array<{ id: string; quantity?: number; item_price?: number }>;
  eventSourceUrl?: string | null;
  eventTimeMs?: number;
  config?: MetaCapiConfig | null;
}): Promise<MetaCapiResult> {
  const contentIds = input.contents?.map((c) => c.id);
  return sendCapiEvents(
    [
      {
        eventName: "Purchase",
        eventId: deterministicEventId("Purchase", input.orderId),
        eventTimeMs: input.eventTimeMs,
        eventSourceUrl: input.eventSourceUrl ?? undefined,
        actionSource: "website",
        user: input.user,
        customData: {
          currency: input.currency || "INR",
          value: input.valueRupees,
          orderId: input.orderId,
          contentType: "product",
          contentIds,
          contents: input.contents,
          numItems: input.contents?.reduce((n, c) => n + (c.quantity ?? 1), 0),
        },
      },
    ],
    { config: input.config },
  );
}
