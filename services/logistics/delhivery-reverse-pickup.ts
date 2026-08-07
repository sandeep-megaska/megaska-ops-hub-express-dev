import type { DelhiveryRuntimeConfig } from "./delhivery-runtime";

type ExchangeRequestForReversePickup = {
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
) {
  const customer = request.customerProfile;
  const name = required(request.customerNameSnapshot || customer?.fullName, "Customer name");
  const phone = required(request.customerPhoneSnapshot || customer?.phoneE164, "Customer phone");
  const address = required(joinAddress(customer?.addressLine1, customer?.addressLine2), "Customer address");
  const city = required(customer?.city, "Customer city");
  const state = required(customer?.stateProvince, "Customer state");
  const pin = required(customer?.postalCode, "Customer postal code");
  const order = required(request.orderNumber || request.id, "Order number");
  const productDescription = request.items
    .map((item) => [item.productTitle, item.variantTitle, item.sku].map(clean).filter(Boolean).join(" / "))
    .filter(Boolean)
    .join("; ") || "Exchange reverse pickup";
  const totalQuantity = request.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 1;

  return {
    pickup_location: {
      name: pickupLocationName || "Megaska Returns",
    },
    shipments: [
      {
        order: `EX-${order}-${request.id.slice(0, 8)}`,
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
  const success = root.success === true || root.success === "true" || Boolean(awb);

  if (!success) {
    const message = pickFirstString(root, ["error", "message", "rmk"])
      || pickFirstString(firstPackage, ["error", "message", "remarks", "rmk"])
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
): Promise<DelhiveryReversePickupResult> {
  if (!runtime.configured) {
    throw new DelhiveryReversePickupError(runtime.reason, 503);
  }

  const payload = buildDelhiveryReversePickupPayload(request, runtime.pickupLocationName);
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
    throw new DelhiveryReversePickupError(`Delhivery API returned HTTP ${response.status}.`, 502);
  }

  return normalizeDelhiveryReversePickupResponse(rawResponse, runtime.trackingUrlTemplate);
}
