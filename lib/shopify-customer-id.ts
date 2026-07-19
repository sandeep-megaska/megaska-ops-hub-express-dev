const SHOPIFY_CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/(\d+)$/;
const NUMERIC_CUSTOMER_ID = /^\d+$/;

export type ShopifyCustomerIdDiagnostic =
  | "VALID_NUMERIC"
  | "VALID_CUSTOMER_GID"
  | "EMPTY"
  | "WRONG_RESOURCE_TYPE"
  | "MALFORMED_GID"
  | "NON_NUMERIC";

export type ShopifyCustomerIdDiagnosis = {
  category: ShopifyCustomerIdDiagnostic;
  canonicalId: string | null;
};

/** Classifies an external identifier without extracting digits from malformed input. */
export function diagnoseShopifyCustomerId(value: string | bigint | number | null | undefined): ShopifyCustomerIdDiagnosis {
  if (value === null || value === undefined) return { category: "EMPTY", canonicalId: null };
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    return { category: "NON_NUMERIC", canonicalId: null };
  }
  const candidate = String(value).trim();
  if (!candidate) return { category: "EMPTY", canonicalId: null };
  if (NUMERIC_CUSTOMER_ID.test(candidate)) return { category: "VALID_NUMERIC", canonicalId: candidate };
  const customerGid = SHOPIFY_CUSTOMER_GID.exec(candidate);
  if (customerGid) return { category: "VALID_CUSTOMER_GID", canonicalId: customerGid[1] };
  if (/^gid:\/\/shopify\/[^/]+\//.test(candidate)) {
    return { category: candidate.startsWith("gid://shopify/Customer/") ? "MALFORMED_GID" : "WRONG_RESOURCE_TYPE", canonicalId: null };
  }
  return { category: candidate.startsWith("gid:") ? "MALFORMED_GID" : "NON_NUMERIC", canonicalId: null };
}

/** Returns Shopify's canonical numeric customer id, or null for invalid input. */
export function normalizeShopifyCustomerId(value: string | bigint | number | null | undefined): string | null {
  return diagnoseShopifyCustomerId(value).canonicalId;
}

export function requireShopifyCustomerId(value: string | bigint | number | null | undefined): string {
  const normalized = normalizeShopifyCustomerId(value);
  if (!normalized) throw new Error("Malformed Shopify customer ID");
  return normalized;
}
