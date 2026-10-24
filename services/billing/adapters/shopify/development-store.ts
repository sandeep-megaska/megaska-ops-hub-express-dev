// Shopify accepts only test charges on development stores (Partner dev stores and the
// stores app reviewers use), so subscriptions created there must set `test: true`.
// https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review

type GraphqlExecutor = <T>(query: string, variables: Record<string, unknown>, options: { shopDomain: string }) => Promise<T>;

export const SHOP_PLAN_QUERY = `query LoopDeskShopPlan { shop { plan { partnerDevelopment } } }`;

/**
 * True when the shop is a development store. A failed lookup returns false (a real
 * charge), so a store that should pay is never given a free test subscription.
 */
export async function isDevelopmentStore(execute: GraphqlExecutor, shopDomain: string): Promise<boolean> {
  try {
    const data = await execute<{ shop?: { plan?: { partnerDevelopment?: boolean | null } | null } | null }>(SHOP_PLAN_QUERY, {}, { shopDomain });
    return data?.shop?.plan?.partnerDevelopment === true;
  } catch {
    return false;
  }
}
