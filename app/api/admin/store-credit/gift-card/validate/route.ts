// TEMPORARY, TRIPLE-GUARDED validation endpoint (phase 2a). It mints a REAL Shopify
// gift card, so it is disabled unless GIFT_CARD_VALIDATION_ENABLED=true, requires a
// shared secret, caps the amount at ₹10, and is meant for the staging store only.
// Its only purpose is to confirm the gift-card Admin API calls (create + top-up +
// read) work end-to-end before the money-wiring phases. Remove once validated.
//
//   curl -X POST "$STAGING/api/admin/store-credit/gift-card/validate?shop=<store>.myshopify.com" \
//     -H "x-loopd2c-validation-secret: $GIFT_CARD_VALIDATION_SECRET" \
//     -H "content-type: application/json" \
//     -d '{"customerProfileId":"<id>","amountPaise":100}'
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "../../../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../../services/shopify/shop";
import { creditCustomerGiftCard, readCustomerGiftCard } from "../../../../../../services/store-credit/gift-card";

export const runtime = "nodejs";

const AMOUNT_CAP_PAISE = 1000; // ₹10 ceiling for a validation mint.

function timingSafeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function POST(req: NextRequest) {
  // Guard 1: off unless explicitly enabled (set only on staging).
  if (process.env.GIFT_CARD_VALIDATION_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }
  // Guard 2: shared secret (must be configured and non-trivial).
  const secret = String(process.env.GIFT_CARD_VALIDATION_SECRET || "").trim();
  const provided = String(req.headers.get("x-loopd2c-validation-secret") || "").trim();
  if (secret.length < 16 || !provided || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const resolved = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!resolved.id) return NextResponse.json({ ok: false, error: "unable to resolve shop" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const customerProfileId = String(body?.customerProfileId || "").trim();
  if (!customerProfileId) return NextResponse.json({ ok: false, error: "customerProfileId is required" }, { status: 400 });

  // Guard 3: amount cap.
  const amountPaise = Math.round(Number(body?.amountPaise ?? 100));
  if (!(amountPaise > 0) || amountPaise > AMOUNT_CAP_PAISE) {
    return NextResponse.json({ ok: false, error: `amountPaise must be between 1 and ${AMOUNT_CAP_PAISE} (₹10 validation cap)` }, { status: 400 });
  }

  // Tenant isolation: the customer must belong to the resolved shop.
  const customer = await prisma.customerProfile.findUnique({ where: { id: customerProfileId }, select: { id: true, shopId: true } });
  if (!customer || customer.shopId !== resolved.id) {
    return NextResponse.json({ ok: false, error: "customer not found for this shop" }, { status: 404 });
  }

  // Ensure a WalletAccount row exists so the gift-card service can attach to it.
  // No ledger entry is written - this only exercises the Shopify gift-card calls.
  await prisma.walletAccount.upsert({
    where: { shopId_customerProfileId_currency: { shopId: resolved.id, customerProfileId, currency: "INR" } },
    create: { shopId: resolved.id, customerProfileId, currency: "INR" },
    update: {},
  });

  try {
    const credit = await creditCustomerGiftCard({ shopId: resolved.id, shopDomain: resolved.shopDomain, customerProfileId, amountPaise, note: "gift-card validation" });
    const read = await readCustomerGiftCard({ shopId: resolved.id, shopDomain: resolved.shopDomain, customerProfileId });
    return NextResponse.json({ ok: true, amountPaise, credit, read });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
