export type PhoneMatchStatus =
  | "match"
  | "mismatch"
  | "missing_order_phone"
  | "missing_verified_phone";

export function normalizeIndianPhone(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  return null;
}

export function compareMegaskaPhoneIdentity(input: {
  verifiedPhone: string | null | undefined;
  orderPhone: string | null | undefined;
}): {
  verifiedPhoneNormalized: string;
  orderPhoneNormalized: string;
  status: PhoneMatchStatus;
  mismatchDetected: boolean;
} {
  // Identity comparison is exact. Callers must country-normalize raw Shopify values first.
  const canonical = (value: string | null | undefined) => {
    const trimmed = String(value || "").trim();
    return /^\+[1-9]\d{7,14}$/.test(trimmed) ? trimmed : "";
  };
  const verifiedPhoneNormalized = canonical(input.verifiedPhone);
  const orderPhoneNormalized = canonical(input.orderPhone);

  if (!verifiedPhoneNormalized) {
    return {
      verifiedPhoneNormalized,
      orderPhoneNormalized,
      status: "missing_verified_phone",
      mismatchDetected: true,
    };
  }

  if (!orderPhoneNormalized) {
    return {
      verifiedPhoneNormalized,
      orderPhoneNormalized,
      status: "missing_order_phone",
      mismatchDetected: true,
    };
  }

  const isMatch = verifiedPhoneNormalized === orderPhoneNormalized;

  return {
    verifiedPhoneNormalized,
    orderPhoneNormalized,
    status: isMatch ? "match" : "mismatch",
    mismatchDetected: !isMatch,
  };
}
