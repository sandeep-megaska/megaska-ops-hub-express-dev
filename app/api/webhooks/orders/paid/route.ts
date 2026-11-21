import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { normalizeShopDomain } from "../../../../../services/shopify/shop-resolver";
import { verifyShopifyWebhookHmac } from "../../../../../services/shopify/webhook-hmac";
import { FEE_REF_ATTRIBUTE } from "../../../../../services/exchange/shopify-fee-invoice";
import { markShopifyChargePaid } from "../../../../../services/exchange/request-payment-paid";

export const runtime = "nodejs";

type PaidOrderPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  financial_status?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
  processed_at?: string;
};

// orders/paid: an exchange charge (reverse pickup charge or style price difference)
// paid on the Shopify invoice LoopD2C sent. Matched by the order's
// `loopd2c_payment_ref` attribute, which the draft order carried; every other
// order is ignored here.
export async function POST(req: NextRequest) {
  const rawBuffer = Buffer.from(await req.arrayBuffer());
  const hmacHeader = String(req.headers.get("x-shopify-hmac-sha256") || "").trim();
  if (!verifyShopifyWebhookHmac(rawBuffer, hmacHeader)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: PaidOrderPayload;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8")) as PaidOrderPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const referenceId = String((payload.note_attributes || []).find((attribute) => attribute?.name === FEE_REF_ATTRIBUTE)?.value || "").trim();
  if (!referenceId) return NextResponse.json({ ok: true, ignored: true });

  const shopDomain = normalizeShopDomain(req.headers.get("x-shopify-shop-domain"));
  const shop = shopDomain ? await prisma.shop.findFirst({ where: { shopDomain }, select: { id: true } }) : null;
  if (!shop) return NextResponse.json({ ok: true, ignored: true, reason: "unknown_shop" });

  const shopifyOrderId = String(payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Order/${payload.id}` : ""));
  const paidAt = payload.processed_at ? new Date(payload.processed_at) : undefined;
  const outcome = await markShopifyChargePaid({ shopId: shop.id, referenceId, shopifyOrderId, paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined });
  if (!outcome.handled) return NextResponse.json({ ok: true, ignored: true, reason: outcome.reason });

  // Notifications and the Delhivery booking run after Shopify gets its 200.
  after(() => outcome.followUp().catch((error) => console.error("[EXCHANGE CHARGE PAID] follow-up failed", { requestId: outcome.requestId, error: error instanceof Error ? error.message : String(error) })));
  return NextResponse.json({ ok: true, purpose: outcome.purpose });
}
