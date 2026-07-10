import { NextResponse, type NextRequest } from "next/server";
import { getLoopDeskPromotionPublicationDiagnostics, publishLoopDeskPromotions } from "../../../../../services/loopdesk/discount-function-activation.server";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";
import { canonicalPublicationShopDomain } from "../../../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401 });

  try {
    const canonicalShopDomain = canonicalPublicationShopDomain(resolved.shop);
    const diagnostics = await getLoopDeskPromotionPublicationDiagnostics({ shopId: resolved.shop.id, shopDomain: canonicalShopDomain });
    return NextResponse.json(diagnostics, { status: diagnostics.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Publication diagnostics failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401 });

  try {
    const canonicalShopDomain = canonicalPublicationShopDomain(resolved.shop);
    const result = await publishLoopDeskPromotions({ shopId: resolved.shop.id, shopDomain: canonicalShopDomain });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Publication diagnostics failed." }, { status: 502 });
  }
}
