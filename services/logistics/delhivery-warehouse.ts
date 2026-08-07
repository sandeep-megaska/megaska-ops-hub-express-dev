import type { DelhiveryRuntimeConfig } from "./delhivery-runtime";

// Register the merchant's pickup warehouse ("ClientWarehouse") with Delhivery
// from the details they enter in Settings → Delhivery, so they never have to
// create it in the Delhivery portal. Idempotent: an "already exists" response is
// treated as success.

export class DelhiveryWarehouseError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DelhiveryWarehouseError";
    this.statusCode = statusCode;
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function missingWarehouseFields(runtime: DelhiveryRuntimeConfig): string[] {
  const w = runtime.warehouse;
  const missing: string[] = [];
  if (!clean(w.name)) missing.push("pickup location / warehouse name");
  if (!clean(w.phone)) missing.push("warehouse phone");
  if (!clean(w.address)) missing.push("warehouse address");
  if (!clean(w.city)) missing.push("warehouse city");
  if (!clean(w.state)) missing.push("warehouse state");
  if (!clean(w.pin)) missing.push("origin pincode");
  return missing;
}

function buildWarehousePayload(runtime: DelhiveryRuntimeConfig) {
  const w = runtime.warehouse;
  return {
    name: w.name,
    registered_name: w.name,
    email: clean(w.email) || undefined,
    phone: w.phone,
    address: w.address,
    city: w.city,
    country: "India",
    pin: w.pin,
    return_address: w.address,
    return_pin: w.pin,
    return_city: w.city,
    return_state: w.state,
    return_country: "India",
  };
}

function resolveEndpoint(runtime: DelhiveryRuntimeConfig) {
  const baseUrl = runtime.baseUrl.replace(/\/+$/, "");
  const path = runtime.clientWarehouseCreatePath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function extractError(root: Record<string, unknown>, rawText: string): string {
  const raw = root.error ?? root.message ?? root.data ?? root.rmk;
  if (Array.isArray(raw)) return raw.map((entry) => clean(entry)).filter(Boolean).join("; ");
  return clean(raw) || clean(rawText);
}

/**
 * Ensure the merchant's Delhivery pickup warehouse exists. Creates it when
 * missing; treats "already exists" as success. Throws DelhiveryWarehouseError
 * (422) when the warehouse details aren't configured, or (502) on an API error.
 */
export async function ensureDelhiveryWarehouse(runtime: DelhiveryRuntimeConfig): Promise<{ created: boolean }> {
  if (!runtime.configured) {
    throw new DelhiveryWarehouseError(runtime.reason, 503);
  }

  const missing = missingWarehouseFields(runtime);
  if (missing.length) {
    throw new DelhiveryWarehouseError(
      `Cannot register the Delhivery pickup warehouse — missing: ${missing.join(", ")}. Add these in Settings → Delhivery.`,
      422,
    );
  }

  const response = await fetch(resolveEndpoint(runtime), {
    method: "POST",
    headers: {
      Authorization: `Token ${runtime.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildWarehousePayload(runtime)),
  });

  const rawText = await response.text();
  let data: unknown = rawText;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const success = root.success === true || root.success === "true";
  const errorMsg = extractError(root, rawText);

  if (response.ok && success) {
    return { created: true };
  }

  // Delhivery rejects a duplicate warehouse name — that means it already exists,
  // which is exactly the state we want. Treat as success.
  if (/already exist|duplicate|registered/i.test(errorMsg) || /already exist/i.test(rawText)) {
    return { created: false };
  }

  throw new DelhiveryWarehouseError(
    errorMsg || `Delhivery warehouse registration failed (HTTP ${response.status}).`,
    502,
  );
}
