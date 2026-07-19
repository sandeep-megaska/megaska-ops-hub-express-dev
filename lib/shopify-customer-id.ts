const CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/(\d+)$/;
const NUMERIC_ID = /^\d+$/;

export class InvalidShopifyCustomerIdError extends Error {
  readonly value: unknown;
  constructor(value: unknown) {
    super("Invalid Shopify customer ID");
    this.value = value;
    this.name = "InvalidShopifyCustomerIdError";
  }
}

/** Canonical storage form for a Shopify Customer ID is its decimal payload. */
export function normalizeShopifyCustomerId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new InvalidShopifyCustomerIdError(value);
  }
  const raw = String(value).trim();
  const numeric = NUMERIC_ID.test(raw) ? raw : CUSTOMER_GID.exec(raw)?.[1];
  if (!numeric) throw new InvalidShopifyCustomerIdError(value);
  // Shopify IDs are positive integers. Removing leading zeroes gives one identity.
  const canonical = numeric.replace(/^0+(?=\d)/, "");
  if (canonical === "0") throw new InvalidShopifyCustomerIdError(value);
  return canonical;
}

export function shopifyCustomerIdStorageForms(value: unknown): [string, string] {
  const id = normalizeShopifyCustomerId(value);
  return [id, `gid://shopify/Customer/${id}`];
}
