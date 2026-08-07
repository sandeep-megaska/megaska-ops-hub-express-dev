import type { DelhiveryRuntimeConfig } from "./delhivery-runtime";

type ExchangeRequestForForwardShipment = {
  id: string;
  orderNumber: string | null;
  customerNameSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerEmailSnapshot: string | null;
  customerProfile?: {
    fullName: string | null;
    phoneE164: string | null;
    email: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    stateProvince: string | null;
    postalCode: string | null;
    countryRegion: string | null;
  } | null;
  items: Array<{
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
    requestedSize: string | null;
    quantity: number;
  }>;
};

export type DelhiveryForwardShipmentResult = {
  providerReference: string | null;
  awb: string | null;
  trackingUrl: string | null;
  status: "PENDING" | "IN_TRANSIT";
  rawResponse: unknown;
};

export class DelhiveryForwardShipmentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DelhiveryForwardShipmentError";
    this.statusCode = statusCode;
  }
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function required(value: unknown, label: string) {
  const cleaned = clean(value);
  if (!cleaned) throw new DelhiveryForwardShipmentError(`${label} is required to create Delhivery replacement shipment.`);
  return cleaned;
}

function joinAddress(...parts: unknown[]) {
  return parts.map(clean).filter(Boolean).join(", ");
}

function getEnv(name: string) {
  return clean(process.env[name]);
}

function resolveEndpoint(runtime: DelhiveryRuntimeConfig) {
  const baseUrl = runtime.baseUrl.replace(/\/+$/, "");
  const path = runtime.forwardShipmentPath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildTrackingUrl(awb: string | null, template: string | null) {
  if (!awb) return null;
  if (template) return template.replace("{awb}", encodeURIComponent(awb));
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

// The pickup-location name (per shop) resolves the merchant's registered
// warehouse address inside Delhivery. The seller_* fields below are optional
// supplementary metadata and stay env-configurable (platform-level warehouse
// contact); they are omitted when unset.
function warehouseValue(names: string[], fallback = "") {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return value;
  }
  return fallback;
}

export function buildDelhiveryForwardShipmentPayload(
  request: ExchangeRequestForForwardShipment,
  pickupLocationName: string,
) {
  const customer = request.customerProfile;
  const name = required(request.customerNameSnapshot || customer?.fullName, "Customer name");
  const phone = required(request.customerPhoneSnapshot || customer?.phoneE164, "Customer phone");
  const address = required(joinAddress(customer?.addressLine1, customer?.addressLine2), "Customer address");
  const city = required(customer?.city, "Customer city");
  const state = required(customer?.stateProvince, "Customer state");
  const pin = required(customer?.postalCode, "Customer postal code");
  const order = required(request.orderNumber || request.id, "Order number");
  const resolvedPickupName = pickupLocationName || warehouseValue(["DELHIVERY_PICKUP_LOCATION_NAME", "DELHIVERY_WAREHOUSE_NAME"], "Megaska Warehouse");
  const warehouseName = warehouseValue(["DELHIVERY_WAREHOUSE_CONTACT_NAME", "DELHIVERY_WAREHOUSE_NAME", "DELHIVERY_PICKUP_LOCATION_NAME"], resolvedPickupName);
  const warehousePhone = warehouseValue(["DELHIVERY_WAREHOUSE_PHONE", "DELHIVERY_PICKUP_PHONE"]);
  const warehouseAddress = warehouseValue(["DELHIVERY_WAREHOUSE_ADDRESS", "DELHIVERY_PICKUP_ADDRESS"]);
  const warehouseCity = warehouseValue(["DELHIVERY_WAREHOUSE_CITY", "DELHIVERY_PICKUP_CITY"]);
  const warehouseState = warehouseValue(["DELHIVERY_WAREHOUSE_STATE", "DELHIVERY_PICKUP_STATE"]);
  const warehousePin = warehouseValue(["DELHIVERY_WAREHOUSE_PIN", "DELHIVERY_ORIGIN_PIN", "DELHIVERY_PICKUP_PIN"]);
  const productDescription = request.items
    .map((item) => [item.productTitle, item.variantTitle, item.requestedSize ? `Size ${item.requestedSize}` : null, item.sku].map(clean).filter(Boolean).join(" / "))
    .filter(Boolean)
    .join("; ") || "Exchange replacement item";
  const totalQuantity = request.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 1;

  return {
    pickup_location: {
      name: resolvedPickupName,
    },
    shipments: [
      {
        order: `EX-FWD-${order}-${request.id.slice(0, 8)}`,
        name,
        phone,
        email: clean(request.customerEmailSnapshot || customer?.email) || undefined,
        add: address,
        city,
        state,
        pin,
        country: clean(customer?.countryRegion) || "India",
        products_desc: productDescription,
        quantity: totalQuantity,
        payment_mode: "Prepaid",
        cod_amount: 0,
        seller_name: warehouseName || undefined,
        seller_phone: warehousePhone || undefined,
        seller_add: warehouseAddress || undefined,
        seller_city: warehouseCity || undefined,
        seller_state: warehouseState || undefined,
        seller_pin: warehousePin || undefined,
        return_name: warehouseName || resolvedPickupName,
        return_phone: warehousePhone || undefined,
        return_add: warehouseAddress || undefined,
        return_city: warehouseCity || undefined,
        return_state: warehouseState || undefined,
        return_pin: warehousePin || undefined,
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
  }
  return null;
}

export function normalizeDelhiveryForwardShipmentResponse(
  rawResponse: unknown,
  trackingUrlTemplate: string | null,
): DelhiveryForwardShipmentResult {
  const root = rawResponse && typeof rawResponse === "object" ? (rawResponse as Record<string, unknown>) : {};
  const packages = Array.isArray(root.packages) ? root.packages : Array.isArray(root.Package) ? root.Package : [];
  const firstPackage = packages[0];
  const awb = pickFirstString(firstPackage, ["waybill", "awb", "AWB", "tracking_number"])
    || pickFirstString(root, ["waybill", "awb", "AWB", "tracking_number"]);
  const providerReference = pickFirstString(firstPackage, ["refnum", "reference", "order", "client", "sort_code"])
    || pickFirstString(root, ["refnum", "reference", "order", "client"]);
  const success = root.success === true || root.success === "true" || Boolean(awb);

  if (!success) {
    const message = pickFirstString(root, ["error", "message", "rmk"])
      || pickFirstString(firstPackage, ["error", "message", "remarks", "rmk"])
      || "Delhivery replacement shipment creation failed.";
    throw new DelhiveryForwardShipmentError(message, 502);
  }

  return {
    providerReference,
    awb,
    trackingUrl: buildTrackingUrl(awb, trackingUrlTemplate),
    status: awb ? "IN_TRANSIT" : "PENDING",
    rawResponse,
  };
}

export async function createDelhiveryForwardShipment(
  request: ExchangeRequestForForwardShipment,
  runtime: DelhiveryRuntimeConfig,
): Promise<DelhiveryForwardShipmentResult> {
  if (!runtime.configured) {
    throw new DelhiveryForwardShipmentError(runtime.reason, 503);
  }

  const payload = buildDelhiveryForwardShipmentPayload(request, runtime.pickupLocationName);
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
  let rawResponse: unknown = rawText;
  try {
    rawResponse = rawText ? JSON.parse(rawText) : null;
  } catch {
    rawResponse = { raw: rawText };
  }

  if (!response.ok) {
    throw new DelhiveryForwardShipmentError(`Delhivery API returned HTTP ${response.status}.`, 502);
  }

  return normalizeDelhiveryForwardShipmentResponse(rawResponse, runtime.trackingUrlTemplate);
}
