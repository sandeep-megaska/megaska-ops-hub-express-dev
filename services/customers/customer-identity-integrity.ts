export type IdentityIntegrityViolation = {
  check: string;
  count: number;
  sampleIds: string[];
};

type QueryClient = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

type Check = { name: string; sql: string };

// Every query is tenant-scoped and returns only record identifiers. This keeps the
// verifier safe to include in UAT evidence without exposing customer PII.
const CHECKS: Check[] = [
  {
    name: "duplicate_shopify_identity",
    sql: `SELECT array_agg(id ORDER BY id)::text[] AS ids FROM "CustomerProfile"
      WHERE "shopId" = $1 AND "shopifyCustomerId" IS NOT NULL
      GROUP BY "shopifyCustomerId" HAVING count(*) > 1`,
  },
  {
    name: "duplicate_verified_phone_identity",
    sql: `SELECT array_agg(id ORDER BY id)::text[] AS ids FROM "CustomerProfile"
      WHERE "shopId" = $1 AND "phoneE164" IS NOT NULL AND "phoneVerifiedAt" IS NOT NULL
      GROUP BY "phoneE164" HAVING count(*) > 1`,
  },
  {
    name: "noncanonical_profile_identity",
    sql: `SELECT ARRAY[id]::text[] AS ids FROM "CustomerProfile" WHERE "shopId" = $1 AND (
      ("phoneE164" IS NOT NULL AND "phoneE164" !~ '^\\+[1-9][0-9]{7,14}$') OR
      ("email" IS NOT NULL AND ("email" <> lower(btrim("email")) OR "email" ~ '\\s')) OR
      ("shopifyCustomerId" IS NOT NULL AND "shopifyCustomerId" !~ '^[0-9]+$'))`,
  },
  {
    name: "session_owner_retired",
    sql: `SELECT ARRAY(s.id)::text[] AS ids FROM "AuthSession" s JOIN "CustomerIdentityMerge" m
      ON m."sourceCustomerProfileId"=s."customerProfileId" WHERE m."shopId"=$1`,
  },
  {
    name: "order_owner_mismatch",
    sql: `SELECT ARRAY(o.id)::text[] AS ids FROM "MegaskaOrder" o JOIN "CustomerProfile" p ON p.id=o."customerProfileId"
      WHERE o."shopId"=$1 AND p."shopId" IS DISTINCT FROM o."shopId"`,
  },
  {
    name: "order_request_owner_mismatch",
    sql: `SELECT ARRAY(r.id)::text[] AS ids FROM "OrderActionRequest" r
      LEFT JOIN "MegaskaOrder" o ON o.id=r."megaskaOrderId" JOIN "CustomerProfile" p ON p.id=r."customerProfileId"
      WHERE r."shopId"=$1 AND (p."shopId" IS DISTINCT FROM r."shopId" OR (o.id IS NOT NULL AND o."customerProfileId"<>r."customerProfileId"))`,
  },
  {
    name: "review_request_owner_mismatch",
    sql: `SELECT ARRAY(r.id)::text[] AS ids FROM "ReviewRequest" r JOIN "MegaskaOrder" o ON o.id=r."megaskaOrderId"
      JOIN "CustomerProfile" p ON p.id=r."customerProfileId" WHERE r."shopId"=$1 AND
      (p."shopId" IS DISTINCT FROM r."shopId" OR o."shopId"<>r."shopId" OR o."customerProfileId"<>r."customerProfileId")`,
  },
  {
    name: "review_owner_mismatch",
    sql: `SELECT ARRAY(v.id)::text[] AS ids FROM "ProductReview" v
      LEFT JOIN "ReviewRequest" r ON r.id=v."reviewRequestId" LEFT JOIN "MegaskaOrder" o ON o.id=v."megaskaOrderId"
      LEFT JOIN "CustomerProfile" p ON p.id=v."customerProfileId" WHERE v."shopId"=$1 AND
      (v."customerProfileId" IS NULL OR p."shopId" IS DISTINCT FROM v."shopId" OR
       (r.id IS NOT NULL AND r."customerProfileId"<>v."customerProfileId") OR
       (o.id IS NOT NULL AND o."customerProfileId"<>v."customerProfileId"))`,
  },
  {
    name: "wallet_owner_or_balance_mismatch",
    sql: `SELECT ARRAY(a.id)::text[] AS ids FROM "WalletAccount" a JOIN "CustomerProfile" p ON p.id=a."customerProfileId"
      LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN t.direction='CREDIT' THEN t.amount ELSE -t.amount END),0)::int balance,
        bool_or(t."customerProfileId"<>a."customerProfileId" OR t."shopId"<>a."shopId" OR t.currency<>a.currency) bad
        FROM "WalletTransaction" t WHERE t."walletAccountId"=a.id) ledger ON true
      WHERE a."shopId"=$1 AND (p."shopId" IS DISTINCT FROM a."shopId" OR ledger.bad IS TRUE OR ledger.balance<>a."currentBalance")`,
  },
  {
    name: "wallet_reservation_owner_mismatch",
    sql: `SELECT ARRAY(r.id)::text[] AS ids FROM "WalletReservation" r JOIN "WalletAccount" a ON a.id=r."walletAccountId"
      WHERE a."shopId"=$1 AND (r."customerProfileId"<>a."customerProfileId" OR r.currency<>a.currency OR r."shopId" IS DISTINCT FROM a."shopId")`,
  },
  {
    name: "refund_owner_mismatch",
    sql: `SELECT ARRAY(r.id)::text[] AS ids FROM "RefundRequest" r LEFT JOIN "CustomerProfile" p ON p.id=r."customerProfileId"
      LEFT JOIN "OrderActionRequest" a ON a.id=r."orderActionRequestId" LEFT JOIN "WalletTransaction" t ON t.id=r."walletTransactionId"
      WHERE r."shopId"=$1 AND (r."customerProfileId" IS NULL OR p."shopId" IS DISTINCT FROM r."shopId" OR
        (a.id IS NOT NULL AND a."customerProfileId"<>r."customerProfileId") OR (t.id IS NOT NULL AND t."customerProfileId"<>r."customerProfileId"))`,
  },
  {
    name: "checkout_owner_mismatch",
    sql: `SELECT ARRAY(i.id)::text[] AS ids FROM "ExpressCheckoutIntent" i LEFT JOIN "CustomerProfile" p ON p.id=i."customerProfileId"
      WHERE i."shopId"=$1 AND i."customerProfileId" IS NOT NULL AND p."shopId" IS DISTINCT FROM i."shopId"`,
  },
  {
    name: "checkout_dependent_owner_mismatch",
    sql: `SELECT ARRAY(x.id)::text[] AS ids FROM (
      SELECT a.id,a."shopId",a."customerProfileId",i."shopId" parent_shop,i."customerProfileId" parent_profile FROM "ExpressCheckoutAddressSnapshot" a JOIN "ExpressCheckoutIntent" i ON i.id=a."intentId"
      UNION ALL SELECT r.id,r."shopId",r."customerProfileId",i."shopId",i."customerProfileId" FROM "CheckoutRecoveryToken" r JOIN "ExpressCheckoutIntent" i ON i.id=r."checkoutIntentId"
      ) x WHERE x.parent_shop=$1 AND (x."shopId"<>x.parent_shop OR (x."customerProfileId" IS NOT NULL AND x."customerProfileId" IS DISTINCT FROM x.parent_profile))`,
  },
  {
    name: "cod_intent_owner_mismatch",
    sql: `SELECT ARRAY(i.id)::text[] AS ids FROM "CodAdvanceIntent" i LEFT JOIN "CustomerProfile" p ON p.id=i."customerProfileId"
      WHERE i."shopId"=$1 AND i."customerProfileId" IS NOT NULL AND p."shopId" IS DISTINCT FROM i."shopId"`,
  },
];

export async function verifyCustomerIdentityIntegrity(db: QueryClient, shopId: string): Promise<IdentityIntegrityViolation[]> {
  const normalizedShopId = shopId.trim();
  if (!normalizedShopId) throw new Error("shopId is required; cross-tenant verification is prohibited");

  const violations: IdentityIntegrityViolation[] = [];
  for (const check of CHECKS) {
    const rows = await db.$queryRawUnsafe<Array<{ ids: string[] }>>(check.sql, normalizedShopId);
    const ids = rows.flatMap((row) => row.ids).sort();
    if (ids.length) violations.push({ check: check.name, count: ids.length, sampleIds: ids.slice(0, 20) });
  }
  return violations;
}

export const CUSTOMER_IDENTITY_INTEGRITY_CHECK_NAMES = CHECKS.map(({ name }) => name);
