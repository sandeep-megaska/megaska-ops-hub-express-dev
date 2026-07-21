import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { normalizePhoneToE164 } from "../phone-international.ts";

export type NormalizeShopifyPhoneInput = { phone: unknown; countryCode?: unknown };
export type ShopifyPhoneNormalizationResult =
  | { ok: true; phoneE164: string; countryCode: string | null; source: "already_e164" | "country_normalized" | "legacy_india" }
  | { ok: false; reason: "PHONE_MISSING" | "COUNTRY_REQUIRED" | "INVALID_PHONE" | "INVALID_COUNTRY" };

/** Validates the canonical storage shape, not whether a number is assigned. */
export function isCanonicalE164(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}

export function normalizeShopifyPhone({ phone, countryCode }: NormalizeShopifyPhoneInput): ShopifyPhoneNormalizationResult {
  if (phone == null || (typeof phone === "string" && !phone.trim())) return { ok: false, reason: "PHONE_MISSING" };
  if (typeof phone !== "string") return { ok: false, reason: "INVALID_PHONE" };
  const value = phone.trim();
  if (/^\+[1-9]\d{7,14}$/.test(value)) {
    return { ok: true, phoneE164: value, countryCode: parsePhoneNumberFromString(value)?.country ?? null, source: "already_e164" };
  }
  if (countryCode == null || (typeof countryCode === "string" && !countryCode.trim())) return { ok: false, reason: "COUNTRY_REQUIRED" };
  const result = normalizePhoneToE164({ input: value.startsWith("00") ? `+${value.slice(2)}` : value, countryCode });
  if (!result.ok) {
    // Shopify can contain dialable legacy numbers that current numbering metadata
    // does not classify as assigned. Preserve a parseable E.164 storage shape.
    const normalizedCountry = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
    const parsed = parsePhoneNumberFromString(value.startsWith("00") ? `+${value.slice(2)}` : value, normalizedCountry as never);
    if (parsed?.country === normalizedCountry && isCanonicalE164(parsed.number)) {
      return { ok: true, phoneE164: parsed.number, countryCode: normalizedCountry, source: normalizedCountry === "IN" && !value.startsWith("+") ? "legacy_india" : "country_normalized" };
    }
    return { ok: false, reason: result.reason === "INVALID_COUNTRY" ? "INVALID_COUNTRY" : "INVALID_PHONE" };
  }
  return {
    ok: true,
    phoneE164: result.phoneE164,
    countryCode: result.countryCode,
    source: result.countryCode === "IN" && !value.startsWith("+") ? "legacy_india" : "country_normalized",
  };
}

/** Exact canonical query first; India-only variants support historical Shopify records. */
export function shopifyPhoneSearchVariants(phoneE164: string): string[] {
  if (!isCanonicalE164(phoneE164)) return [];
  if (!phoneE164.startsWith("+91")) return [phoneE164];
  const national = phoneE164.slice(3);
  return [...new Set([phoneE164, national, `91${national}`, `0091${national}`])];
}
