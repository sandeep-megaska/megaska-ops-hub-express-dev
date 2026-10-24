// Shopify accepts app charges in USD or in the store's own billing currency.
// https://shopify.dev/docs/apps/launch/billing

type GraphqlExecutor = <T>(query: string, variables: Record<string, unknown>, options: { shopDomain: string }) => Promise<T>;

export const BILLING_CURRENCY_QUERY = `query LoopDeskBillingCurrency { shopBillingPreferences { currency } }`;

/** The store's Shopify billing currency, or null when it can't be read. */
export async function storeBillingCurrency(execute: GraphqlExecutor, shopDomain: string): Promise<string | null> {
  try {
    const data = await execute<{ shopBillingPreferences?: { currency?: string | null } | null }>(BILLING_CURRENCY_QUERY, {}, { shopDomain });
    const currency = String(data?.shopBillingPreferences?.currency || "").trim().toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : null;
  } catch {
    return null;
  }
}

export type ChargePrice = { amount: string; currency: string };

/**
 * The plan price in the plan's currency when the store is billed in it (or its billing
 * currency is unknown), otherwise the plan's USD price. Null when the store can't be
 * charged: it's billed in another currency and the plan has no USD price.
 */
export function chargePrice(plan: { amount: string; currency: string; usdAmount?: string | null }, billingCurrency: string | null): ChargePrice | null {
  if (!billingCurrency || billingCurrency === plan.currency) return { amount: plan.amount, currency: plan.currency };
  const usd = String(plan.usdAmount ?? "").trim();
  return usd ? { amount: usd, currency: "USD" } : null;
}
