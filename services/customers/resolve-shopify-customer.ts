import { normalizeShopifyCustomerId } from "../../lib/shopify-customer-id";

// Prisma clients and transaction clients expose structurally compatible dynamic delegates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Serializes identity creation per shop/customer and returns the canonical profile. */
export async function resolveShopifyCustomerProfile(
  db: Db,
  input: { shopId: string; shopifyCustomerId: unknown; create?: Record<string, unknown> },
) {
  const shopifyCustomerId = normalizeShopifyCustomerId(input.shopifyCustomerId);
  if (!shopifyCustomerId) throw new Error("Malformed Shopify customer ID");

  return db.$transaction(async (tx: Db) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shopify-customer:${input.shopId}:${shopifyCustomerId}`}))`;
    const existing = await tx.customerProfile.findUnique({
      where: { shopId_shopifyCustomerId: { shopId: input.shopId, shopifyCustomerId } },
    });
    if (existing) return existing;
    return tx.customerProfile.create({
      data: { ...(input.create ?? {}), shopId: input.shopId, shopifyCustomerId },
    });
  });
}
