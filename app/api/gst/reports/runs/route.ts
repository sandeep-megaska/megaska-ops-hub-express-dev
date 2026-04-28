import { NextRequest, NextResponse } from "next/server";
import { generateReportRun, listReportRuns } from "../../../../../services/gst/report-export";
import { getActiveGstSettings } from "../../../../../services/gst/settings";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const settings = await getActiveGstSettings();
  if (!settings.ok || !settings.data) {
    return NextResponse.json({ ok: false, error: settings.error || "Active GST settings not found" }, { status: 404 });
  }

  const periodStart = new Date(String(body.periodStart || ""));
  const periodEnd = new Date(String(body.periodEnd || ""));
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ ok: false, error: "periodStart and periodEnd are required ISO dates" }, { status: 400 });
  }

  const result = await generateReportRun({
    gstSettingsId: settings.data.id,
    reportType: String(body.reportType || "B2C_SALES_REGISTER"),
    periodStart,
    periodEnd,
    format: body.format === "XLSX" ? "XLSX" : "CSV",
    filters: body.filters && typeof body.filters === "object" ? (body.filters as Record<string, unknown>) : {},
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to generate report run" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, run: result.data }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const settings = await getActiveGstSettings();
  if (!settings.ok || !settings.data) {
    return NextResponse.json({ ok: false, error: settings.error || "Active GST settings not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const result = await listReportRuns({
    gstSettingsId: settings.data.id,
    reportType: searchParams.get("reportType") || undefined,
    status: searchParams.get("status") || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to list report runs" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, runs: result.data || [] });
}
