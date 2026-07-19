import "dotenv/config";

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  throw new Error("Customer identity repair is unavailable in production");
}
if (process.env.ALLOW_CUSTOMER_IDENTITY_REPAIR !== "true") {
  throw new Error("Set ALLOW_CUSTOMER_IDENTITY_REPAIR=true to enable this development-only repair");
}

const [keepId, duplicateId, orderId, reviewRequestId] = process.argv.slice(2);
if (![keepId, duplicateId, orderId, reviewRequestId].every(Boolean)) {
  throw new Error("Usage: node scripts/dev-repair-customer-profile-duplicate.mjs KEEP_PROFILE DUPLICATE_PROFILE ORDER REVIEW_REQUEST");
}

const { PrismaClient } = await import("../generated/prisma/client.js");
const { PrismaPg } = await import("@prisma/adapter-pg");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const normalize = (value) => {
  const match = String(value ?? "").trim().match(/^(?:gid:\/\/shopify\/Customer\/)?(\d+)$/);
  return match?.[1] ?? null;
};
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-profile-repair:${keepId}:${duplicateId}`}))`;
    const profiles = await tx.customerProfile.findMany({ where: { id: { in: [keepId, duplicateId] } } });
    if (profiles.length === 1 && profiles[0].id === keepId) return { status: "already_repaired" };
    if (profiles.length !== 2) throw new Error("Both customer profiles must exist");
    const keep = profiles.find((row) => row.id === keepId);
    const duplicate = profiles.find((row) => row.id === duplicateId);
    if (!keep.shopId || keep.shopId !== duplicate.shopId) throw new Error("Profiles are not in the same shop");
    const canonicalId = normalize(keep.shopifyCustomerId);
    if (!canonicalId || canonicalId !== normalize(duplicate.shopifyCustomerId)) throw new Error("Profiles do not normalize to the same Shopify customer ID");

    const order = await tx.megaskaOrder.findUnique({ where: { id: orderId } });
    const review = await tx.reviewRequest.findUnique({ where: { id: reviewRequestId } });
    if (!order || order.customerProfileId !== duplicateId || order.shopId !== keep.shopId) throw new Error("Specified order is not owned by the duplicate profile/shop");
    if (!review || review.customerProfileId !== duplicateId || review.shopId !== keep.shopId) throw new Error("Specified review request is not owned by the duplicate profile/shop");
    await tx.megaskaOrder.update({ where: { id: orderId }, data: { customerProfileId: keepId } });
    await tx.reviewRequest.update({ where: { id: reviewRequestId }, data: { customerProfileId: keepId } });

    const foreignKeys = await tx.$queryRaw`
      SELECT tc.table_name AS "tableName", kcu.column_name AS "columnName"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'CustomerProfile' AND ccu.column_name = 'id'
    `;
    const remaining = [];
    for (const fk of foreignKeys) {
      const rows = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM ${quote(fk.tableName)} WHERE ${quote(fk.columnName)} = $1`, duplicateId);
      if (rows[0].count) remaining.push({ ...fk, count: rows[0].count });
    }
    if (remaining.length) throw new Error(`Duplicate still has references: ${JSON.stringify(remaining)}`);
    await tx.customerProfile.delete({ where: { id: duplicateId } });
    await tx.auditEvent.create({ data: { actorType: "system", eventType: "DEV_CUSTOMER_PROFILE_DUPLICATE_REPAIRED", entityType: "CustomerProfile", entityId: keepId, payload: { duplicateId, shopId: keep.shopId, canonicalShopifyCustomerId: canonicalId, orderId, reviewRequestId } } });
    return { status: "repaired", keepId, duplicateId };
  });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
