// Query fields the review eligibility API accepts. Requests from the storefront
// arrive through the Shopify app proxy (/apps/loopd2c/api/...), which adds its own
// fields (see app/apps/loopd2c/api/[...path]/routing.ts); rejecting those made every
// review link and the product-page / account-page review forms fail with INVALID_INPUT.
const reviewQueryFields = new Set(["productId", "variantId", "orderId", "orderLineId", "accessToken", "entryPoint"]);
const appProxyQueryFields = new Set(["shop", "logged_in_customer_id", "path_prefix", "timestamp"]);

export function hasUnexpectedReviewQueryField(params: URLSearchParams) {
  for (const field of params.keys()) if (!reviewQueryFields.has(field) && !appProxyQueryFields.has(field)) return true;
  return false;
}
