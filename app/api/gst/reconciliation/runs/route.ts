import { NextRequest, NextResponse } from "next/server";
import { GST_DEFAULT_SOURCE_SYSTEM } from "../../../../../services/gst/constants";
import { createGstReconciliationRun } from "../../../../../services/gst/reconcile";
import { getActiveGstSettings } from "../../../../../services/gst/settings";
import { resolveGstAdminShopId } from "../../../../../services/gst/request-shop";
import { gstDb } from "../../../../../services/gst/db";

export const runtime = "nodejs";

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
    return NextResponse.json({ ok: false, error: "periodStart and periodEnd are required ISO dates" }, { status: 400 });
  }

  const sourceDocuments = Array.isArray(body.sourceDocuments)
    ? body.sourceDocuments.map((doc) => {
        const safe = (doc || {}) as Record<string, unknown>;
        return {
          documentNumber: String(safe.documentNumber || ""),
          documentType: safe.documentType ? String(safe.documentType) : undefined,
          documentDate: safe.documentDate ? String(safe.documentDate) : undefined,
          totalAmount: safe.totalAmount ? Number(safe.totalAmount) : undefined,
          status: safe.status ? String(safe.status) : undefined,
        };
      })
    : [];

  const result = await createGstReconciliationRun({
    gstSettingsId: settings.data.id,
    periodStart,
    periodEnd,
    sourceSystem: String(body.sourceSystem || GST_DEFAULT_SOURCE_SYSTEM),
    sourceDocuments,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const reconciliation = result.data;
  return NextResponse.json({ ok: true, reconciliation }, { status: 201 });
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

  const runs = await gstDb.gstReconciliationRun.findMany({
    where: { gstSettingsId: settings.data.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ ok: true, runs });
}
