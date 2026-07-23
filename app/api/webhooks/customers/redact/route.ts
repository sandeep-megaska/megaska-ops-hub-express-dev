import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { redactOrderMegaskaIdentityMetafields } from "../../../../../services/shopify/admin";
import { normalizeShopDomain } from "../../../../../services/shopify/shop-resolver";
import { verifyShopifyWebhookHmac } from "../../../../../services/shopify/webhook-hmac";
import { findCustomerProfilesForRedaction, hasUnmatchablePhoneIdentifier, redactCustomerProfiles } from "../../../../../services/customers/customer-redaction";

export const runtime = "nodejs";

type CustomersRedactPayload = {
  shop_id?: number | string;
  shop_domain?: string;
  customer?: { id?: number | string; email?: string; phone?: string };
  orders_to_redact?: Array<number | string>;
};

type OrderRedactionResult = { orderId: string; ok: boolean; error?: string };

// Shopify's mandatory GDPR webhook: erase this customer's data. We redact the
// CustomerProfile PII we store directly, and best-effort clear the PII-bearing
// order metafields we wrote (services/shopify/admin.ts writes phone/email
// onto orders) for the orders Shopify says are now eligible for redaction.
export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();

  if (!verifyShopifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: CustomersRedactPayload;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8")) as CustomersRedactPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const shopDomain = normalizeShopDomain(payload.shop_domain || req.headers.get("x-shopify-shop-domain"));
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;

  if (!shop) {
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-shop" });
  }

  const identifiers = {
    shopifyCustomerId: payload.customer?.id != null ? String(payload.customer.id) : null,
    email: payload.customer?.email || null,
    phone: payload.customer?.phone || null,
  };

  const matchedProfiles = await findCustomerProfilesForRedaction(shop.id, identifiers);
  const redactResult = await redactCustomerProfiles(shop.id, matchedProfiles.map((profile) => profile.id));

  const orderIds = (payload.orders_to_redact || []).map((id) => String(id).trim()).filter(Boolean);
  const orderMetafieldResults: OrderRedactionResult[] = [];

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
    orderMetafieldResults,
  });
}
