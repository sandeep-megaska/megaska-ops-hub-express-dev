import { getInternalDelhiveryConfig } from "../delhivery/config";

// Per-shop Delhivery runtime configuration.
//
// Delhivery is a MERCHANT-owned integration (each merchant ships from their own
// warehouse on their own Delhivery contract), so credentials must be resolved
// per shop from merchant settings — not from a single global env var. This
// resolver reads the per-shop config the merchant enters in the app
// (getInternalDelhiveryConfig) and falls back to DELHIVERY_* env vars only when a
// shop has no token configured, so a single-tenant/legacy deployment keeps
// working during the transition.
//
// (Razorpay already follows this per-shop pattern via getInternalRazorpayConfig.)

export interface DelhiveryRuntimeConfig {
  configured: boolean;
  reason: string;
  apiToken: string;
  baseUrl: string;
  pickupLocationName: string;
  originPincode: string;
  reversePickupPath: string;
  forwardShipmentPath: string;
  trackingPath: string;
  trackingUrlTemplate: string | null;
}

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function delhiveryPaths() {
  return {
    reversePickupPath: env("DELHIVERY_REVERSE_PICKUP_PATH") || "/api/cmu/create.json",
    forwardShipmentPath: env("DELHIVERY_FORWARD_SHIPMENT_PATH") || "/api/cmu/create.json",
    trackingPath: env("DELHIVERY_TRACKING_PATH") || "/api/v1/packages/json/",
    trackingUrlTemplate: env("DELHIVERY_TRACKING_URL_TEMPLATE") || null,
  };
}

function productionBaseUrl() {
  return (env("DELHIVERY_BASE_URL_PRODUCTION") || "https://track.delhivery.com").replace(/\/+$/, "");
}
function testBaseUrl() {
  return (env("DELHIVERY_BASE_URL_TEST") || "https://staging-express.delhivery.com").replace(/\/+$/, "");
}

function buildReason(hasCredentials: boolean, enabled: boolean) {
  if (hasCredentials && enabled) return "ready";
  if (!hasCredentials) {
    return "Delhivery credentials are not configured. Add your Delhivery API token in the app's Delhivery settings.";
  }
  return "Delhivery is turned off. Enable it in the app's Delhivery settings.";
}

/**
 * Env-only runtime (single-tenant / legacy fallback). No DB access — safe to call
 * synchronously from anywhere that has no shop context.
 */
export function buildEnvDelhiveryRuntimeConfig(): DelhiveryRuntimeConfig {
  const apiToken = env("DELHIVERY_API_TOKEN");
  const baseUrl = env("DELHIVERY_BASE_URL").replace(/\/+$/, "");
  const hasCredentials = Boolean(apiToken && baseUrl);
  return {
    configured: hasCredentials,
    reason: buildReason(hasCredentials, true),
    apiToken,
    baseUrl,
    pickupLocationName: env("DELHIVERY_PICKUP_LOCATION_NAME") || "Megaska Returns",
    originPincode: env("DELHIVERY_ORIGIN_PINCODE"),
    ...delhiveryPaths(),
  };
}

/**
 * Resolve Delhivery config for a specific shop: the merchant's own token +
 * warehouse when configured in the app, else the env fallback. `apiToken` is
 * sensitive — never expose the returned object to a client component; pass only
 * `{ configured, reason }` to the UI.
 */
export async function resolveDelhiveryRuntimeConfig(
  shopId: string | null | undefined,
): Promise<DelhiveryRuntimeConfig> {
  let merchant: Awaited<ReturnType<typeof getInternalDelhiveryConfig>> | null = null;
  if (shopId) {
    try {
      merchant = await getInternalDelhiveryConfig(shopId);
    } catch {
      merchant = null;
    }
  }

  // No per-shop token → fall back to env (single-tenant / legacy).
  if (!merchant?.hasApiToken) {
    return buildEnvDelhiveryRuntimeConfig();
  }

  const apiToken = merchant.apiToken;
  const baseUrl = merchant.environment === "production" ? productionBaseUrl() : testBaseUrl();
  const enabled = merchant.enabled;
  const hasCredentials = Boolean(apiToken && baseUrl);

  return {
    configured: hasCredentials && enabled,
    reason: buildReason(hasCredentials, enabled),
    apiToken,
    baseUrl,
    pickupLocationName: merchant.pickupLocation || env("DELHIVERY_PICKUP_LOCATION_NAME") || "Megaska Returns",
    originPincode: merchant.originPincode || env("DELHIVERY_ORIGIN_PINCODE"),
    ...delhiveryPaths(),
  };
}
