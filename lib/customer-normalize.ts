export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const value = String(email).trim().toLowerCase();
  return value || null;
}

export function normalizePhone(
  phone?: string | null,
  defaultCountry = "IN"
): string | null {
  const raw = String(phone || "").trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");

  // India-first normalization
  if (defaultCountry === "IN") {
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
    if (digits.length === 13 && raw.startsWith("+91")) return `+${digits}`;
  }

  // Generic fallback: keep already plus-prefixed values if they look usable
  if (raw.startsWith("+") && digits.length >= 8) {
    return `+${digits}`;
  }

  return null;
}

export function normalizeShopifyCustomerId(gid: string): string {
  return String(gid || "").split("/").pop() || String(gid || "");
}
