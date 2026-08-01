import { prisma } from "../db/prisma";
import { comparison, type AnalyticsRange } from "../reviews/review-analytics-date-range";

function serializeRange(r: AnalyticsRange) {
  return { start: r.start.toISOString(), end: r.end.toISOString(), timezone: r.timezone, label: r.label };
}

async function scalar(query: Promise<Array<{ n: bigint | number }>>): Promise<number> {
  const rows = await query;
  return rows.length ? Number(rows[0].n) : 0;
}

// One window's login/customer metrics. verifiedAt (not the status string) is the
// authoritative "a login happened" signal, tolerant of status-vocabulary drift.
async function windowMetrics(shopId: string, start: Date, end: Date) {
  const [logins, uniqueCustomers, newCustomers, purchasers, identifiedCheckouts, guestCheckouts] = await Promise.all([
    scalar(prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS n FROM "OTPChallenge"
      WHERE "shopId" = ${shopId} AND "verifiedAt" >= ${start} AND "verifiedAt" <= ${end}`),
    scalar(prisma.$queryRaw`
      SELECT COUNT(DISTINCT "customerProfileId")::bigint AS n FROM "OTPChallenge"
      WHERE "shopId" = ${shopId} AND "verifiedAt" >= ${start} AND "verifiedAt" <= ${end}
        AND "customerProfileId" IS NOT NULL`),
    scalar(prisma.$queryRaw`
      SELECT COUNT(DISTINCT o."customerProfileId")::bigint AS n
      FROM "OTPChallenge" o JOIN "CustomerProfile" c ON c."id" = o."customerProfileId"
      WHERE o."shopId" = ${shopId} AND o."verifiedAt" >= ${start} AND o."verifiedAt" <= ${end}
        AND c."createdAt" >= ${start}`),
    scalar(prisma.$queryRaw`
      SELECT COUNT(DISTINCT o."customerProfileId")::bigint AS n
      FROM "OTPChallenge" o
      WHERE o."shopId" = ${shopId} AND o."verifiedAt" >= ${start} AND o."verifiedAt" <= ${end}
        AND o."customerProfileId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "MegaskaOrder" m
          WHERE m."customerProfileId" = o."customerProfileId" AND m."shopId" = o."shopId"
            AND m."orderPlacedAt" >= ${start} AND m."orderPlacedAt" <= ${end}
        )`),
    scalar(prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS n FROM "ExpressCheckoutIntent"
      WHERE "shopId" = ${shopId} AND "createdAt" >= ${start} AND "createdAt" <= ${end}
        AND "customerProfileId" IS NOT NULL`),
    scalar(prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS n FROM "ExpressCheckoutIntent"
      WHERE "shopId" = ${shopId} AND "createdAt" >= ${start} AND "createdAt" <= ${end}
        AND "customerProfileId" IS NULL`),
  ]);
  return { logins, uniqueCustomers, newCustomers, purchasers, identifiedCheckouts, guestCheckouts };
}

/**
 * OTP-login and customer analytics — who signed in by mobile, new vs returning,
 * how many went on to purchase, and how much of checkout is identified vs guest.
 * This is uniquely answerable here because the app owns the OTP identity that
 * Shopify's storefront analytics never sees.
 */
export async function getLoginAnalytics(shopId: string, r: AnalyticsRange) {
  const [now, prev] = await Promise.all([
    windowMetrics(shopId, r.start, r.end),
    windowMetrics(shopId, r.comparisonStart, r.comparisonEnd),
  ]);

  const returning = Math.max(0, now.uniqueCustomers - now.newCustomers);
  const prevReturning = Math.max(0, prev.uniqueCustomers - prev.newCustomers);
  const totalCheckouts = now.identifiedCheckouts + now.guestCheckouts;

  return {
    range: serializeRange(r),
    metrics: {
      verifiedLogins: comparison(now.logins, prev.logins),
      uniqueCustomers: comparison(now.uniqueCustomers, prev.uniqueCustomers),
      newCustomers: comparison(now.newCustomers, prev.newCustomers),
      returningCustomers: comparison(returning, prevReturning),
      loginToPurchaseRate: comparison(
        now.uniqueCustomers ? now.purchasers / now.uniqueCustomers : 0,
        prev.uniqueCustomers ? prev.purchasers / prev.uniqueCustomers : 0,
      ),
      identifiedCheckoutRate: comparison(
        totalCheckouts ? now.identifiedCheckouts / totalCheckouts : 0,
        prev.identifiedCheckouts + prev.guestCheckouts
          ? prev.identifiedCheckouts / (prev.identifiedCheckouts + prev.guestCheckouts)
          : 0,
      ),
    },
    breakdown: {
      newVsReturning: [
        { key: "new", label: "New customers", count: now.newCustomers },
        { key: "returning", label: "Returning customers", count: returning },
      ],
      checkoutIdentity: [
        { key: "identified", label: "Signed in", count: now.identifiedCheckouts },
        { key: "guest", label: "Guest", count: now.guestCheckouts },
      ],
    },
  };
}
