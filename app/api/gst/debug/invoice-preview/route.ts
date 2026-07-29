import { NextRequest, NextResponse } from "next/server";
import { buildShadowInvoiceDraft } from "../../../../../services/gst/shadow";
import { getActiveGstSettings, getGstSettingsById } from "../../../../../services/gst/settings";
import { resolveGstAdminShopId } from "../../../../../services/gst/request-shop";
import type { GstDocumentLineInput } from "../../../../../services/gst/types";

export const runtime = "nodejs";

function parseLines(value: unknown): GstDocumentLineInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((line) => {
    const safe = (line || {}) as Record<string, unknown>;
    return {
      description: String(safe.description || ""),
      quantity: Number(safe.quantity || 0),
      unitPrice: Number(safe.unitPrice || 0),
      taxRate: Number(safe.taxRate || 0),
      hsnOrSac: safe.hsnOrSac ? String(safe.hsnOrSac) : undefined,
      unit: safe.unit ? String(safe.unit) : undefined,
      discount: Number(safe.discount || 0),
    };
  });
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

  let settingsResult = body.gstSettingsId
    ? await getGstSettingsById(String(body.gstSettingsId))
    : await getActiveGstSettings({ shopId });
  // Tenant isolation: an explicit gstSettingsId must belong to the acting shop.
  if (body.gstSettingsId && settingsResult.ok && settingsResult.data && String(settingsResult.data.shopId || "") !== shopId) {
    settingsResult = { ok: false, error: "GST settings not found" };
  }
  if (!settingsResult.ok || !settingsResult.data) {
    return NextResponse.json(
      { ok: false, error: settingsResult.error || "Unable to resolve GST settings" },
      { status: 400 },
    );
  }

  const settings = settingsResult.data;

  const source = {
    sourceOrderId: String(body.sourceOrderId || ""),
    sellerStateCode: settings.stateCode,
    billingStateCode: body.billingStateCode ? String(body.billingStateCode) : null,
    shippingStateCode: body.shippingStateCode ? String(body.shippingStateCode) : null,
    currency: body.currency ? String(body.currency) : "INR",
    buyer:
      body.buyer && typeof body.buyer === "object"
        ? {
            legalName: String((body.buyer as Record<string, unknown>).legalName || ""),
            gstin: (body.buyer as Record<string, unknown>).gstin
              ? String((body.buyer as Record<string, unknown>).gstin)
              : null,
            stateCode: (body.buyer as Record<string, unknown>).stateCode
              ? String((body.buyer as Record<string, unknown>).stateCode)
              : null,
          }
        : undefined,
    lines: parseLines(body.lines),
    totalDiscount: Number(body.totalDiscount || 0),
    metadata:
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : {},
  };

  const result = buildShadowInvoiceDraft(source);

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const preview = result.data;
  return NextResponse.json({ ok: true, preview }, { status: 200 });
}
