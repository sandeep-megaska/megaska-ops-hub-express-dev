import type { DelhiveryRuntimeConfig } from "./delhivery-runtime";

// Delhivery auto-assigns a waybill for FORWARD shipments (Prepaid/COD) when the
// payload leaves it blank, but it does NOT do so for REVERSE pickups
// (payment_mode "Pickup"). A blank waybill on a reverse pickup fails Delhivery's
// CMU with: "Waybill does not match master waybill pattern or wrong shipment type
// for waybill". So we pre-fetch a waybill from the merchant's assigned master
// series and put it on the shipment.

export class DelhiveryWaybillError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "DelhiveryWaybillError";
    this.statusCode = statusCode;
  }
}

function resolveEndpoint(runtime: DelhiveryRuntimeConfig) {
  const baseUrl = runtime.baseUrl.replace(/\/+$/, "");
  const path = runtime.waybillFetchPath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// The bulk waybill endpoint returns a JSON string ("123,124,..."), sometimes a
// bare string, an array, or an object. Normalize all of them to the first code.
function extractFirstWaybill(value: unknown): string {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (Array.isArray(value)) {
    text = value.map((entry) => String(entry ?? "")).join(",");
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    text = String(record.waybill ?? record.data ?? record.packages ?? "");
  }
  return text
    .split(",")
    .map((part) => part.replace(/["'\s]/g, "").trim())
    .filter(Boolean)[0] || "";
}

/**
 * Fetch a single fresh waybill from Delhivery's assigned master series for this
 * merchant. Throws DelhiveryWaybillError on an API/parse failure.
 */
export async function fetchDelhiveryWaybill(runtime: DelhiveryRuntimeConfig): Promise<string> {
  const url = `${resolveEndpoint(runtime)}?count=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Token ${runtime.apiToken}`,
      Accept: "application/json",
    },
  });

  const rawText = await response.text();
  console.info("[DELHIVERY WAYBILL FETCH] response", {
    status: response.status,
    ok: response.ok,
    body: rawText.slice(0, 300),
  });

  if (!response.ok) {
    throw new DelhiveryWaybillError(`Delhivery waybill fetch returned HTTP ${response.status}.`);
  }

  let value: unknown = rawText;
  try {
    value = rawText ? JSON.parse(rawText) : "";
  } catch {
    value = rawText;
  }

  const waybill = extractFirstWaybill(value);
  if (!waybill) {
    throw new DelhiveryWaybillError("Delhivery did not return a waybill for the reverse pickup.");
  }
  return waybill;
}
