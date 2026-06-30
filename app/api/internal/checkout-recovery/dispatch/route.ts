import { NextRequest, NextResponse } from "next/server";
import { dispatchManualCheckoutRecovery } from "../../../../../services/whatsapp/manual-recovery-dispatch";

export const runtime = "nodejs";

function getDispatchSecret() {
  return String(
    process.env.INTERNAL_CHECKOUT_RECOVERY_DISPATCH_SECRET ||
      process.env.INTERNAL_DIAGNOSTIC_SECRET ||
      "",
  ).trim();
}

function isAuthorized(req: NextRequest) {
  const requiredSecret = getDispatchSecret();
  if (!requiredSecret) return false;
  return (
    req.headers.get("x-internal-secret") === requiredSecret ||
    req.headers.get("x-diagnostic-secret") === requiredSecret
  );
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  console.info("[CHECKOUT RECOVERY] manual_dispatch_started");

  try {
    const summary = await dispatchManualCheckoutRecovery();
    console.info("[CHECKOUT RECOVERY] manual_dispatch_completed", summary);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[CHECKOUT RECOVERY] manual_dispatch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "Manual checkout recovery dispatch failed" },
      { status: 500 },
    );
  }
}
