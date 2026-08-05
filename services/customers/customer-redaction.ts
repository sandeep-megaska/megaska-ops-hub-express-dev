import { Prisma } from "../../generated/prisma/index.js";
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

// The same customer PII (phone/email/name/address) is copied into a number of
// downstream "snapshot" tables. Redacting only CustomerProfile leaves that PII
// behind, so a GDPR erasure must reach these too. Transient auth/verification/
// checkout rows are DELETED (they have no retention value); records we keep for
// operational/financial integrity have their PII fields nulled/anonymized while
// ids/amounts/timestamps stay intact. Wrapped in one transaction so a redaction
// is all-or-nothing.
export type RedactableProfile = { id: string; phoneE164: string | null; email: string | null };

type LabeledBatch = readonly [label: string, op: Prisma.PrismaPromise<{ count: number }>];

async function runRedactionBatch(ops: LabeledBatch[]): Promise<Record<string, number>> {
  const results = await prisma.$transaction(ops.map(([, op]) => op));
  const counts: Record<string, number> = {};
  ops.forEach(([label], index) => {
    counts[label] = results[index]?.count ?? 0;
  });
  return counts;
}

// Redact the downstream PII for a specific set of matched customer profiles.
// Pass the profiles BEFORE their CustomerProfile row is nulled so their phone/
// email are still available for the phone/email-keyed tables (OTP, funnel).
export async function redactCustomerRelatedData(profiles: RedactableProfile[]): Promise<Record<string, number>> {
  const ids = profiles.map((profile) => profile.id);
  if (!ids.length) return {};
  const phones = Array.from(new Set(profiles.map((p) => String(p.phoneE164 || "").trim()).filter(Boolean)));
  const emails = Array.from(new Set(profiles.map((p) => String(p.email || "").trim().toLowerCase()).filter(Boolean)));

  // ExchangePaymentInvoice carries customer PII but links to the customer only
  // through its parent OrderActionRequest (requestId), so resolve those first.
  const requestIds = (
    await prisma.orderActionRequest.findMany({ where: { customerProfileId: { in: ids } }, select: { id: true } })
  ).map((row) => row.id);

  const phoneOr = phones.length ? [{ phoneE164: { in: phones } }] : [];
  const emailOr = emails.length ? [{ email: { in: emails } }] : [];
  const funnelPhoneOr = phones.length ? [{ phoneSnapshot: { in: phones } }] : [];

  const ops: LabeledBatch[] = [
    ["otpChallenge", prisma.oTPChallenge.deleteMany({ where: { OR: [{ customerProfileId: { in: ids } }, ...phoneOr] } })],
    ["authSession", prisma.authSession.deleteMany({ where: { customerProfileId: { in: ids } } })],
    ["emailVerificationChallenge", prisma.emailVerificationChallenge.deleteMany({ where: { OR: [{ customerProfileId: { in: ids } }, ...emailOr] } })],
    ["expressCheckoutAddressSnapshot", prisma.expressCheckoutAddressSnapshot.deleteMany({ where: { customerProfileId: { in: ids } } })],
    ["expressCheckoutIntent", prisma.expressCheckoutIntent.updateMany({ where: { customerProfileId: { in: ids } }, data: { phoneSnapshot: null, sessionTokenHash: null } })],
    ["checkoutFunnelEvent", prisma.checkoutFunnelEvent.updateMany({ where: { OR: [{ customerProfileId: { in: ids } }, ...funnelPhoneOr] }, data: { phoneSnapshot: null, sessionTokenHash: null } })],
    ["orderActionRequest", prisma.orderActionRequest.updateMany({ where: { customerProfileId: { in: ids } }, data: { customerNameSnapshot: null, customerPhoneSnapshot: null, customerEmailSnapshot: null, customerNote: null } })],
    ["productReview", prisma.productReview.updateMany({ where: { customerProfileId: { in: ids } }, data: { customerDisplayName: "Anonymous" } })],
  ];
  if (requestIds.length) {
    ops.push([
      "exchangePaymentInvoice",
      prisma.exchangePaymentInvoice.updateMany({
        where: { requestId: { in: requestIds } },
        data: { customerName: "REDACTED", customerPhone: null, customerEmail: null, htmlSnapshot: null, textSnapshot: null },
      }),
    ]);
  }
  const counts = await runRedactionBatch(ops);
  // The gift-card columns aren't in the committed generated Prisma client (same
  // reason shop/redact nulls the token columns via raw SQL); strip the stored
  // spendable code here so it doesn't survive an erasure.
  counts.walletAccount = await prisma.$executeRaw`
    UPDATE "WalletAccount" SET "giftCardCodeEnc" = NULL, "shopifyGiftCardLast4" = NULL, "updatedAt" = NOW()
    WHERE "customerProfileId" IN (${Prisma.join(ids)})`;
  return counts;
}

// Shop-level erasure (shop/redact): redact the downstream PII for EVERY customer
// of the shop, mirroring redactAllCustomerProfilesForShop.
export async function redactAllCustomerRelatedDataForShop(shopId: string): Promise<Record<string, number>> {
  const requestIds = (
    await prisma.orderActionRequest.findMany({ where: { shopId }, select: { id: true } })
  ).map((row) => row.id);

  const ops: LabeledBatch[] = [
    ["otpChallenge", prisma.oTPChallenge.deleteMany({ where: { shopId } })],
    ["authSession", prisma.authSession.deleteMany({ where: { customer: { shopId } } })],
    ["emailVerificationChallenge", prisma.emailVerificationChallenge.deleteMany({ where: { shopId } })],
    ["expressCheckoutAddressSnapshot", prisma.expressCheckoutAddressSnapshot.deleteMany({ where: { shopId } })],
    ["expressCheckoutIntent", prisma.expressCheckoutIntent.updateMany({ where: { shopId }, data: { phoneSnapshot: null, sessionTokenHash: null } })],
    ["checkoutFunnelEvent", prisma.checkoutFunnelEvent.updateMany({ where: { shopId }, data: { phoneSnapshot: null, sessionTokenHash: null } })],
    ["orderActionRequest", prisma.orderActionRequest.updateMany({ where: { shopId }, data: { customerNameSnapshot: null, customerPhoneSnapshot: null, customerEmailSnapshot: null, customerNote: null } })],
    ["productReview", prisma.productReview.updateMany({ where: { shopId }, data: { customerDisplayName: "Anonymous" } })],
  ];
  if (requestIds.length) {
    ops.push([
      "exchangePaymentInvoice",
      prisma.exchangePaymentInvoice.updateMany({
        where: { requestId: { in: requestIds } },
        data: { customerName: "REDACTED", customerPhone: null, customerEmail: null, htmlSnapshot: null, textSnapshot: null },
      }),
    ]);
  }
  const counts = await runRedactionBatch(ops);
  counts.walletAccount = await prisma.$executeRaw`
    UPDATE "WalletAccount" SET "giftCardCodeEnc" = NULL, "shopifyGiftCardLast4" = NULL, "updatedAt" = NOW()
    WHERE "shopId" = ${shopId}`;
  return counts;
}
