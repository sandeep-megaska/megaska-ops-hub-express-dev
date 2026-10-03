import { NextRequest, NextResponse } from "next/server";
import { dispatchManualCheckoutRecovery } from "../../../../services/whatsapp/manual-recovery-dispatch";
import { runPrepaidCodRecovery } from "../../../../services/checkout-recovery/prepaid-cod-recovery.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron invokes this on a schedule (see vercel.json) and, when CRON_SECRET
// is set in the project, sends `Authorization: Bearer <CRON_SECRET>`. We fail
// closed if CRON_SECRET is not configured so the endpoint is never open.
function isAuthorizedCron(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  console.info("[CHECKOUT RECOVERY] cron_dispatch_started");
  try {
    const summary = await dispatchManualCheckoutRecovery();
    console.info("[CHECKOUT RECOVERY] cron_dispatch_completed", summary);
    // Native Shopify Checkout: offer COD to shoppers who abandoned a prepaid
    // checkout. Isolated so a failure here never affects the dispatch above.
    let prepaidCod: Awaited<ReturnType<typeof runPrepaidCodRecovery>> | { error: string };
    try {
      prepaidCod = await runPrepaidCodRecovery({});
      console.info("[CHECKOUT RECOVERY] prepaid_cod_completed", prepaidCod);
    } catch (error) {
      prepaidCod = { error: "Prepaid COD recovery failed." };
      console.error("[CHECKOUT RECOVERY] prepaid_cod_failed", { error: error instanceof Error ? error.message : String(error) });
    }
    return NextResponse.json({ ok: true, ...summary, prepaidCod }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[CHECKOUT RECOVERY] cron_dispatch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "Recovery dispatch failed." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
