import { NextRequest, NextResponse } from "next/server";
import { backfillGiftCardsForExistingBalances } from "../../../../services/store-credit/gift-card-backfill";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-time migration trigger for projecting existing store-credit balances onto Shopify
// gift cards. Guarded by CRON_SECRET (fail-closed if unset) exactly like the scheduled
// crons, but intentionally NOT added to vercel.json's schedule - it is invoked on demand:
//
//   curl -X POST "$APP/api/cron/store-credit-gift-card-backfill?limit=200" \
//     -H "authorization: Bearer $CRON_SECRET"
//
// It is idempotent (only cardless, positive-balance accounts are selected), so re-running
// after a partial batch simply continues. Optional ?shopId= scopes it to one store.
function isAuthorized(req: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const shopId = url.searchParams.get("shopId")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") || 100);

  try {
    const summary = await backfillGiftCardsForExistingBalances({ shopId, limit });
    console.info("[STORE CREDIT BACKFILL] completed", {
      shopId: shopId || null,
      processed: summary.processed,
      created: summary.created,
      skipped: summary.skipped,
      failed: summary.failed,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[STORE CREDIT BACKFILL] failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false, error: "backfill failed" }, { status: 500 });
  }
}
