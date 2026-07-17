import { NextRequest, NextResponse } from "next/server";
import { parseDisplaySettingsInput } from "../../../../../services/reviews/review-display-settings-input";
import { getReviewSettings, saveReviewSettings } from "../../../../../services/reviews/review-settings";
import { resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";

const headers = { "Cache-Control": "no-store" };

export { parseDisplaySettingsInput } from "../../../../../services/reviews/review-display-settings-input";

function publicSettings(settings: Awaited<ReturnType<typeof getReviewSettings>>) {
  const safeSettings = { ...settings };
  delete safeSettings.shopId;
  return safeSettings;
}

export async function GET(request: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: "Shop context unavailable." }, { status: 401, headers });
  return NextResponse.json({ ok: true, settings: publicSettings(await getReviewSettings(resolved.shop.id)) }, { headers });
}

export async function POST(request: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: "Shop context unavailable." }, { status: 401, headers });
  try {
    const input = parseDisplaySettingsInput(await request.json());
    return NextResponse.json({ ok: true, settings: publicSettings(await saveReviewSettings(resolved.shop.id, input)) }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid review display settings." }, { status: 400, headers });
  }
}
