import { InvalidCustomerIdentityError } from "./customer-identity-errors";

const SHOPIFY_CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/(\d+)$/;
const NUMERIC_ID = /^\d+$/;
const COUNTRY_CALLING_CODES: Readonly<Record<string, string>> = { IN: "91", US: "1", CA: "1", GB: "44", AU: "61", AE: "971", KW: "965" };

export function normalizeWhitespace(value?: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

export function normalizeCountry(value?: string | null): string | null {
  const country = normalizeWhitespace(value)?.toUpperCase() ?? null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw new InvalidCustomerIdentityError("Country must be an ISO 3166-1 alpha-2 code");
  return country;
}

export function normalizeEmail(value?: string | null): string | null {
  const email = normalizeWhitespace(value)?.toLowerCase() ?? null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvalidCustomerIdentityError("Email is malformed");
  return email;
}

export function normalizeShopifyCustomerId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new InvalidCustomerIdentityError("Shopify customer ID is malformed");
  }
  const candidate = String(value).trim();
  const id = NUMERIC_ID.test(candidate) ? candidate : SHOPIFY_CUSTOMER_GID.exec(candidate)?.[1];
  if (!id) throw new InvalidCustomerIdentityError("Shopify customer ID is malformed");
  return id;
}

/** Produces E.164. National numbers require an explicitly supported country (India by default). */
export function normalizePhone(value?: string | null, countryValue: string | null = "IN"): string | null {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;

  const country = normalizeCountry(countryValue) ?? "IN";
  const callingCode = COUNTRY_CALLING_CODES[country];
  if (!callingCode) throw new InvalidCustomerIdentityError(`National phone normalization is unsupported for country ${country}`);
  if (digits.startsWith(callingCode) && digits.length >= 8 && digits.length <= 15) return `+${digits}`;

  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  const result = `${callingCode}${national}`;
  if (national.length < 6 || result.length > 15) throw new InvalidCustomerIdentityError("Phone is malformed");
  return `+${result}`;
}

export function normalizeCustomerAttributes<T extends Record<string, unknown>>(attributes?: T): T | undefined {
  if (!attributes) return undefined;
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [
    key,
    typeof value === "string" ? normalizeWhitespace(value) : value,
  ])) as T;
}
