import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js/min";

const failure = (reason) => ({ valid: false, normalizedPhone: null, reason });
const supportedCountries = new Set(getCountries());

/**
 * @param {{phone?: unknown, countryCode?: unknown}} input
 * @returns {{valid: boolean, normalizedPhone: string | null, reason: string | null}}
 */
export function validateCheckoutPhone({ phone, countryCode }) {
  const rawPhone = String(phone || "").trim();
  const country = String(countryCode || "").trim().toUpperCase();

  if (!country) return failure("COUNTRY_REQUIRED");
  if (!/^[A-Z]{2}$/.test(country) || !supportedCountries.has(country)) return failure("INVALID_COUNTRY");
  if (!rawPhone) return failure("PHONE_REQUIRED");

  // Preserve the legacy Indian mobile rule and all previously accepted prefixes.
  if (country === "IN") {
    const digits = rawPhone.replace(/\D/g, "");
    const national =
      (/^[6-9]\d{9}$/.test(digits) && digits) ||
      (/^0[6-9]\d{9}$/.test(digits) && digits.slice(1)) ||
      (/^91[6-9]\d{9}$/.test(digits) && digits.slice(2)) ||
      (/^091[6-9]\d{9}$/.test(digits) && digits.slice(3)) ||
      (/^0091[6-9]\d{9}$/.test(digits) && digits.slice(4));

    if (national) return { valid: true, normalizedPhone: `+91${national}`, reason: null };
    if (rawPhone.startsWith("+") && !digits.startsWith("91")) {
      return failure("COUNTRY_MISMATCH");
    }
    return failure("INVALID_PHONE");
  }

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(rawPhone, country);
  } catch {
    return failure("INVALID_COUNTRY");
  }

  if (!parsed) return failure("INVALID_PHONE");
  if (rawPhone.startsWith("+") && parsed.country !== country) return failure("COUNTRY_MISMATCH");
  if (parsed.country !== country || !parsed.isValid()) return failure("INVALID_PHONE");

  return { valid: true, normalizedPhone: parsed.number, reason: null };
}
