import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { normalizeShopDomain } from "../../../../../services/shopify/shop-resolver";
import { verifyShopifyWebhookHmac } from "../../../../../services/shopify/webhook-hmac";
import { findCustomerProfilesForRedaction, hasUnmatchablePhoneIdentifier } from "../../../../../services/customers/customer-redaction";

export const runtime = "nodejs";

type CustomersDataRequestPayload = {
  shop_id?: number | string;
  shop_domain?: string;
  orders_requested?: Array<number | string>;
  customer?: { id?: number | string; email?: string; phone?: string };
  data_request?: { id?: number | string };
};

// Shopify's mandatory GDPR webhook: a merchant or customer requested a copy
// of the customer's stored data. Compiling and delivering that report is a
// manual, support-assisted process (Shopify allows up to 30 days); this
// handler's job is to verify, acknowledge quickly, and leave a compliance
// trail that identifies exactly which stored records the request covers.
export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();

  if (!verifyShopifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: CustomersDataRequestPayload;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8")) as CustomersDataRequestPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const shopDomain = normalizeShopDomain(payload.shop_domain || req.headers.get("x-shopify-shop-domain"));
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;

  const identifiers = {
    shopifyCustomerId: payload.customer?.id != null ? String(payload.customer.id) : null,
    email: payload.customer?.email || null,
    phone: payload.customer?.phone || null,
  };

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
