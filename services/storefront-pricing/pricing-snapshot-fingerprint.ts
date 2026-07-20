import { createHash } from "node:crypto";

type Scalar = string | number | boolean | null;
type Canonical = Scalar | Canonical[] | { [key: string]: Canonical };

function canonical(value: unknown): Canonical {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().normalize("NFKC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Fingerprint values must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  throw new Error("Fingerprint values must be JSON-compatible");
}

export function pricingInputFingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}

export type CartFingerprintLine = { variantId: string; quantity: number; sellingPlanId?: string | null; attributes?: Record<string, string> };
export function cartPricingFingerprint(lines: readonly CartFingerprintLine[]): string {
  const normalized = lines.map((line) => ({ variantId: line.variantId.trim(), quantity: line.quantity, sellingPlanId: line.sellingPlanId?.trim() || null, attributes: line.attributes ?? {} }))
    .sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
  return pricingInputFingerprint(normalized);
}

export type AddressPricingFingerprintInput = { countryCode: string; provinceCode?: string | null; postalCode?: string | null; city?: string | null };
export function addressPricingFingerprint(address: AddressPricingFingerprintInput): string {
  return pricingInputFingerprint({ countryCode: address.countryCode.trim().toUpperCase(), provinceCode: address.provinceCode?.trim().toUpperCase() || null, postalCode: address.postalCode?.trim().toUpperCase() || null, city: address.city?.trim().toLocaleLowerCase("en") || null });
}
