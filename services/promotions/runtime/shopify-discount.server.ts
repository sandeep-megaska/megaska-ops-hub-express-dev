import { LOOPDESK_AUTOMATIC_DISCOUNT_TITLE, LOOPDESK_FUNCTION_HANDLE, LOOPDESK_FUNCTION_METAFIELD_KEY, LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, LOOPDESK_FUNCTION_METAFIELD_TYPE, assertFunctionConfigurationEqual, type LoopDeskFunctionConfiguration } from "./function-contract.ts";

export type ShopifyGraphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
export type DiscountSnapshot = { id: string; title?: string | null; status?: string | null; discountClasses?: string[] | null; appDiscountType?: { appKey?: string | null; functionId?: string | null } | null; metafield?: { namespace: string; key: string; type: string; value: string } | null };

function userErrors(errors: Array<{ message?: string; field?: string[] }> | undefined) { if (errors?.length) throw new Error(errors.map((e) => e.message || e.field?.join(".") || "Shopify user error").join("; ")); }

const discountSelection = `id title status discountClasses appDiscountType { appKey functionId } metafield(namespace: "${LOOPDESK_FUNCTION_METAFIELD_NAMESPACE}", key: "${LOOPDESK_FUNCTION_METAFIELD_KEY}") { namespace key type value }`;

export async function readAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null, id: string) {
  const data = await graphql<{ node: DiscountSnapshot | null }>(`query LoopDeskDiscount($id: ID!) { node(id: $id) { ... on DiscountAutomaticApp { ${discountSelection} } } }`, { id }, { shopDomain });
  return data.node;
}

export async function findCanonicalAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null) {
  const data = await graphql<{ discountNodes: { nodes: Array<{ id: string; discount: DiscountSnapshot | null }> } }>(`query LoopDeskDiscountSearch($query: String!) { discountNodes(first: 25, query: $query) { nodes { id discount { ... on DiscountAutomaticApp { ${discountSelection} } } } } }`, { query: `title:'${LOOPDESK_AUTOMATIC_DISCOUNT_TITLE}'` }, { shopDomain });
  const matches = data.discountNodes.nodes.map((node) => node.discount).filter((discount): discount is DiscountSnapshot => discount?.title === LOOPDESK_AUTOMATIC_DISCOUNT_TITLE);
  if (matches.length > 1) throw new Error("Multiple LoopDesk automatic discounts match the canonical title; ownership is ambiguous.");
  return matches[0] ?? null;
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

export function verifyDiscountOwnsCanonicalConfiguration(discount: DiscountSnapshot | null, configuration: LoopDeskFunctionConfiguration) {
  if (!discount?.id) throw new Error("Shopify read-back did not return the automatic discount owner.");
  if (discount.title !== LOOPDESK_AUTOMATIC_DISCOUNT_TITLE) throw new Error("Shopify automatic discount title is not the LoopDesk canonical title.");
  if (!discount.appDiscountType?.functionId) throw new Error("Shopify automatic discount is not linked to an app Function.");
  if (!discount.discountClasses?.includes("PRODUCT")) throw new Error("Shopify automatic discount is not configured for the PRODUCT discount class.");
  const metafield = discount.metafield;
  if (!metafield?.value) throw new Error("Shopify read-back did not include the Function configuration metafield.");
  if (metafield.namespace !== LOOPDESK_FUNCTION_METAFIELD_NAMESPACE || metafield.key !== LOOPDESK_FUNCTION_METAFIELD_KEY || metafield.type !== LOOPDESK_FUNCTION_METAFIELD_TYPE) throw new Error("Shopify Function configuration metafield identity did not match the LoopDesk contract.");
  assertFunctionConfigurationEqual(configuration, JSON.parse(metafield.value));
}
