import { CourierProvider } from "../../generated/prisma";
import { buildEnvDelhiveryRuntimeConfig, type DelhiveryRuntimeConfig } from "./delhivery-runtime";
import type { CourierAdapter, CourierTrackingSnapshot } from "./courier-service";
import { normalizeDelhiveryTrackingResponse } from "./delhivery-tracking-normalize.ts";

export { normalizeDelhiveryRawStatus, normalizeDelhiveryTrackingResponse } from "./delhivery-tracking-normalize.ts";

export class DelhiveryTrackingError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "DelhiveryTrackingError";
    this.statusCode = statusCode;
  }
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function resolveTrackingEndpoint(runtime: DelhiveryRuntimeConfig, awb: string) {
  const baseUrl = runtime.baseUrl.replace(/\/+$/, "");
  const path = runtime.trackingPath;
  const endpoint = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const url = new URL(endpoint);
  if (!url.searchParams.has("waybill") && !url.searchParams.has("awb")) {
    url.searchParams.set("waybill", awb);
  }
  return url.toString();
}

export class DelhiveryAdapter implements CourierAdapter {
  provider: CourierProvider = "DELHIVERY";
  private readonly runtime?: DelhiveryRuntimeConfig;

  // Optional per-shop runtime config; falls back to env for any legacy/no-shop
  // caller (e.g. a generic CourierService path).
  constructor(runtime?: DelhiveryRuntimeConfig) {
    this.runtime = runtime;
  }

  async fetchTracking(input: { awb?: string | null; providerReference?: string | null }): Promise<CourierTrackingSnapshot | null> {
    const runtime = this.runtime ?? buildEnvDelhiveryRuntimeConfig();
    if (!runtime.configured) return null;
    const awb = clean(input.awb);
    if (!awb) throw new DelhiveryTrackingError("AWB is required to fetch Delhivery tracking.", 400);

    const response = await fetch(resolveTrackingEndpoint(runtime, awb), {
      method: "GET",
      headers: { Authorization: `Token ${runtime.apiToken}`, Accept: "application/json" },
    });
    const rawText = await response.text();
    let rawResponse: unknown = rawText;
    try {
      rawResponse = rawText ? JSON.parse(rawText) : null;
    } catch {
      rawResponse = { raw: rawText };
    }

    if (!response.ok) throw new DelhiveryTrackingError(`Delhivery tracking API returned HTTP ${response.status}.`, 502);
    return normalizeDelhiveryTrackingResponse(rawResponse, awb, input.providerReference, runtime.trackingUrlTemplate);
  }
}
