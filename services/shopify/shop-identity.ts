export type ShopIdentityRow = {
  id: string;
  shopDomain: string | null;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  storefrontAccessToken?: string | null;
  storefrontTokenEncrypted?: string | null;
  scopes?: string | null;
  isActive: boolean;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  installationStatus: string | null;
  installedAt: Date | null;
  uninstalledAt: Date | null;
};

export type ShopResolutionDebugContext = {
  requestedShopDomain: string;
  candidateCount: number;
  selectedShopId?: string | null;
  candidates: Array<{
    id: string;
    shopDomain: string | null;
    myshopifyDomain: string | null;
    primaryDomain: string | null;
    isActive: boolean;
    hasInstallationCredentials: boolean;
    installationStatus: string | null;
    hasUninstalledAt: boolean;
  }>;
};

export class ShopIdentityResolutionError extends Error {
  code: string;
  status: number;
  debugContext?: ShopResolutionDebugContext;

  constructor(code: string, message: string, status = 404, debugContext?: ShopResolutionDebugContext) {
    super(message);
    this.name = "ShopIdentityResolutionError";
    this.code = code;
    this.status = status;
    this.debugContext = debugContext;
  }
}

export class AmbiguousShopInstallationError extends ShopIdentityResolutionError {
  constructor(debugContext: ShopResolutionDebugContext) {
    super("ambiguous_shop_installation", "Multiple active Shopify installations match this shop identity.", 409, debugContext);
    this.name = "AmbiguousShopInstallationError";
  }
}

export class ShopInstallationCredentialsMissingError extends ShopIdentityResolutionError {
  constructor(debugContext: ShopResolutionDebugContext) {
    super("shop_installation_credentials_missing", "Matching shop rows do not contain Shopify installation credentials.", 403, debugContext);
    this.name = "ShopInstallationCredentialsMissingError";
  }
}

export class ShopIdentityNotFoundError extends ShopIdentityResolutionError {
  constructor(debugContext: ShopResolutionDebugContext) {
    super("shop_identity_not_found", "Shop not found.", 404, debugContext);
    this.name = "ShopIdentityNotFoundError";
  }
}

export function normalizeShopDomain(input: string | null | undefined) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function isMyshopifyDomain(input: string | null | undefined) {
  return normalizeShopDomain(input).endsWith(".myshopify.com");
}

function hasInstallationCredentials(row: ShopIdentityRow) {
  return Boolean(row.accessToken || row.accessTokenEncrypted);
}

function isActiveInstalled(row: ShopIdentityRow) {
  return Boolean(row.isActive && !row.uninstalledAt);
}

function domainRank(row: ShopIdentityRow, requestedDomain: string) {
  if (normalizeShopDomain(row.myshopifyDomain) === requestedDomain) return 0;
  if (normalizeShopDomain(row.shopDomain) === requestedDomain && isMyshopifyDomain(row.shopDomain)) return 1;
  if (normalizeShopDomain(row.shopDomain) === requestedDomain) return 2;
  if (normalizeShopDomain(row.primaryDomain) === requestedDomain) return 3;
  return 4;
}

export function buildShopResolutionDebugContext(
  requestedShopDomain: string,
  candidates: ShopIdentityRow[],
  selectedShopId: string | null = null,
): ShopResolutionDebugContext {
  return {
    requestedShopDomain,
    candidateCount: candidates.length,
    selectedShopId,
    candidates: candidates.map((row) => ({
      id: row.id,
      shopDomain: row.shopDomain,
      myshopifyDomain: row.myshopifyDomain,
      primaryDomain: row.primaryDomain,
      isActive: row.isActive,
      hasInstallationCredentials: hasInstallationCredentials(row),
      installationStatus: row.installationStatus,
      hasUninstalledAt: Boolean(row.uninstalledAt),
    })),
  };
}

export function selectCanonicalShopCandidate<T extends ShopIdentityRow>(
  requestedDomain: string,
  candidates: T[],
): T {
  const normalized = normalizeShopDomain(requestedDomain);
  const activeInstalled = candidates.filter(isActiveInstalled);
  const credentialed = activeInstalled.filter(hasInstallationCredentials);
  const debug = buildShopResolutionDebugContext(normalized, candidates);

  if (credentialed.length === 0) {
    if (candidates.length > 0) throw new ShopInstallationCredentialsMissingError(debug);
    throw new ShopIdentityNotFoundError(debug);
  }

  const myshopifyIdentities = new Set(
    credentialed.map((row) => normalizeShopDomain(row.myshopifyDomain || (isMyshopifyDomain(row.shopDomain) ? row.shopDomain : ""))).filter(Boolean),
  );
  if (myshopifyIdentities.size > 1 || (credentialed.length > 1 && myshopifyIdentities.size === 0)) {
    throw new AmbiguousShopInstallationError(debug);
  }

  return [...credentialed].sort((a, b) => domainRank(a, normalized) - domainRank(b, normalized))[0];
}
