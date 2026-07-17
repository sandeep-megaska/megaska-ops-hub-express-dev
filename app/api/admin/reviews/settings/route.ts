import { NextRequest, NextResponse } from "next/server";
import { parseDisplaySettingsInput } from "../../../../../services/reviews/review-display-settings-input";
import { getReviewSettings, saveReviewSettings } from "../../../../../services/reviews/review-settings";
import { resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";

const headers = { "Cache-Control": "no-store" };

export { parseDisplaySettingsInput } from "../../../../../services/reviews/review-display-settings-input";

export function publicSettings(settings: Awaited<ReturnType<typeof getReviewSettings>>) {
  return {
    reviewsEnabled: settings.reviewsEnabled,
    automaticRequestsEnabled: settings.automaticRequestsEnabled,
    storefrontReviewsEnabled: settings.storefrontReviewsEnabled,
    showReviewSummary: settings.showReviewSummary,
    showRatingDistribution: settings.showRatingDistribution,
    showVerifiedPurchaseBadge: settings.showVerifiedPurchaseBadge,
    showReviewDates: settings.showReviewDates,
    showVariantTitle: settings.showVariantTitle,
    reviewsPerPage: settings.reviewsPerPage,
    defaultReviewSort: settings.defaultReviewSort,
  };
}

export async function GET(request: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: "Shop context unavailable." }, { status: 401, headers });
  return NextResponse.json({ ok: true, settings: publicSettings(await getReviewSettings(resolved.shop.id)) }, { headers });
}

export async function POST(request: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: "Shop context unavailable." }, { status: 401, headers });
  let input;
  try {
    input = parseDisplaySettingsInput(await request.json());
  } catch (error) {
    console.error("[REVIEW SETTINGS SAVE ERROR]", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ ok: false, error: "Invalid review display settings." }, { status: 400, headers });
  }

  try {
    const settings = await saveReviewSettings(resolved.shop.id, input);
    return NextResponse.json({ ok: true, settings: publicSettings(settings) }, { headers });
  } catch (error) {
    console.error("[REVIEW SETTINGS SAVE ERROR]", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ ok: false, error: "Could not save review settings." }, { status: 500, headers });
  }
}
