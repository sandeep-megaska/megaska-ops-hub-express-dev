import { NextRequest, NextResponse } from "next/server";
import { listReportRuns, prepareB2cSalesRegisterReport } from "../../../../../services/gst/report-export";
import { getActiveGstSettings } from "../../../../../services/gst/settings";
import { resolveGstAdminShop, resolveGstAdminShopId } from "../../../../../services/gst/request-shop";
import { istDayEnd, istDayStart } from "../../../../../services/gst/reports/order-status";

export const runtime = "nodejs";


// GST periods are India-time calendar days: 1 Oct 00:00 IST to 31 Oct 23:59 IST.
// A bare YYYY-MM-DD, or a day sent as UTC start/end of day (the GST screens send
// `${from}T00:00:00.000Z` / `${to}T23:59:59.999Z`), means that IST day; UTC boundaries put orders placed between midnight and 05:30 IST in the
// wrong day, and on the 1st or last of the month in the wrong return.
function parseDateInput(value: unknown, mode: "start" | "end"): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const day = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(?:00:00:00|23:59:59)(?:\.\d{1,3})?Z)?$/);
  if (day) {
    const parsed = mode === "start" ? istDayStart(day[1]) : istDayEnd(day[1]);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

    // The report syncs this shop's orders from Shopify first, so it needs the
    // verified shop's domain as well as its id.
    const shop = await resolveGstAdminShop(req);
    if (!shop) {
      return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request. Reopen this page from Shopify admin." }, { status: 400 });
    }
    const shopId = shop.id;

    const settings = await getActiveGstSettings({ shopId });
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

    if (String(body.reportType || "B2C_SALES_REGISTER").trim().toUpperCase() !== "B2C_SALES_REGISTER") {
      return NextResponse.json({ ok: false, error: "Only B2C_SALES_REGISTER is supported" }, { status: 400 });
    }

    const result = await prepareB2cSalesRegisterReport({
      gstSettingsId: settings.data.id,
      shopId: settings.data.shopId ? String(settings.data.shopId) : undefined,
      shopDomain: shop.shopDomain,
      periodStart,
      periodEnd,
    });

    if (!result.ok || !result.data) {
      return NextResponse.json({ ok: false, error: result.error || "Failed to generate report run" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...result.data }, { status: 201 });
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
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) {
    return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });
  }

  const settings = await getActiveGstSettings({ shopId });
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
