const STOREFRONT_API_PREFIXES = [
  "otp/request",
  "otp/verify",
  "auth/session",
  "delhivery/pincode",
  "express/checkout/",
  "profile/",
  "runtime/config",
  "reviews/submission/",
];

const STOREFRONT_REVIEW_API_PATHS = new Set([
  "reviews/customer",
  "reviews/storefront/product",
  "reviews/submissions/eligible-purchases",
  "reviews/submissions/eligibility",
  "reviews/submissions",
]);

export function isStorefrontApiPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return STOREFRONT_REVIEW_API_PATHS.has(normalized)
    || STOREFRONT_API_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

export function isPublicApiPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return normalized === "runtime/config"
    || STOREFRONT_REVIEW_API_PATHS.has(normalized)
    || normalized.startsWith("reviews/submission/");
}

export function buildInternalApiUrl(requestUrl: string, proxyPath: string, shopDomain: string) {
  const targetUrl = new URL(requestUrl);
  targetUrl.pathname = `/api/${proxyPath}`;
  targetUrl.searchParams.set("shop", shopDomain);
  targetUrl.searchParams.delete("signature");
  targetUrl.searchParams.delete("hmac");
  return targetUrl;
}
