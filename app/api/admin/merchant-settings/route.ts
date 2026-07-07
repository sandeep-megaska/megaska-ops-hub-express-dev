import { NextRequest, NextResponse } from "next/server";
import {
  getLoopDeskMerchantSettings,
  updateLoopDeskMerchantSettings,
} from "../../../../services/loopdesk/merchant-settings";
import { resolveAdminShopFromRequest } from "../../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function shop(req: NextRequest) {
  return resolveAdminShopFromRequest(req);
}

export async function GET(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.shop?.id)
    return NextResponse.json(
      { ok: false, error: resolved.error || "Unable to resolve shop" },
      { status: 400 },
    );
  const settings = await getLoopDeskMerchantSettings(resolved.shop.id);
  return NextResponse.json(
    { ok: true, settings, shopDomain: resolved.shop.shopDomain },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.shop?.id)
    return NextResponse.json(
      { ok: false, error: resolved.error || "Unable to resolve shop" },
      { status: 400 },
    );
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body)
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload" },
      { status: 400 },
    );
  try {
    const settings = await updateLoopDeskMerchantSettings(resolved.shop.id, body);
    return NextResponse.json(
      { ok: true, settings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Invalid settings payload",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
