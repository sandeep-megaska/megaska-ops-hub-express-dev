// Canonical event_id contract shared by the server (Node crypto, see capi.ts)
// and the storefront Web Pixel (crypto.subtle, see
// extensions/megaska-meta-pixel/src/event-id.js).
//
// Meta deduplicates a browser Pixel event against a server CAPI event ONLY when
// both carry the SAME event_id for the SAME pixel. That holds iff both sides:
//   1. normalize the order identifier to the SAME string, and
//   2. hash the SAME input string (`${eventName}:${sourceId}`) with SHA-256 and
//      take the SAME hex prefix.
// Both rules live here so the two implementations cannot drift. The browser copy
// in the extension MIRRORS this file; services/meta/event-id.test.mts asserts
// the two derivations produce identical output.

/** Length of the hex event_id prefix. Meta accepts up to 100 chars; 32 hex
 *  chars (128 bits) is collision-safe and compact. */
export const META_EVENT_ID_LENGTH = 32;

/** The exact string that gets SHA-256'd. MUST match the browser mirror. */
export function buildEventIdInput(eventName: string, sourceId: string): string {
  return `${eventName}:${sourceId}`;
}

/**
 * Reduce any Shopify order identifier — a numeric id, an admin GraphQL GID
 * (`gid://shopify/Order/123`), or a display name (`#1001`) — to the bare numeric
 * order id used on BOTH sides as the dedup source. Returns "" when no digits are
 * present. The storefront Pixel's `checkout.order.id` and the server webhook's
 * `id` both reduce to the same value here.
 */
export function normalizeOrderSourceId(idLike: unknown): string {
  const raw = typeof idLike === "string" ? idLike : idLike == null ? "" : String(idLike);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // GID / URL form: take the last path segment, then its trailing digit run.
  const tail = trimmed.includes("/") ? trimmed.split("/").pop() || trimmed : trimmed;
  const digits = tail.match(/\d+/g);
  return digits ? digits[digits.length - 1] : "";
}
