import type { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma";
import { isCanonicalE164 } from "../shopify/shopify-phone-normalization";

export type CustomerRedactionIdentifiers = {
  shopifyCustomerId?: string | null;
  email?: string | null;
  phone?: string | null;
};

// Nulling every PII-bearing field while keeping id/shopId/timestamps intact
// preserves referential integrity for orders, refunds, and other records that
// must remain linked (and, for GST/tax documents, legally retained) after a
// customer's identity is erased.
const REDACTED_CUSTOMER_PROFILE_FIELDS = {
  fullName: null,
  firstName: null,
  lastName: null,
  email: null,
  phoneE164: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  stateProvince: null,
  postalCode: null,
  countryRegion: null,
  shopifyCustomerId: null,
} satisfies Prisma.CustomerProfileUncheckedUpdateManyInput;

// A phone number without a reliable E.164 form is intentionally excluded from
// the match: a loose/fuzzy match risks redacting an unrelated customer's data,
// which is worse than leaving a phone-only match to a flagged manual review.
export function buildCustomerRedactionMatch(
  identifiers: CustomerRedactionIdentifiers,
): Prisma.CustomerProfileWhereInput[] {
  const or: Prisma.CustomerProfileWhereInput[] = [];
  const shopifyCustomerId = String(identifiers.shopifyCustomerId || "").trim();
  const email = String(identifiers.email || "").trim().toLowerCase();
  const phone = String(identifiers.phone || "").trim();

  if (shopifyCustomerId) {
    or.push({ shopifyCustomerId: { in: [shopifyCustomerId, `gid://shopify/Customer/${shopifyCustomerId}`] } });
  }
  if (email) {
    or.push({ email: { equals: email, mode: "insensitive" } });
  }
  if (phone && isCanonicalE164(phone)) {
    or.push({ phoneE164: phone });
  }
  return or;
}

export function hasUnmatchablePhoneIdentifier(identifiers: CustomerRedactionIdentifiers) {
  const phone = String(identifiers.phone || "").trim();
  return Boolean(phone) && !isCanonicalE164(phone);
}

export async function findCustomerProfilesForRedaction(shopId: string, identifiers: CustomerRedactionIdentifiers) {
  const or = buildCustomerRedactionMatch(identifiers);
  if (!or.length) return [];
  return prisma.customerProfile.findMany({ where: { shopId, OR: or } });
}

export async function redactCustomerProfiles(shopId: string, customerProfileIds: string[]) {
  if (!customerProfileIds.length) return { count: 0 };
  return prisma.customerProfile.updateMany({
    where: { id: { in: customerProfileIds }, shopId },
    data: REDACTED_CUSTOMER_PROFILE_FIELDS,
  });
}

export async function redactAllCustomerProfilesForShop(shopId: string) {
  return prisma.customerProfile.updateMany({
    where: { shopId },
    data: REDACTED_CUSTOMER_PROFILE_FIELDS,
  });
}
