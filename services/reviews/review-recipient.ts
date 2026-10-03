
// Review request recipient. The customer profile email is preferred; when the
// profile has none (phone-only OTP customers, or profiles created from a Shopify
// order), the order's contact email is read live from Shopify for this send only.
// Nothing is written back to the profile, so customer identity rules are unchanged.

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

// Loaded lazily so this module stays importable in node:test.
const defaultGraphql: Graphql = async (query, variables, options) =>
  ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options);

const ORDER_CONTACT_EMAIL_QUERY = `query ReviewOrderContactEmail($id: ID!) {
  order(id: $id) { email customer { defaultEmailAddress { emailAddress } } }
}`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipientEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export async function fetchShopifyOrderContactEmail(
  input: { shopDomain: string; shopifyOrderId: string },
  graphql: Graphql = defaultGraphql,
): Promise<string | null> {
  const data = await graphql<{ order: { email?: string | null; customer?: { defaultEmailAddress?: { emailAddress?: string | null } | null } | null } | null }>(
    ORDER_CONTACT_EMAIL_QUERY,
    { id: input.shopifyOrderId },
    { shopDomain: input.shopDomain },
  );
  return normalizeRecipientEmail(data.order?.email) ?? normalizeRecipientEmail(data.order?.customer?.defaultEmailAddress?.emailAddress);
}

export async function resolveReviewRecipientEmail(
  input: { profileEmail: string | null | undefined; shopDomain: string | null | undefined; shopifyOrderId: string | null | undefined },
  fetchOrderEmail: typeof fetchShopifyOrderContactEmail = fetchShopifyOrderContactEmail,
): Promise<string | null> {
  const profileEmail = normalizeRecipientEmail(input.profileEmail);
  if (profileEmail) return profileEmail;
  if (!input.shopDomain || !input.shopifyOrderId) return null;
  // Lookup failures propagate so the caller can retry instead of treating a
  // transient Shopify error as an unreachable customer.
  return fetchOrderEmail({ shopDomain: input.shopDomain, shopifyOrderId: input.shopifyOrderId });
}
