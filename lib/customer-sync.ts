import {
  normalizeEmail,
  normalizePhone,
  normalizeShopifyCustomerId,
} from "./customer-normalize";
import { getShopifyCustomersForSync, findShopifyCustomerForSync } from "../services/shopify/admin";
import { CanonicalCustomerResolver } from "../services/customers/canonical-customer-resolver";

type SyncArgs = {
  shopId: string;
  shopDomain: string;
  defaultCountry?: string;
};

function customerAttributes(customer: Awaited<ReturnType<typeof getShopifyCustomersForSync>>["nodes"][number]) {
  return {
    firstName: customer.firstName || null,
    lastName: customer.lastName || null,
    fullName: customer.displayName || null,
    addressLine1: customer.defaultAddress?.address1 || null,
    addressLine2: customer.defaultAddress?.address2 || null,
    city: customer.defaultAddress?.city || null,
    stateProvince: customer.defaultAddress?.province || null,
    postalCode: customer.defaultAddress?.zip || null,
    countryRegion: customer.defaultAddress?.country || null,
  };
}

export async function syncCustomersForShop({ shopId, shopDomain, defaultCountry = "IN" }: SyncArgs) {
  let hasNextPage = true;
  let after: string | null = null;
  let fetched = 0;
  let upserted = 0;
  let skipped = 0;
  const resolver = new CanonicalCustomerResolver();

  while (hasNextPage) {
    const connection = await getShopifyCustomersForSync({ shopDomain, first: 100, after });
    for (const customer of connection?.nodes ?? []) {
      fetched += 1;
      const shopifyCustomerId = normalizeShopifyCustomerId(customer.id);
      if (!shopifyCustomerId) { skipped += 1; continue; }
      const resolution = await resolver.resolveFromCustomerSync({
        shopId,
        shopifyCustomerId,
        country: defaultCountry,
        // Shopify's sync response does not prove phone/email ownership; do not use either as identity.
        customerAttributes: customerAttributes(customer),
      });
      if (resolution.outcome === "IDENTITY_CONFLICT") { skipped += 1; continue; }
      upserted += 1;
    }
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }
  return { success: true, fetched, upserted, skipped };
}

type SyncSingleCustomerArgs = SyncArgs & { phone?: string | null; email?: string | null };
export async function syncSingleCustomerForShop({ shopId, shopDomain, phone, email, defaultCountry = "IN" }: SyncSingleCustomerArgs) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone, defaultCountry);
  if (!normalizedEmail && !normalizedPhone) throw new Error("Phone or email is required");
  const candidates = await findShopifyCustomerForSync({ shopDomain, phone: normalizedPhone, email: normalizedEmail });
  if (!candidates.length) return { success: true, found: false, synced: false, message: "No matching Shopify customer found" };
  const customer = candidates.find((candidate) => {
    const candidateEmail = normalizeEmail(candidate.defaultEmailAddress?.emailAddress);
    const candidatePhone = normalizePhone(candidate.defaultPhoneNumber?.phoneNumber, defaultCountry) || normalizePhone(candidate.defaultAddress?.phone, defaultCountry);
    return Boolean((normalizedEmail && candidateEmail === normalizedEmail) || (normalizedPhone && candidatePhone === normalizedPhone));
  }) || candidates[0];
  const shopifyCustomerId = normalizeShopifyCustomerId(customer.id);
  if (!shopifyCustomerId) throw new Error("Matched customer is missing Shopify customer id");
  const resolution = await new CanonicalCustomerResolver().resolveFromCustomerSync({
    shopId, shopifyCustomerId, country: defaultCountry, customerAttributes: customerAttributes(customer),
  });
  if (!resolution.customerProfile) return { success: false, found: true, synced: false, error: "IDENTITY_CONFLICT" };
  return { success: true, found: true, synced: true, shopifyCustomerId };
}
