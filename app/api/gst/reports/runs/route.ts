import { NextRequest, NextResponse } from "next/server";
import { generateReportRun, listReportRuns } from "../../../../../services/gst/report-export";
import { getActiveGstSettings } from "../../../../../services/gst/settings";

export const runtime = "nodejs";


function parseDateInput(value: unknown, mode: "start" | "end"): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = mode === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const parsed = new Date(`${raw}${suffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  if (mode === "end" && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(raw)) {
    parsed.setUTCHours(23, 59, 59, 999);
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
    }

    console.log("[GST_REPORTS_RUNS][POST] requested reportType:", String(body.reportType || "B2C_SALES_REGISTER"));
    console.log("[GST_REPORTS_RUNS][POST] fromDate/toDate received:", {
      fromDate: body.fromDate ?? null,
      toDate: body.toDate ?? null,
      periodStart: body.periodStart ?? null,
      periodEnd: body.periodEnd ?? null,
    });

    const settings = await getActiveGstSettings();
    if (!settings.ok || !settings.data) {
      return NextResponse.json({ ok: false, error: settings.error || "Active GST settings not found" }, { status: 404 });
    }
    console.log("[GST_REPORTS_RUNS][POST] shop value resolved:", settings.data.shopId ?? null);

    const rawPeriodStart = body.periodStart ?? body.fromDate;
    const rawPeriodEnd = body.periodEnd ?? body.toDate;
    const periodStart = parseDateInput(rawPeriodStart, "start");
    const periodEnd = parseDateInput(rawPeriodEnd, "end");

    if (!periodStart || !periodEnd) {
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

    if (result.data.reportType === "B2C_SALES_REGISTER" && "csv" in result.data) {
      return NextResponse.json({ ok: true, ...result.data }, { status: 201 });
    }

    return NextResponse.json({ ok: true, run: result.data }, { status: 201 });
  } catch (error) {
    console.error("B2C export failed", {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ ok: false, error: "Failed to generate B2C export" }, { status: 500 });
  }
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
