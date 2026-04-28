import { NextRequest, NextResponse } from "next/server";
import { getActiveGstSettings } from "../../../../../../../services/gst/settings";
import { getB2cInvoiceAvailability } from "../../../../../../../services/gst/report-export";

export const runtime = "nodejs";

function parseDateInput(value: string | null, mode: "start" | "end"): Date | null {
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

export async function GET(req: NextRequest) {
  const settings = await getActiveGstSettings();
  if (!settings.ok || !settings.data) {
    return NextResponse.json({ ok: false, error: settings.error || "Active GST settings not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const periodStart = parseDateInput(from, "start");
  const periodEnd = parseDateInput(to, "end");

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ ok: false, error: "from and to are required ISO dates" }, { status: 400 });
  }

  const availability = await getB2cInvoiceAvailability({
    gstSettingsId: settings.data.id,
    periodStart,
    periodEnd,
  });

  if (!availability.ok || !availability.data) {
    return NextResponse.json({ ok: false, error: availability.error || "Failed to load B2C invoice availability" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: availability.data });
}
