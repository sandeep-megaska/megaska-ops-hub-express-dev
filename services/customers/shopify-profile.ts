import { prisma } from "../db/prisma.ts";
import { normalizeShopifyCustomerId, shopifyCustomerIdStorageForms } from "../../lib/shopify-customer-id.ts";

type ProfileData = Record<string, unknown>;

/**
 * Tenant-scoped, concurrency-safe Shopify profile resolution. The advisory lock
 * serializes legacy-form lookup plus creation until the canonical unique key is
 * present in every database.
 */
export async function resolveShopifyCustomerProfile(input: {
  shopId: string;
  shopifyCustomerId: unknown;
  data?: ProfileData;
}) {
  const shopId = input.shopId.trim();
  if (!shopId) throw new Error("Shop ID is required");
  const canonical = normalizeShopifyCustomerId(input.shopifyCustomerId);
  const forms = shopifyCustomerIdStorageForms(canonical);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${shopId}:${canonical}`}, 0))`;
    const matches = await tx.customerProfile.findMany({
      where: { shopId, shopifyCustomerId: { in: forms } },
      orderBy: { createdAt: "asc" },
    });
    if (matches.length > 1) throw new Error("Duplicate Shopify customer profiles require repair");
    if (matches[0]) {
      return tx.customerProfile.update({
        where: { id: matches[0].id },
        data: { ...(input.data ?? {}), shopifyCustomerId: canonical },
      });
    }
    return tx.customerProfile.create({
      data: { ...(input.data ?? {}), shopId, shopifyCustomerId: canonical } as never,
    });
  }, { isolationLevel: "Serializable" });
}
