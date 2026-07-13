import { createHash } from "crypto";

export type CodAdvanceFingerprintInput = {
  shopId: string;
  expressCheckoutIntentId: string;
  cartToken: string | null;
  shopifyCartId: string | null;
  cartSnapshot: unknown;
  subtotalAmountPaise: number;
  discountAmountPaise: number;
  shippingAmountPaise: number;
  codFeeAmountPaise: number;
  totalAmountPaise: number;
  currency: string;
  storeCreditReservationId: string | null;
  storeCreditReservedAmountPaise: number;
  codSettingsId: string | null;
  codSettingsVersion: number | null;
  advanceType: string;
  fixedAdvanceAmountPaise: number;
  percentageBasisPoints: number | null;
  minimumAdvanceAmountPaise: number | null;
  maximumAdvanceAmountPaise: number | null;
  minOrderAmountPaise: number | null;
  maxOrderAmountPaise: number | null;
};

type JsonSafe = null | string | number | boolean | JsonSafe[] | { [key: string]: JsonSafe };

function canonicalize(value: unknown): JsonSafe {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const output: { [key: string]: JsonSafe } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return null;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function createCodAdvancePricingFingerprint(input: CodAdvanceFingerprintInput) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
