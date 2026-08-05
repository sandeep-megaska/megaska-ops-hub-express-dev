import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { redactOrderMegaskaIdentityMetafields } from "../../../../services/shopify/admin";
import { normalizeShopDomain } from "../../../../services/shopify/shop-resolver";
import { verifyShopifyWebhookHmac } from "../../../../services/shopify/webhook-hmac";
import {
  findCustomerProfilesForRedaction,
  hasUnmatchablePhoneIdentifier,
  redactAllCustomerProfilesForShop,
  redactAllCustomerRelatedDataForShop,
  redactCustomerProfiles,
  redactCustomerRelatedData,
} from "../../../../services/customers/customer-redaction";

export const runtime = "nodejs";

// Shopify requires all three mandatory GDPR compliance topics to share a
// single webhook subscription (declared via `compliance_topics`, not
// `topics`, in shopify.app.toml) — separate subscriptions per compliance
// topic are rejected at deploy time. This route dispatches on the
// x-shopify-topic header instead.

type CustomerIdentifiers = { shopifyCustomerId: string | null; email: string | null; phone: string | null };

type CustomersDataRequestPayload = {
  shop_domain?: string;
  orders_requested?: Array<number | string>;
  customer?: { id?: number | string; email?: string; phone?: string };
  data_request?: { id?: number | string };
};

type CustomersRedactPayload = {
  shop_domain?: string;
  customer?: { id?: number | string; email?: string; phone?: string };
  orders_to_redact?: Array<number | string>;
};

type ShopRedactPayload = {
  shop_domain?: string;
};

function toIdentifiers(customer: { id?: number | string; email?: string; phone?: string } | undefined): CustomerIdentifiers {
  return {
    shopifyCustomerId: customer?.id != null ? String(customer.id) : null,
    email: customer?.email || null,
    phone: customer?.phone || null,
  };
}

// A merchant or customer requested a copy of the customer's stored data.
// Compiling and delivering that report is a manual, support-assisted process
// (Shopify allows up to 30 days); this handler's job is to verify,
// acknowledge quickly, and leave a compliance trail that identifies exactly
// which stored records the request covers.
async function handleCustomersDataRequest(rawBody: string, shopDomainHeader: string | null) {
  const payload = JSON.parse(rawBody) as CustomersDataRequestPayload;
  const shopDomain = normalizeShopDomain(payload.shop_domain || shopDomainHeader);
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;

  const identifiers = toIdentifiers(payload.customer);
  const matchedProfiles = shop ? await findCustomerProfilesForRedaction(shop.id, identifiers) : [];

  await prisma.auditEvent.create({
    data: {
      actorType: "system",
      eventType: "gdpr.customers.data_request",
      entityType: "Shop",
      entityId: shop?.id ?? null,
      payload: {
        shopDomain,
        dataRequestId: payload.data_request?.id != null ? String(payload.data_request.id) : null,
        ordersRequested: (payload.orders_requested || []).map((id) => String(id)),
        customerIdentifiers: identifiers,
        matchedCustomerProfileIds: matchedProfiles.map((profile) => profile.id),
        phoneMatchSkipped: hasUnmatchablePhoneIdentifier(identifiers),
        note: "Compile and deliver the requested data to the merchant/customer within Shopify's required window. This audit record is the compliance trail for that manual step.",
      },
    },
  });

  return NextResponse.json({ ok: true, received: true });
}

// Erase this customer's data. Redacts the CustomerProfile PII stored
// directly, and best-effort clears the PII-bearing order metafields written
// onto Shopify orders (services/shopify/admin.ts), for the orders Shopify
// says are now eligible for redaction.
async function handleCustomersRedact(rawBody: string, shopDomainHeader: string | null) {
  const payload = JSON.parse(rawBody) as CustomersRedactPayload;
  const shopDomain = normalizeShopDomain(payload.shop_domain || shopDomainHeader);
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;

  if (!shop) {
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-shop" });
  }

  const identifiers = toIdentifiers(payload.customer);
  const matchedProfiles = await findCustomerProfilesForRedaction(shop.id, identifiers);
  const redactResult = await redactCustomerProfiles(shop.id, matchedProfiles.map((profile) => profile.id));
  // matchedProfiles still hold the original phone/email in memory (updateMany
  // above does not mutate them), which the phone/email-keyed downstream tables need.
  const relatedRedactionCounts = await redactCustomerRelatedData(
    matchedProfiles.map((profile) => ({ id: profile.id, phoneE164: profile.phoneE164, email: profile.email })),
  );

  const orderIds = (payload.orders_to_redact || []).map((id) => String(id).trim()).filter(Boolean);
  const orderMetafieldResults: Array<{ orderId: string; ok: boolean; error?: string }> = [];

  for (const orderId of orderIds) {
    try {
      const result = await redactOrderMegaskaIdentityMetafields(orderId, { shopDomain });
      orderMetafieldResults.push({ orderId, ok: result.userErrors.length === 0, error: result.userErrors[0]?.message });
    } catch (error) {
      orderMetafieldResults.push({ orderId, ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  await prisma.auditEvent.create({
    data: {
      actorType: "system",
      eventType: "gdpr.customers.redact",
      entityType: "Shop",
      entityId: shop.id,
      payload: {
        shopDomain,
        customerIdentifiers: identifiers,
        redactedCustomerProfileIds: matchedProfiles.map((profile) => profile.id),
        redactedCustomerProfileCount: redactResult.count,
        relatedRedactionCounts,
        phoneMatchSkipped: hasUnmatchablePhoneIdentifier(identifiers),
        ordersToRedact: orderIds,
        orderMetafieldResults,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    shopDomain,
    redactedCustomerProfileCount: redactResult.count,
    relatedRedactionCounts,
    orderMetafieldResults,
  });
}

// Fires ~48 hours after app uninstall, once the shop's access token is
// already revoked — erases all customer PII we hold for the shop and clears
// stored credentials. Order, GST, and other financial records are
// intentionally retained rather than deleted, since Indian tax law requires
// retaining invoice/order records independent of the merchant's relationship
// with this app.
async function handleShopRedact(rawBody: string, shopDomainHeader: string | null) {
  const payload = JSON.parse(rawBody) as ShopRedactPayload;
  const shopDomain = normalizeShopDomain(payload.shop_domain || shopDomainHeader);
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;

  if (!shop) {
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-shop" });
  }

  const redactResult = await redactAllCustomerProfilesForShop(shop.id);
  const relatedRedactionCounts = await redactAllCustomerRelatedDataForShop(shop.id);

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
        relatedRedactionCounts,
      },
    },
  });

  return NextResponse.json({ ok: true, shopDomain, redactedCustomerProfileCount: redactResult.count, relatedRedactionCounts });
}

export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();

  if (!verifyShopifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  const rawBody = rawBuffer.toString("utf8");
  const topic = String(req.headers.get("x-shopify-topic") || "").trim();
  const shopDomainHeader = req.headers.get("x-shopify-shop-domain");

  try {
    switch (topic) {
      case "customers/data_request":
        return await handleCustomersDataRequest(rawBody, shopDomainHeader);
      case "customers/redact":
        return await handleCustomersRedact(rawBody, shopDomainHeader);
      case "shop/redact":
        return await handleShopRedact(rawBody, shopDomainHeader);
      default:
        return NextResponse.json({ ok: false, error: `Unrecognized compliance topic: ${topic}` }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
}
