import { CanonicalCustomerResolver } from "./canonical-customer-resolver";

// Prisma clients and transaction clients expose structurally compatible dynamic delegates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Serializes identity creation per shop/customer and returns the canonical profile. */
export async function resolveShopifyCustomerProfile(
  _db: Db,
  input: { shopId: string; shopifyCustomerId: unknown; create?: Record<string, unknown> },
) {
  const resolution = await new CanonicalCustomerResolver().resolveFromCustomerSync({
    shopId: input.shopId,
    shopifyCustomerId: input.shopifyCustomerId,
    customerAttributes: input.create,
  });
  if (!resolution.customerProfile) throw new Error("IDENTITY_CONFLICT");
  return resolution.customerProfile;
}
