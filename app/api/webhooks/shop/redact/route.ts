import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { normalizeShopDomain } from "../../../../../services/shopify/shop-resolver";
import { verifyShopifyWebhookHmac } from "../../../../../services/shopify/webhook-hmac";
import { redactAllCustomerProfilesForShop } from "../../../../../services/customers/customer-redaction";

export const runtime = "nodejs";

type ShopRedactPayload = {
  shop_id?: number | string;
  shop_domain?: string;
};

// Shopify's mandatory GDPR webhook, sent ~48 hours after app uninstall: erase
// all data for this shop. By this point the shop's access token is already
// revoked, so there is no order-metafield cleanup to attempt here (that path
// only exists in customers/redact, while the token is still valid) — this
// redacts what our own database still holds. Order, GST, and other financial
// records are intentionally retained rather than deleted, since Indian tax
// law requires retaining invoice/order records independent of the merchant's
// relationship with this app; only customer PII is erased.
export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();

  if (!verifyShopifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: ShopRedactPayload;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8")) as ShopRedactPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const shopDomain = normalizeShopDomain(payload.shop_domain || req.headers.get("x-shopify-shop-domain"));
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;

  if (!shop) {
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-shop" });
  }

  const redactResult = await redactAllCustomerProfilesForShop(shop.id);

  // Raw SQL avoids a generated-Prisma-client field mismatch for the encrypted
  // token columns (matches the pattern already used by app/uninstalled).
  await prisma.$executeRawUnsafe(
    `UPDATE "Shop"
     SET "accessToken" = NULL,
         "accessTokenEncrypted" = NULL,
         "storefrontAccessToken" = NULL,
         "storefrontTokenEncrypted" = NULL,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    shop.id
  );

  await prisma.auditEvent.create({
    data: {
      actorType: "system",
      eventType: "gdpr.shop.redact",
      entityType: "Shop",
      entityId: shop.id,
      payload: {
        shopDomain,
        redactedCustomerProfileCount: redactResult.count,
      },
    },
  });

  return NextResponse.json({ ok: true, shopDomain, redactedCustomerProfileCount: redactResult.count });
}
