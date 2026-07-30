import { NextRequest, NextResponse } from "next/server";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";
import { importReviews } from "../../../../../services/reviews/review-import";
import { REVIEW_IMPORT_PLATFORMS, type ReviewImportPlatform } from "../../../../../services/reviews/review-import-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guardrails: CSV is passed as a JSON string (no multipart), so cap the payload.
const MAX_CSV_CHARS = 8_000_000;
const ALLOWED_DEFAULT_STATUS = new Set(["PUBLISHED", "PENDING_MODERATION", "HIDDEN", "REJECTED", "DRAFT"]);

// POST /api/admin/reviews/import?shop=<domain>
// Body: { csv: string, platform?, dryRun?: boolean, defaultStatus?, defaultVerified?: boolean }
// dryRun validates + counts without writing. Tenant-scoped, fail-closed.
export async function POST(req: NextRequest) {
  const context = await resolveAdminShopFromRequest(req);
  if (!context.shop?.id) {
    return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(context) }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) {
    return NextResponse.json({ ok: false, error: "A non-empty csv string is required." }, { status: 400 });
  }
  if (csv.length > MAX_CSV_CHARS) {
    return NextResponse.json({ ok: false, error: "CSV is too large (max 8 MB)." }, { status: 413 });
  }

  const platformRaw = String(body.platform || "generic");
  const platform: ReviewImportPlatform = (REVIEW_IMPORT_PLATFORMS as string[]).includes(platformRaw)
    ? (platformRaw as ReviewImportPlatform)
    : "generic";
  const defaultStatus = ALLOWED_DEFAULT_STATUS.has(String(body.defaultStatus)) ? String(body.defaultStatus) : "PUBLISHED";
  const dryRun = body.dryRun === true;
  const defaultVerified = body.defaultVerified === true;

  try {
    const data = await importReviews({ shopId: context.shop.id, csv, platform, dryRun, defaultStatus, defaultVerified });
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to import reviews." },
      { status: 500 },
    );
  }
}
