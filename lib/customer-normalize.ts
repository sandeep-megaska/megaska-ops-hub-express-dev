import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const value = email.trim().toLowerCase();
  return value || null;
}

/**
 * Default country fallback can be changed if you know your store market.
 * For India-first stores, "IN" is usually the safest fallback.
 */
export function normalizePhone(phone?: string | null, defaultCountry = "IN"): string | null {
  if (!phone) return null;

  const raw = phone.trim();
  if (!raw) return null;

  try {
    const parsed =
      parsePhoneNumberFromString(raw) ||
      parsePhoneNumberFromString(raw, defaultCountry);

    if (!parsed || !parsed.isValid()) return null;
    return parsed.number; // E.164
  } catch {
    return null;
  }
}

export function normalizeShopifyCustomerId(gid: string): string {
  // "gid://shopify/Customer/1234567890" -> "1234567890"
  return gid.split("/").pop() || gid;
}
