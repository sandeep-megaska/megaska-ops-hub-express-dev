import { prisma } from "../services/db/prisma";
import {
  normalizeEmail,
  normalizePhone,
  normalizeShopifyCustomerId,
} from "./customer-normalize";
import { getShopifyCustomersForSync } from "../services/shopify/admin";

type SyncArgs = {
  shopId: string;
  shopDomain: string;
  defaultCountry?: string;
};

export async function syncCustomersForShop({
  shopId,
  shopDomain,
  defaultCountry = "IN",
}: SyncArgs) {
  let hasNextPage = true;
  let after: string | null = null;

  let fetched = 0;
  let upserted = 0;
  let skipped = 0;

  while (hasNextPage) {
    const connection = await getShopifyCustomersForSync({
      shopDomain,
      first: 100,
      after,
    });

    const nodes = connection?.nodes ?? [];
    const pageInfo = connection?.pageInfo;

    for (const customer of nodes) {
      fetched += 1;

      const shopifyCustomerId = normalizeShopifyCustomerId(customer.id);
      const email = normalizeEmail(customer.defaultEmailAddress?.emailAddress);
      const phone =
        normalizePhone(customer.defaultPhoneNumber?.phoneNumber, defaultCountry) ||
        normalizePhone(customer.defaultAddress?.phone, defaultCountry);

      if (!shopifyCustomerId) {
        skipped += 1;
        continue;
      }

      const payload = {
        shopId,
        shopifyCustomerId,
        phoneE164: phone,
        email,
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

      let existing = await prisma.customerProfile.findUnique({
        where: {
          shopId_shopifyCustomerId: {
            shopId,
            shopifyCustomerId,
          },
        },
      });

      if (!existing && phone) {
        existing = await prisma.customerProfile.findFirst({
          where: {
            shopId,
            phoneE164: phone,
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      }

      if (!existing && email) {
        existing = await prisma.customerProfile.findFirst({
          where: {
            shopId,
            email,
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      }

      if (existing) {
        await prisma.customerProfile.update({
          where: {
            id: existing.id,
          },
          data: payload,
        });
      } else {
        await prisma.customerProfile.create({
          data: payload,
        });
      }

      upserted += 1;
    }

    hasNextPage = Boolean(pageInfo?.hasNextPage);
    after = pageInfo?.endCursor || null;
  }

  return {
    success: true,
    fetched,
    upserted,
    skipped,
  };
}
import { findShopifyCustomerForSync } from "../services/shopify/admin";
type SyncSingleCustomerArgs = {
  shopId: string;
  shopDomain: string;
  phone?: string | null;
  email?: string | null;
  defaultCountry?: string;
};

export async function syncSingleCustomerForShop({
  shopId,
  shopDomain,
  phone,
  email,
  defaultCountry = "IN",
}: SyncSingleCustomerArgs) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone, defaultCountry);

  if (!normalizedEmail && !normalizedPhone) {
    throw new Error("Phone or email is required");
  }

  const candidates = await findShopifyCustomerForSync({
    shopDomain,
    phone: normalizedPhone,
    email: normalizedEmail,
  });

  if (!candidates.length) {
    return {
      success: true,
      found: false,
      synced: false,
      message: "No matching Shopify customer found",
    };
  }

  const matched = candidates.find((customer) => {
    const candidateEmail = normalizeEmail(customer.defaultEmailAddress?.emailAddress);
    const candidatePhone =
      normalizePhone(customer.defaultPhoneNumber?.phoneNumber, defaultCountry) ||
      normalizePhone(customer.defaultAddress?.phone, defaultCountry);

    const emailMatches = normalizedEmail && candidateEmail === normalizedEmail;
    const phoneMatches = normalizedPhone && candidatePhone === normalizedPhone;

    return Boolean(emailMatches || phoneMatches);
  });

  const customer = matched || candidates[0];

  const shopifyCustomerId = normalizeShopifyCustomerId(customer.id);
  const finalEmail = normalizeEmail(customer.defaultEmailAddress?.emailAddress);
  const finalPhone =
    normalizePhone(customer.defaultPhoneNumber?.phoneNumber, defaultCountry) ||
    normalizePhone(customer.defaultAddress?.phone, defaultCountry);

  if (!shopifyCustomerId) {
    throw new Error("Matched customer is missing Shopify customer id");
  }

  const payload = {
    shopId,
    shopifyCustomerId,
    phoneE164: finalPhone,
    email: finalEmail,
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

  let existing = await prisma.customerProfile.findUnique({
    where: {
      shopId_shopifyCustomerId: {
        shopId,
        shopifyCustomerId,
      },
    },
  });

  if (!existing && finalPhone) {
    existing = await prisma.customerProfile.findFirst({
      where: {
        shopId,
        phoneE164: finalPhone,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  if (!existing && finalEmail) {
    existing = await prisma.customerProfile.findFirst({
      where: {
        shopId,
        email: finalEmail,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  if (existing) {
    await prisma.customerProfile.update({
      where: {
        id: existing.id,
      },
      data: payload,
    });
  } else {
    await prisma.customerProfile.create({
      data: payload,
    });
  }

  return {
    success: true,
    found: true,
    synced: true,
    shopifyCustomerId,
    phoneE164: finalPhone,
    email: finalEmail,
  };
}
