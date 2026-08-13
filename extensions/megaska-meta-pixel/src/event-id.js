// Browser/Web-Pixel-sandbox mirror of services/meta/event-id.ts.
//
// This file MUST stay byte-compatible with the server: the same normalization
// and the same SHA-256(`${eventName}:${sourceId}`) hex prefix, so a browser
// Purchase and the server CAPI Purchase carry the identical event_id and Meta
// deduplicates them. services/meta/event-id.test.mts asserts parity against the
// server implementation — if you change one file, change both and re-run it.

export const META_EVENT_ID_LENGTH = 32;

/** MUST match services/meta/event-id.ts buildEventIdInput. */
export function buildEventIdInput(eventName, sourceId) {
  return `${eventName}:${sourceId}`;
}

/** MUST match services/meta/event-id.ts normalizeOrderSourceId. */
export function normalizeOrderSourceId(idLike) {
  const raw = typeof idLike === "string" ? idLike : idLike == null ? "" : String(idLike);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const tail = trimmed.includes("/") ? trimmed.split("/").pop() || trimmed : trimmed;
  const digits = tail.match(/\d+/g);
  return digits ? digits[digits.length - 1] : "";
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Async SHA-256 hex prefix of `${eventName}:${sourceId}`, using Web Crypto
 * (available in the Web Pixel sandbox). Identical output to the server's
 * synchronous deterministicEventId for the same inputs.
 */
export async function deterministicEventId(eventName, sourceId) {
  const input = buildEventIdInput(eventName, sourceId);
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest).slice(0, META_EVENT_ID_LENGTH);
}

/** Convenience: derive the Purchase event_id from any Shopify order id shape. */
export async function purchaseEventIdFromOrderId(orderIdLike) {
  const sourceId = normalizeOrderSourceId(orderIdLike);
  if (!sourceId) return "";
  return deterministicEventId("Purchase", sourceId);
}
