// Publishes the prepaid ("Pay Online") offer to a shop metafield that the
// LoopD2C discount Function reads at Shopify Checkout. The Function is
// server-authoritative on the amount: it never trusts a cart attribute for the
// value, only this metafield (gated by the `loopd2c_payment_intent` attribute).
//
// The Function parses this JSON (see extensions/loopdesk-discount-function/src/
// prepaid.rs): { schemaVersion, type, percent?, amount?, maxAmount?, minSubtotal? }
// with all money fields in MAJOR currency units (e.g. rupees), percent as a
// plain number string.

export const PREPAID_OFFER_METAFIELD_NAMESPACE = "$app:loopd2c-express" as const;
export const PREPAID_OFFER_METAFIELD_KEY = "prepaid-offer" as const;
export const PREPAID_OFFER_METAFIELD_TYPE = "json" as const;

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

export type PrepaidOfferInput = {
  enabled: boolean;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  // For PERCENTAGE: a percent (e.g. 15). For FIXED_AMOUNT: paise (minor units).
  value: number;
  maxPaise: number;
  minSubtotalPaise: number;
};

function paiseToMajor(paise: number): string {
  return (Math.max(0, Math.round(paise)) / 100).toFixed(2);
}

// The metafield value the Function will parse. When the offer is disabled we
// publish `{}` so the strict parser rejects it (schemaVersion/type required) and
// the Function applies no prepaid discount.
export function buildPrepaidOfferMetafieldValue(offer: PrepaidOfferInput): string {
  if (!offer.enabled || !(offer.value > 0)) return "{}";
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    type: offer.type,
    maxAmount: paiseToMajor(offer.maxPaise),
    minSubtotal: paiseToMajor(offer.minSubtotalPaise),
  };
  if (offer.type === "PERCENTAGE") base.percent = String(offer.value);
  else base.amount = paiseToMajor(offer.value);
  return JSON.stringify(base);
}

// Best-effort publish: a metafield failure must not fail the settings save, so
// callers should not await-throw this into the response path. Returns the write
// result for logging/tests.
export async function publishPrepaidOfferMetafield(
  shopDomain: string,
  offer: PrepaidOfferInput,
  deps: { graphql?: Graphql } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const graphql = deps.graphql ?? (await import("../shopify/admin.ts")).shopifyAdminGraphql;
  const shop = await graphql<{ shop?: { id?: string | null } | null }>(`query LoopD2CShopId { shop { id } }`, {}, { shopDomain });
  const ownerId = shop?.shop?.id;
  if (!ownerId) return { ok: false, reason: "shop_id_unavailable" };

  const value = buildPrepaidOfferMetafieldValue(offer);
  const data = await graphql<{ metafieldsSet: { userErrors: Array<{ message?: string; field?: string[] }> } }>(
    `mutation LoopD2CSetPrepaidOffer($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
    { metafields: [{ ownerId, namespace: PREPAID_OFFER_METAFIELD_NAMESPACE, key: PREPAID_OFFER_METAFIELD_KEY, type: PREPAID_OFFER_METAFIELD_TYPE, value }] },
    { shopDomain },
  );
  const errors = data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) return { ok: false, reason: errors.map((e) => e.message).filter(Boolean).join("; ") || "metafield_user_error" };
  return { ok: true };
}
