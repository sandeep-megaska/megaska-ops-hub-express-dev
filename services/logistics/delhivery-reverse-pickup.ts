import { toDelhiveryPhone, toDelhiveryPincode, type DelhiveryRuntimeConfig } from "./delhivery-runtime";
import type { ResolvedShippingAddress } from "../exchange/pickup-address";
import { ensureDelhiveryWarehouse, DelhiveryWarehouseError } from "./delhivery-warehouse";
import { fetchDelhiveryWaybill, DelhiveryWaybillError } from "./delhivery-waybill";

type ExchangeRequestForReversePickup = {
  id: string;
  orderNumber: string | null;
  items: Array<{
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
  }>;
};

export type DelhiveryReversePickupResult = {
  providerReference: string | null;
  awb: string | null;
  trackingUrl: string | null;
  status: "PENDING" | "SCHEDULED";
  rawResponse: unknown;
};

export class DelhiveryReversePickupError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DelhiveryReversePickupError";
    this.statusCode = statusCode;
  }
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function required(value: unknown, label: string) {
  const cleaned = clean(value);
  if (!cleaned) throw new DelhiveryReversePickupError(`${label} is required to create Delhivery reverse pickup.`);
  return cleaned;
}

function joinAddress(...parts: unknown[]) {
  return parts.map(clean).filter(Boolean).join(", ");
}

function resolveEndpoint(runtime: DelhiveryRuntimeConfig) {
  const baseUrl = runtime.baseUrl.replace(/\/+$/, "");
  const path = runtime.reversePickupPath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildTrackingUrl(awb: string | null, template: string | null) {
  if (!awb) return null;
  if (template) return template.replace("{awb}", encodeURIComponent(awb));
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

export function buildDelhiveryReversePickupPayload(
  request: ExchangeRequestForReversePickup,
  pickupLocationName: string,
  shippingAddress: ResolvedShippingAddress,
  waybill: string,
) {
  const pickup = required(pickupLocationName, "Delhivery pickup location / warehouse name (set it in Settings → Delhivery)");
  const name = required(shippingAddress.name, "Customer name");
  const phone = toDelhiveryPhone(required(shippingAddress.phone, "Customer phone"));
  const address = required(joinAddress(shippingAddress.address1, shippingAddress.address2), "Customer address");
  const city = required(shippingAddress.city, "Customer city");
  const state = required(shippingAddress.state, "Customer state");
  const pin = toDelhiveryPincode(required(shippingAddress.pin, "Customer postal code"));
  const order = required(request.orderNumber || request.id, "Order number");
  const productDescription = request.items
    .map((item) => [item.productTitle, item.variantTitle, item.sku].map(clean).filter(Boolean).join(" / "))
    .filter(Boolean)
    .join("; ") || "Exchange reverse pickup";
  const totalQuantity = request.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 1;

  return {
    pickup_location: {
      name: pickup,
    },
    shipments: [
      {
        // Reverse pickups don't auto-assign a waybill — Delhivery requires one
        // from the merchant's master series (fetched before this call).
        waybill: required(waybill, "Delhivery waybill"),
        order: `EX-${order}-${request.id.slice(0, 8)}`,
        name,
        phone,
        email: clean(shippingAddress.email) || undefined,
        add: address,
        city,
        state,
        pin,
        country: clean(shippingAddress.country) || "India",
        products_desc: productDescription,
        quantity: totalQuantity,
        payment_mode: "Pickup",
        return_name: name,
        return_phone: phone,
        return_add: address,
        return_city: city,
        return_state: state,
        return_pin: pin,
        shipment_type: "reverse",
      },
    ],
  };
}

function pickFirstString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const cleaned = clean(value);
      if (cleaned) return cleaned;
    }
    if (Array.isArray(value)) {
      const joined = value.map((entry) => clean(entry)).filter(Boolean).join("; ");
      if (joined) return joined;
    }
  }
  return null;
}

export function normalizeDelhiveryReversePickupResponse(
  rawResponse: unknown,
  trackingUrlTemplate: string | null,
): DelhiveryReversePickupResult {
  const root = rawResponse && typeof rawResponse === "object" ? (rawResponse as Record<string, unknown>) : {};
  const packages = Array.isArray(root.packages) ? root.packages : Array.isArray(root.Package) ? root.Package : [];
  const firstPackage = packages[0];
  const awb = pickFirstString(firstPackage, ["waybill", "awb", "AWB", "tracking_number"]) || pickFirstString(root, ["waybill", "awb", "AWB"]);
  const providerReference = pickFirstString(firstPackage, ["refnum", "reference", "order", "client"])
    || pickFirstString(root, ["refnum", "reference", "order", "client"]);
  // Delhivery echoes the waybill we sent even on a failed package, so a non-empty
  // awb alone no longer proves success — check the explicit flags + package status.
  const packageStatus = pickFirstString(firstPackage, ["status"]) || "";
  const packageFailed = /fail/i.test(packageStatus);
  const explicitFailure = root.success === false || root.success === "false" || packageFailed;
  const explicitSuccess = root.success === true || root.success === "true";
  const success = !explicitFailure && (explicitSuccess || Boolean(awb));

  if (!success) {
    // Prefer the package-level remarks (actionable, e.g. "Waybill does not match
    // master waybill pattern") over the generic top-level rmk.
    const message = pickFirstString(firstPackage, ["remarks", "error", "message", "rmk"])
      || pickFirstString(root, ["error", "message", "rmk"])
      || "Delhivery reverse pickup creation failed.";
    throw new DelhiveryReversePickupError(message, 502);
  }

  return {
    providerReference,
    awb,
    trackingUrl: buildTrackingUrl(awb, trackingUrlTemplate),
    status: awb ? "SCHEDULED" : "PENDING",
    rawResponse,
  };
}

export async function createDelhiveryReversePickup(
  request: ExchangeRequestForReversePickup,
  runtime: DelhiveryRuntimeConfig,
  shippingAddress: ResolvedShippingAddress,
): Promise<DelhiveryReversePickupResult> {
  if (!runtime.configured) {
    throw new DelhiveryReversePickupError(runtime.reason, 503);
  }

  // Reverse pickups require a pre-fetched waybill from Delhivery's master series;
  // a blank one fails with "Waybill does not match master waybill pattern".
  let waybill: string;
  try {
    waybill = await fetchDelhiveryWaybill(runtime);
  } catch (error) {
    if (error instanceof DelhiveryWaybillError) {
      throw new DelhiveryReversePickupError(error.message, error.statusCode);
    }
    throw new DelhiveryReversePickupError(
      error instanceof Error ? error.message : "Delhivery waybill fetch failed.",
      502,
    );
  }

  const payload = buildDelhiveryReversePickupPayload(request, runtime.pickupLocationName, shippingAddress, waybill);

  try {
    return await postReversePickup(runtime, payload);
  } catch (error) {
    // The warehouse isn't registered with Delhivery yet — auto-register it from
    // the merchant's settings and retry once, so merchants never touch the portal.
    if (isWarehouseNotFound(error)) {
      await ensureWarehouseOrThrow(runtime);
      try {
        return await postReversePickup(runtime, payload);
      } catch (retryError) {
        throw remapWarehouseError(retryError, runtime.pickupLocationName);
      }
    }
    throw remapWarehouseError(error, runtime.pickupLocationName);
  }
}

async function postReversePickup(
  runtime: DelhiveryRuntimeConfig,
  payload: ReturnType<typeof buildDelhiveryReversePickupPayload>,
): Promise<DelhiveryReversePickupResult> {
  const response = await fetch(resolveEndpoint(runtime), {
    method: "POST",
    headers: {
      Authorization: `Token ${runtime.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ format: "json", data: JSON.stringify(payload) }),
  });

  const rawText = await response.text();
  // Diagnostics: the exact outgoing payload + raw Delhivery response (order data
  // only, no API secrets). Lets us see precisely what we sent and what Delhivery
  // rejected in the Vercel logs when Delhivery returns its generic internal error.
  console.info("[DELHIVERY REVERSE PICKUP] response", {
    status: response.status,
    ok: response.ok,
    sentPayload: JSON.stringify(payload).slice(0, 1200),
    body: rawText.slice(0, 800),
  });
  let rawResponse: unknown = rawText;
  try {
    rawResponse = rawText ? JSON.parse(rawText) : null;
  } catch {
    rawResponse = { raw: rawText };
  }

  if (!response.ok) {
    throw new DelhiveryReversePickupError(`Delhivery API returned HTTP ${response.status}.`, 502);
  }

  return normalizeDelhiveryReversePickupResponse(rawResponse, runtime.trackingUrlTemplate);
}

function isWarehouseNotFound(error: unknown) {
  return (
    error instanceof DelhiveryReversePickupError &&
    /clientwarehouse|warehouse|matching query does not exist/i.test(error.message)
  );
}

async function ensureWarehouseOrThrow(runtime: DelhiveryRuntimeConfig) {
  try {
    await ensureDelhiveryWarehouse(runtime);
  } catch (error) {
    const statusCode = error instanceof DelhiveryWarehouseError ? error.statusCode : 502;
    throw new DelhiveryReversePickupError(
      error instanceof Error ? error.message : "Delhivery warehouse registration failed.",
      statusCode,
    );
  }
}

// Turn Delhivery's cryptic "ClientWarehouse matching query does not exist" into
// an actionable message: the pickup-location name we sent isn't a warehouse
// registered in the merchant's Delhivery account.
function remapWarehouseError(error: unknown, pickupLocationName: string): DelhiveryReversePickupError {
  if (error instanceof DelhiveryReversePickupError && /clientwarehouse|warehouse|matching query does not exist/i.test(error.message)) {
    return new DelhiveryReversePickupError(
      `Delhivery has no pickup warehouse named "${pickupLocationName || "(not set)"}". Register this warehouse in your Delhivery account, then set its exact name in Settings → Delhivery → "Pickup Location / Warehouse Name". (Delhivery said: ${error.message})`,
      422,
    );
  }
  return error instanceof DelhiveryReversePickupError
    ? error
    : new DelhiveryReversePickupError(error instanceof Error ? error.message : "Delhivery reverse pickup creation failed.", 502);
}
