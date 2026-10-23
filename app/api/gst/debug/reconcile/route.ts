import { NextRequest, NextResponse } from "next/server";
import { resolveGstAdminShopId } from "../../../../../services/gst/request-shop";
import { isGstNoteDocumentType } from "../../../../../services/gst/constants";
import {
  buildShadowInvoiceDraft,
  buildShadowNoteDraft,
  compareShadowWithReference,
  type GstProLikeReference,
} from "../../../../../services/gst/shadow";
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
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const source = {
    sourceOrderId: String(body.sourceOrderId || ""),
    sellerStateCode: String(body.sellerStateCode || ""),
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

  const reference: GstProLikeReference =
    body.reference && typeof body.reference === "object"
      ? (body.reference as GstProLikeReference)
      : {};

  const mode = body.mode === "NOTE" ? "NOTE" : "INVOICE";

  const draftResult =
    mode === "NOTE"
      ? buildShadowNoteDraft(
          source,
          isGstNoteDocumentType(body.noteType) ? body.noteType : "CREDIT_NOTE",
          body.originalDocumentNumber ? String(body.originalDocumentNumber) : undefined,
        )
      : buildShadowInvoiceDraft(source);

  if (!draftResult.ok || !draftResult.data) {
    return NextResponse.json({ ok: false, error: draftResult.error || "Unable to build shadow draft" }, { status: 400 });
  }

  const draft = draftResult.data;
  const comparison = compareShadowWithReference(draft, reference);

  return NextResponse.json(
    {
      ok: true,
      mode,
      draft,
      comparison,
    },
    { status: 200 },
  );
}
