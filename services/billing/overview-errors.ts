import { COMMERCIAL_CATALOG_NOT_CONFIGURED, COMMERCIAL_CATALOG_SAFE_MESSAGE, CommercialCatalogConfigurationError } from "./commercial-catalog-health.ts";

export function billingOverviewErrorResponse(error: unknown) {
  if (error instanceof CommercialCatalogConfigurationError) return { status: 503, body: { ok: false as const, error: COMMERCIAL_CATALOG_NOT_CONFIGURED, message: COMMERCIAL_CATALOG_SAFE_MESSAGE } };
  return { status: 500, body: { ok: false as const, error: "BILLING_OVERVIEW_UNAVAILABLE", message: "Unable to load billing overview" } };
}
