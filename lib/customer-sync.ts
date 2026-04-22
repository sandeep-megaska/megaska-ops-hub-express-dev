import { PrismaClient } from "@prisma/client";
import { normalizeEmail, normalizePhone, normalizeShopifyCustomerId } from "@/lib/customer-normalize";
const prisma = new PrismaClient();

type AdminGraphQLClient = {
  request: (query: string, options?: { variables?: Record<string, any> }) => Promise<any>;
};

const CUSTOMERS_QUERY = `
  query CustomersSync($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        displayName
        firstName
        lastName
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        defaultEmailAddress {
          emailAddress
        }
        defaultPhoneNumber {
          phoneNumber
        }
        emailMarketingConsent {
          marketingState
        }
        smsMarketingConsent {
          marketingState
        }
        defaultAddress {
          address1
          address2
          city
          province
          zip
          country
          phone
          firstName
          lastName
          company
        }
        updatedAt
        createdAt
      }
    }
  }
`;

type SyncArgs = {
  shopId: string;
  admin: AdminGraphQLClient;
  defaultCountry?: string;
};

export async function syncCustomersForShop({
  shopId,
  admin,
  defaultCountry = "IN",
}: SyncArgs) {
  let hasNextPage = true;
  let after: string | null = null;

  let fetched = 0;
  let upserted = 0;
  let skipped = 0;

  while (hasNextPage) {
    const response = await admin.request(CUSTOMERS_QUERY, {
      variables: {
        first: 100,
        after,
      },
    });

    const connection = response?.data?.customers || response?.customers;
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
        email,
        phone,
        firstName: customer.firstName || null,
        lastName: customer.lastName || null,
        displayName: customer.displayName || null,
        acceptsEmailMarketing:
          customer.emailMarketingConsent?.marketingState === "SUBSCRIBED",
        acceptsSmsMarketing:
          customer.smsMarketingConsent?.marketingState === "SUBSCRIBED",
        ordersCount: customer.numberOfOrders ?? 0,
        amountSpent: customer.amountSpent?.amount
          ? customer.amountSpent.amount
          : null,
        defaultAddressJson: customer.defaultAddress || null,
        rawJson: customer,
      };

      /**
       * Primary identity for sync is (shopId, shopifyCustomerId)
       * This guarantees same Shopify customer updates remain inside the same shop.
       */
      await prisma.customerProfile.upsert({
        where: {
          shopId_shopifyCustomerId: {
            shopId,
            shopifyCustomerId,
          },
        },
        create: payload,
        update: payload,
      });

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
