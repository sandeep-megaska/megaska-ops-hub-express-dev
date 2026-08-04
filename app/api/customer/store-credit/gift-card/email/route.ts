import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { getAuthenticatedExchangeCustomer } from "../../../../../../services/exchange/auth";
import { readCustomerGiftCard } from "../../../../../../services/store-credit/gift-card";
import { sendGiftCardCodeEmail } from "../../../../../../services/notifications/store-credit";

export const runtime = "nodejs";

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "your email";
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Self-serve "email me my code": delivers the authenticated customer's store-credit gift
// card code to the email on their profile. Optional convenience on top of the on-screen
// code; returns { ok:false, reason } (not an error) when there is no card yet or no email
// on file, so the dashboard can show a friendly message.
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedExchangeCustomer(req);
    if (!auth) {
      return withCors(req, NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }));
    }

    const shopDomain = auth.shop.myshopifyDomain || auth.shop.shopDomain;
    const card = await readCustomerGiftCard({
      shopId: auth.shop.id,
      shopDomain,
      customerProfileId: auth.session.customer.id,
      currency: "INR",
    });
    if (!card.ok || !card.present || !card.code) {
      return withCors(req, NextResponse.json({ ok: false, reason: "no_store_credit_code" }));
    }

    const email = auth.session.customer.email;
    if (!email) {
      return withCors(req, NextResponse.json({ ok: false, reason: "no_email_on_file" }));
    }

    const sent = await sendGiftCardCodeEmail({
      shopId: auth.shop.id,
      customerEmail: email,
      customerName: auth.session.customer.fullName || auth.session.customer.firstName,
      code: card.code,
      balanceMinor: card.balancePaise,
      currency: "INR",
    });

    if (sent.skipped) {
      return withCors(req, NextResponse.json({ ok: false, reason: sent.reason }));
    }
    if (!sent.success) {
      return withCors(req, NextResponse.json({ ok: false, reason: "send_failed" }));
    }

    return withCors(req, NextResponse.json({ ok: true, emailedTo: maskEmail(email) }));
  } catch (error) {
    console.error("[STORE CREDIT] customer_gift_card_email_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return withCors(req, NextResponse.json({ ok: false, error: "Unable to email your code right now." }, { status: 500 }));
  }
}
