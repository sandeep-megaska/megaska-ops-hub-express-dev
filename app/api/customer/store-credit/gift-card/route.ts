import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { getAuthenticatedExchangeCustomer } from "../../../../../services/exchange/auth";
import { readCustomerGiftCard } from "../../../../../services/store-credit/gift-card";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Returns the authenticated customer's store-credit gift card - the code they enter at
// native checkout plus its live balance (read from Shopify, so it reflects any partial
// redemptions). Only the card's owner can read it; the code is theirs to spend. On any
// failure (no card yet, Shopify unreachable) it degrades to { present: false } so the
// rest of the dashboard still renders.
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedExchangeCustomer(req);
    if (!auth) {
      return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    const shopDomain = auth.shop.myshopifyDomain || auth.shop.shopDomain;
    const card = await readCustomerGiftCard({
      shopId: auth.shop.id,
      shopDomain,
      customerProfileId: auth.session.customer.id,
      currency: "INR",
    });

    if (!card.ok || !card.present) {
      return withCors(req, NextResponse.json({ present: false }));
    }

    return withCors(
      req,
      NextResponse.json({
        present: true,
        last4: card.last4,
        code: card.code,
        balancePaise: card.balancePaise,
        balance: Number((card.balancePaise / 100).toFixed(2)),
        currency: "INR",
      }),
    );
  } catch (error) {
    console.error("[STORE CREDIT] customer_gift_card_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return withCors(req, NextResponse.json({ present: false }));
  }
}
