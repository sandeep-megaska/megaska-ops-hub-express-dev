import { NextRequest, NextResponse } from "next/server";
import { listGstExports, prepareGstExport } from "../../../../services/gst/export";
import { getActiveGstSettings } from "../../../../services/gst/settings";
import { resolveGstAdminShopId } from "../../../../services/gst/request-shop";

export const runtime = "nodejs";

function mapPrepareErrorStatus(errorCode?: string): number {
  switch (errorCode) {
    case "INVALID_PERIOD":
      return 400;
    case "NO_DOCUMENTS_IN_PERIOD":
      return 404;
    case "UNSUPPORTED_DOCUMENT_STATES":
      return 422;
    case "EXPORT_BATCH_ALREADY_EXISTS":
      return 409;
    case "EXPORT_BATCH_PERSISTENCE_FAILED":
    case "EXPORT_BATCH_PREPARATION_FAILED":
      return 500;
    default:
      return 400;
  }
}

export async function GET(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) {
    return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });
  }

  const settings = await getActiveGstSettings({ shopId });
  if (!settings.ok || !settings.data) {
    return NextResponse.json({ ok: false, error: settings.error || "Active GST settings not found" }, { status: 404 });
  }

  const result = await listGstExports(settings.data.id);
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const exportsData = result.data;
  return NextResponse.json({ ok: true, exports: exportsData });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) {
    return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });
  }

  const settings = await getActiveGstSettings({ shopId });
  if (!settings.ok || !settings.data) {
    return NextResponse.json({ ok: false, error: settings.error || "Active GST settings not found" }, { status: 404 });
  }

  const periodStart = new Date(String(body.periodStart || ""));
  const periodEnd = new Date(String(body.periodEnd || ""));
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ ok: false, error: "periodStart and periodEnd are required ISO dates", errorCode: "INVALID_PERIOD" }, { status: 400 });
  }

  const result = await prepareGstExport({
    gstSettingsId: settings.data.id,
    exportType: body.exportType === "notes_register" ? "notes_register" : "invoice_register",
    periodStart,
    periodEnd,
    filters: body.filters && typeof body.filters === "object" ? (body.filters as Record<string, unknown>) : {},
  });

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        errorCode: result.errorCode,
        errorDetails: result.errorDetails,
      },
      { status: mapPrepareErrorStatus(result.errorCode) },
    );
  }

  const exportData = result.data;
  return NextResponse.json({ ok: true, export: exportData }, { status: 201 });
}
