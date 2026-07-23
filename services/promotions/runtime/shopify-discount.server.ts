import { LOOPDESK_AUTOMATIC_DISCOUNT_TITLE, LOOPDESK_FUNCTION_HANDLE, LOOPDESK_FUNCTION_METAFIELD_KEY, LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, LOOPDESK_FUNCTION_METAFIELD_TYPE, LOOPDESK_RECOGNIZED_AUTOMATIC_DISCOUNT_TITLES, assertFunctionConfigurationEqual, isLoopDeskFunctionMetafieldNamespace, isRecognizedAutomaticDiscountTitle, type LoopDeskFunctionConfiguration } from "./function-contract.ts";

export type ShopifyGraphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
export type DiscountCombinesWithSnapshot = { orderDiscounts?: boolean | null; productDiscounts?: boolean | null; shippingDiscounts?: boolean | null };
export type DiscountSnapshot = { id: string; title?: string | null; status?: string | null; discountClasses?: string[] | null; combinesWith?: DiscountCombinesWithSnapshot | null; appDiscountType?: { appKey?: string | null; functionId?: string | null } | null; metafield?: { namespace: string; key: string; type: string; value: string } | null };
export type DiscountNodeResponse = { id: string; metafield?: DiscountSnapshot["metafield"]; discount?: { discountId?: string | null; title?: string | null; status?: string | null; discountClasses?: string[] | null; combinesWith?: DiscountCombinesWithSnapshot | null; appDiscountType?: { appKey?: string | null; functionId?: string | null } | null } | null };
export type ShopifyFunctionSnapshot = { id: string; handle?: string | null; title?: string | null; apiType?: string | null; appKey?: string | null };

function userErrors(errors: Array<{ message?: string; field?: string[] }> | undefined) { if (errors?.length) throw new Error(errors.map((e) => e.message || e.field?.join(".") || "Shopify user error").join("; ")); }

const combinationInput = { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true };
const nodeDiscountSelection = `id metafield(namespace: "${LOOPDESK_FUNCTION_METAFIELD_NAMESPACE}", key: "${LOOPDESK_FUNCTION_METAFIELD_KEY}") { namespace key type value } discount { ... on DiscountAutomaticApp { discountId title status discountClasses combinesWith { orderDiscounts productDiscounts shippingDiscounts } appDiscountType { appKey functionId } } }`;
const appDiscountSelection = `discountId title status discountClasses combinesWith { orderDiscounts productDiscounts shippingDiscounts } appDiscountType { appKey functionId }`;

function flattenDiscountNode(node: DiscountNodeResponse | null | undefined): DiscountSnapshot | null {
  if (!node?.id || !node.discount) return null;
  return { id: node.id, metafield: node.metafield ?? null, title: node.discount.title, status: node.discount.status, discountClasses: node.discount.discountClasses, combinesWith: node.discount.combinesWith, appDiscountType: node.discount.appDiscountType };
}

export async function readAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null, id: string) {
  const data = await graphql<{ discountNode: DiscountNodeResponse | null }>(`query LoopDeskDiscount($id: ID!) { discountNode(id: $id) { ${nodeDiscountSelection} } }`, { id }, { shopDomain });
  return flattenDiscountNode(data.discountNode);
}

export async function findCanonicalAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null) {
  const titleQuery = LOOPDESK_RECOGNIZED_AUTOMATIC_DISCOUNT_TITLES.map((title) => `title:'${title}'`).join(" OR ");
  const data = await graphql<{ discountNodes: { nodes: DiscountNodeResponse[] } }>(`query LoopDeskDiscountSearch($query: String!) { discountNodes(first: 25, query: $query) { nodes { ${nodeDiscountSelection} } } }`, { query: titleQuery }, { shopDomain });
  const matches = data.discountNodes.nodes.map(flattenDiscountNode).filter((discount): discount is DiscountSnapshot => isRecognizedAutomaticDiscountTitle(discount?.title));
  if (matches.length > 1) throw new Error("Multiple LoopDesk automatic discounts match the canonical title; ownership is ambiguous.");
  return matches[0] ?? null;
}

export async function readShopifyFunctionByHandle(graphql: ShopifyGraphql, shopDomain: string | null) {
  const data = await graphql<{ shopifyFunctions?: { nodes?: ShopifyFunctionSnapshot[] | null } | null }>(`query LoopDeskShopifyFunctions { shopifyFunctions(first: 100) { nodes { id handle title apiType appKey } } }`, {}, { shopDomain });
  const matches = (data.shopifyFunctions?.nodes ?? []).filter((node): node is ShopifyFunctionSnapshot => Boolean(node?.id) && node.handle === LOOPDESK_FUNCTION_HANDLE);
  if (matches.length > 1) throw new Error(`Multiple Shopify Functions match the LoopDesk handle ${LOOPDESK_FUNCTION_HANDLE}; ownership is ambiguous.`);
  const match = matches[0] ?? null;
  if (!match) throw new Error(`Shopify Function handle ${LOOPDESK_FUNCTION_HANDLE} was not found.`);
  return match;
}

export async function createAutomaticDiscount(graphql: ShopifyGraphql, shopDomain: string | null, startsAt: string, options: { supportsOrderDiscounts?: boolean } = {}) {
  const discountClasses = options.supportsOrderDiscounts ? ["PRODUCT", "ORDER"] : ["PRODUCT"];
  const data = await graphql<{ discountAutomaticAppCreate: { automaticAppDiscount?: DiscountNodeResponse["discount"] | null; userErrors: Array<{ message?: string; field?: string[] }> } }>(`mutation LoopDeskCreateDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { ${appDiscountSelection} } userErrors { field message } } }`, { automaticAppDiscount: { title: LOOPDESK_AUTOMATIC_DISCOUNT_TITLE, functionHandle: LOOPDESK_FUNCTION_HANDLE, startsAt, discountClasses, combinesWith: combinationInput } }, { shopDomain });
  userErrors(data.discountAutomaticAppCreate.userErrors);
  const discount = data.discountAutomaticAppCreate.automaticAppDiscount;
  if (!discount) throw new Error("Shopify did not return a created automatic discount.");
  if (discount.title !== LOOPDESK_AUTOMATIC_DISCOUNT_TITLE) throw new Error("Shopify returned an automatic discount with an unexpected title.");
  if (!discount.discountId) throw new Error("Shopify did not return the created automatic discount node owner ID.");
  const snapshot = await readAutomaticDiscount(graphql, shopDomain, discount.discountId);
  if (!snapshot?.id) throw new Error("Shopify did not return the created automatic discount node owner ID.");
  return snapshot;
}

export async function ensureAutomaticDiscountClasses(graphql: ShopifyGraphql, shopDomain: string | null, id: string, existingClasses: readonly string[], supportsOrderDiscounts: boolean) {
  const required = new Set(existingClasses); required.add("PRODUCT"); if (supportsOrderDiscounts) required.add("ORDER");
  const discountClasses = [...required];
  const data = await graphql<{ discountAutomaticAppUpdate: { automaticAppDiscount?: DiscountNodeResponse["discount"] | null; userErrors: Array<{ message?: string; field?: string[] }> } }>(`mutation LoopDeskUpdateDiscountClasses($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { ${appDiscountSelection} } userErrors { field message } } }`, { id, automaticAppDiscount: { discountClasses } }, { shopDomain });
  userErrors(data.discountAutomaticAppUpdate.userErrors);
  const classes = data.discountAutomaticAppUpdate.automaticAppDiscount?.discountClasses ?? [];
  if (!classes.includes("PRODUCT") || (supportsOrderDiscounts && !classes.includes("ORDER"))) throw new Error(supportsOrderDiscounts ? "Shopify automatic discount is missing the ORDER discount class." : "Shopify automatic discount is missing the PRODUCT discount class.");
}

export async function writeFunctionConfigurationMetafield(graphql: ShopifyGraphql, shopDomain: string | null, ownerId: string, configuration: LoopDeskFunctionConfiguration) {
  const data = await graphql<{ metafieldsSet: { metafields?: Array<{ id: string }> | null; userErrors: Array<{ message?: string; field?: string[] }> } }>(`mutation LoopDeskSetFunctionConfig($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`, { metafields: [{ ownerId, namespace: LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, key: LOOPDESK_FUNCTION_METAFIELD_KEY, type: LOOPDESK_FUNCTION_METAFIELD_TYPE, value: JSON.stringify(configuration) }] }, { shopDomain });
  userErrors(data.metafieldsSet.userErrors);
}

export function verifyDiscountOwnsCanonicalConfiguration(discount: DiscountSnapshot | null, configuration: LoopDeskFunctionConfiguration, expectedFunctionId?: string | null, expectedCombinations?: DiscountCombinesWithSnapshot | null) {
  if (!discount?.id) throw new Error("Shopify read-back did not return the automatic discount owner.");
  if (!isRecognizedAutomaticDiscountTitle(discount.title)) throw new Error("Shopify automatic discount title is not the LoopDesk canonical title.");
  if (discount.status !== "ACTIVE") throw new Error("Shopify automatic discount is not ACTIVE.");
  if (!discount.appDiscountType?.functionId) throw new Error("Shopify automatic discount is not linked to an app Function.");
  if (expectedFunctionId && discount.appDiscountType.functionId !== expectedFunctionId) throw new Error("Shopify automatic discount is not linked to the current LoopDesk Function.");
  if (!discount.discountClasses?.includes("PRODUCT")) throw new Error("Shopify automatic discount is not configured for the PRODUCT discount class.");
  if (configuration.functionContractVersion === 2 && !discount.discountClasses?.includes("ORDER")) throw new Error("Shopify automatic discount is not configured for the ORDER discount class.");
  if (expectedCombinations && JSON.stringify(discount.combinesWith ?? null) !== JSON.stringify(expectedCombinations)) throw new Error("Shopify automatic discount combination state changed during synchronization.");
  const metafield = discount.metafield;
  if (!metafield?.value) throw new Error("Shopify read-back did not include the Function configuration metafield.");
  if (!isLoopDeskFunctionMetafieldNamespace(metafield.namespace)) throw new Error(`Shopify Function configuration metafield identity did not match the LoopDesk contract: unexpected metafield namespace ${JSON.stringify(metafield.namespace)}.`);
  if (metafield.key !== LOOPDESK_FUNCTION_METAFIELD_KEY) throw new Error(`Shopify Function configuration metafield identity did not match the LoopDesk contract: unexpected metafield key ${JSON.stringify(metafield.key)}.`);
  if (metafield.type !== LOOPDESK_FUNCTION_METAFIELD_TYPE) throw new Error(`Shopify Function configuration metafield identity did not match the LoopDesk contract: unexpected metafield type ${JSON.stringify(metafield.type)}.`);
  assertFunctionConfigurationEqual(configuration, JSON.parse(metafield.value));
}
