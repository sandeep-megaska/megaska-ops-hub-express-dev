// Auto-registers the LoopD2C payment customization (hide COD on prepaid carts)
// so merchants never need to run an Admin GraphQL mutation by hand. Mirrors how
// the promotions module creates its automatic discount from a Function.
//
// The customization is inert unless a cart carries loopd2c_payment_intent=prepaid
// (only set by the in-drawer choice), so creating it is safe for every shop.

export const PAYMENT_CUSTOMIZATION_TITLE = "LoopD2C — hide COD on prepaid" as const;
// apiType Shopify reports for a cart.payment-methods.transform.run function.
const PAYMENT_CUSTOMIZATION_API_TYPE = "payment_customization" as const;

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

export type EnsurePaymentCustomizationResult =
  | { ok: true; id: string; created: boolean; enabled: boolean }
  | { ok: false; reason: string };

const FUNCTIONS_QUERY = `query LoopD2CShopifyFunctions { shopifyFunctions(first: 100) { nodes { id title apiType } } }`;
const CUSTOMIZATIONS_QUERY = `query LoopD2CPaymentCustomizations { paymentCustomizations(first: 100) { nodes { id title enabled } } }`;
const CREATE_MUTATION = `mutation LoopD2CPaymentCustomizationCreate($input: PaymentCustomizationInput!) { paymentCustomizationCreate(paymentCustomization: $input) { paymentCustomization { id enabled } userErrors { field message } } }`;
const UPDATE_MUTATION = `mutation LoopD2CPaymentCustomizationUpdate($id: ID!, $input: PaymentCustomizationInput!) { paymentCustomizationUpdate(id: $id, paymentCustomization: $input) { paymentCustomization { id enabled } userErrors { field message } } }`;

export async function ensurePaymentCustomization(
  shopDomain: string,
  deps: { graphql?: Graphql } = {},
): Promise<EnsurePaymentCustomizationResult> {
  const graphql = deps.graphql ?? (await import("../shopify/admin")).shopifyAdminGraphql;

  // 1. The function must be deployed (shopify app deploy) before it can be wired.
  const fns = await graphql<{ shopifyFunctions?: { nodes?: Array<{ id: string; title?: string | null; apiType?: string | null }> } }>(FUNCTIONS_QUERY, {}, { shopDomain });
  const fn = (fns?.shopifyFunctions?.nodes ?? []).find((n) => n.apiType === PAYMENT_CUSTOMIZATION_API_TYPE);
  if (!fn?.id) return { ok: false, reason: "payment_customization_function_not_deployed" };

  // 2. Reuse the existing customization (idempotent), matched by our title.
  const existing = await graphql<{ paymentCustomizations?: { nodes?: Array<{ id: string; title?: string | null; enabled?: boolean | null }> } }>(CUSTOMIZATIONS_QUERY, {}, { shopDomain });
  const match = (existing?.paymentCustomizations?.nodes ?? []).find((n) => n.title === PAYMENT_CUSTOMIZATION_TITLE);

  if (match) {
    if (match.enabled) return { ok: true, id: match.id, created: false, enabled: true };
    const updated = await graphql<{ paymentCustomizationUpdate: { paymentCustomization?: { id: string; enabled?: boolean } | null; userErrors: Array<{ message?: string }> } }>(
      UPDATE_MUTATION,
      { id: match.id, input: { functionId: fn.id, title: PAYMENT_CUSTOMIZATION_TITLE, enabled: true } },
      { shopDomain },
    );
    const errs = updated?.paymentCustomizationUpdate?.userErrors ?? [];
    if (errs.length) return { ok: false, reason: errs.map((e) => e.message).filter(Boolean).join("; ") || "update_failed" };
    return { ok: true, id: match.id, created: false, enabled: true };
  }

  // 3. Create + enable.
  const created = await graphql<{ paymentCustomizationCreate: { paymentCustomization?: { id: string; enabled?: boolean } | null; userErrors: Array<{ message?: string }> } }>(
    CREATE_MUTATION,
    { input: { functionId: fn.id, title: PAYMENT_CUSTOMIZATION_TITLE, enabled: true } },
    { shopDomain },
  );
  const errs = created?.paymentCustomizationCreate?.userErrors ?? [];
  if (errs.length) return { ok: false, reason: errs.map((e) => e.message).filter(Boolean).join("; ") || "create_failed" };
  const id = created?.paymentCustomizationCreate?.paymentCustomization?.id;
  if (!id) return { ok: false, reason: "create_returned_no_id" };
  return { ok: true, id, created: true, enabled: true };
}
