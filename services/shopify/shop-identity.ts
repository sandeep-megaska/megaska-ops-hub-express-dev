export type ShopIdentityRow = {
  id: string;
  shopDomain: string;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  isActive: boolean;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  uninstalledAt: Date | null;
};

export class AmbiguousShopInstallationError extends Error {
  constructor() {
    super("ambiguous_shop_installation");
    this.name = "AmbiguousShopInstallationError";
  }
}

export function normalizeShopDomain(input: string | null | undefined) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function isMyshopifyDomain(shopDomain: string | null | undefined) {
  return normalizeShopDomain(shopDomain).endsWith(".myshopify.com");
}

function hasAdminAccessToken(row: ShopIdentityRow) {
  return Boolean(row.accessToken || row.accessTokenEncrypted);
}

function canonicalDomain(row: ShopIdentityRow) {
  return normalizeShopDomain(row.myshopifyDomain || row.shopDomain);
}

export function selectCanonicalShopCandidate<Row extends ShopIdentityRow>(rows: Row[], requestedShopDomain: string): Row | null {
  const requested = normalizeShopDomain(requestedShopDomain);
  if (!requested) return null;
  const activeInstalled = rows.filter((row) => row.isActive && !row.uninstalledAt && hasAdminAccessToken(row));
  const candidates = activeInstalled.length ? activeInstalled : rows.filter((row) => row.isActive && !row.uninstalledAt);

  const exactMyshopify = candidates.filter((row) => normalizeShopDomain(row.myshopifyDomain) === requested);
  if (exactMyshopify.length === 1) return exactMyshopify[0];
  if (exactMyshopify.length > 1) throw new AmbiguousShopInstallationError();

  const exactShopMyshopify = candidates.filter((row) => isMyshopifyDomain(row.shopDomain) && normalizeShopDomain(row.shopDomain) === requested);
  if (exactShopMyshopify.length === 1) return exactShopMyshopify[0];
  if (exactShopMyshopify.length > 1) throw new AmbiguousShopInstallationError();

  const primaryMapped = candidates.filter((row) => normalizeShopDomain(row.primaryDomain) === requested && canonicalDomain(row));
  const uniqueCanonicalDomains = new Set(primaryMapped.map(canonicalDomain));
  if (primaryMapped.length === 1 || (uniqueCanonicalDomains.size === 1 && primaryMapped.length > 0)) {
    const installed = primaryMapped.filter(hasAdminAccessToken);
    if (installed.length === 1) return installed[0];
    if (installed.length === 0 && primaryMapped.length === 1) return primaryMapped[0];
  }
  if (primaryMapped.length > 1) throw new AmbiguousShopInstallationError();

  return null;
}
