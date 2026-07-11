import { LOOPDESK_AUTOMATIC_DISCOUNT_TITLE, LOOPDESK_FUNCTION_HANDLE, LOOPDESK_FUNCTION_METAFIELD_KEY, LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, LOOPDESK_FUNCTION_METAFIELD_TYPE, type LoopDeskFunctionConfiguration } from "./function-contract.ts";

export type ShopifyGraphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
export type DiscountSnapshot = { id: string; title?: string | null; status?: string | null; discountClasses?: string[] | null; appDiscountType?: { appKey?: string | null; functionId?: string | null } | null; metafield?: { namespace: string; key: string; type: string; value: string } | null };

function userErrors(errors: Array<{ message?: string; field?: string[] }> | undefined) { if (errors?.length) throw new Error(errors.map((e) => e.message || e.field?.join(".") || "Shopify user error").join("; ")); }

export async function readAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null, id: string) {
  const data = await graphql<{ node: DiscountSnapshot | null }>(`query LoopDeskDiscount($id: ID!) { node(id: $id) { ... on DiscountAutomaticApp { id title status discountClasses appDiscountType { appKey functionId } metafield(namespace: "${LOOPDESK_FUNCTION_METAFIELD_NAMESPACE}", key: "${LOOPDESK_FUNCTION_METAFIELD_KEY}") { namespace key type value } } } }`, { id }, { shopDomain });
  return data.node;
}

export async function findCanonicalAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null) {
  const data = await graphql<{ discountNodes: { nodes: Array<{ id: string; discount: DiscountSnapshot }> } }>(`query LoopDeskDiscountSearch($query: String!) { discountNodes(first: 10, query: $query) { nodes { id discount { ... on DiscountAutomaticApp { id title status discountClasses appDiscountType { appKey functionId } metafield(namespace: "${LOOPDESK_FUNCTION_METAFIELD_NAMESPACE}", key: "${LOOPDESK_FUNCTION_METAFIELD_KEY}") { namespace key type value } } } } } }`, { query: `title:'${LOOPDESK_AUTOMATIC_DISCOUNT_TITLE}'` }, { shopDomain });
  return data.discountNodes.nodes.map((node) => node.discount).find((discount) => discount?.title === LOOPDESK_AUTOMATIC_DISCOUNT_TITLE) ?? null;
}

export async function createAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null, startsAt: string) {
  const data = await graphql<{ discountAutomaticAppCreate: { automaticAppDiscount?: DiscountSnapshot | null; userErrors: Array<{ message?: string; field?: string[] }> } }>(`mutation LoopDeskCreateDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { id title status discountClasses appDiscountType { appKey functionId } } userErrors { field message } } }`, { automaticAppDiscount: { title: LOOPDESK_AUTOMATIC_DISCOUNT_TITLE, functionHandle: LOOPDESK_FUNCTION_HANDLE, startsAt, discountClasses: ["PRODUCT"] } }, { shopDomain });
  userErrors(data.discountAutomaticAppCreate.userErrors);
  if (!data.discountAutomaticAppCreate.automaticAppDiscount?.id) throw new Error("Shopify did not return a created automatic discount ID.");
  return data.discountAutomaticAppCreate.automaticAppDiscount;
}

export async function writeFunctionConfigurationMetafield(graphql: ShopifyGraphql, shopDomain: string | null, ownerId: string, configuration: LoopDeskFunctionConfiguration) {
  const data = await graphql<{ metafieldsSet: { metafields?: Array<{ id: string }> | null; userErrors: Array<{ message?: string; field?: string[] }> } }>(`mutation LoopDeskSetFunctionConfig($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`, { metafields: [{ ownerId, namespace: LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, key: LOOPDESK_FUNCTION_METAFIELD_KEY, type: LOOPDESK_FUNCTION_METAFIELD_TYPE, value: JSON.stringify(configuration) }] }, { shopDomain });
  userErrors(data.metafieldsSet.userErrors);
}
