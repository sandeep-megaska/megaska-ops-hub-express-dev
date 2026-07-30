import { NextRequest, NextResponse } from "next/server";
import { renderGstInvoicePdfBuffer } from "../../../../../../services/gst/pdf-binary";
import { renderGstPdf } from "../../../../../../services/gst/pdf";
import { getGstDocumentById } from "../../../../../../services/gst/documents";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { verifyInvoiceDocumentAccess } from "../../../../../../services/gst/invoice-url-signing";
import { extensionCorsPreflight, withExtensionCors } from "../../../../../../services/shopify/extension-cors";

export const runtime = "nodejs";

// Resolve the acting shop for an invoice-PDF request. Two accepted proofs:
//   1. A verified Shopify session token (Bearer) — the embedded admin app,
//      which fetches the PDF as a blob and can attach the header.
//   2. A short-lived HMAC signature (?shopId=&exp=&sig=) minted server-side by
//      by-shopify-id after it verified the caller — the admin action extension,
//      which opens the PDF via window.open (a navigation with no header).
// Returns null when neither proof is valid; the route then answers 401.
async function resolveShopForPdf(req: NextRequest, documentId: string): Promise<string | null> {
  try {
    const shop = await requireAdminShopFromRequest(req);
    if (shop?.id) return shop.id;
  } catch {
    // No / invalid session token — fall through to the signature check.
  }

  const sp = req.nextUrl.searchParams;
  const verified = verifyInvoiceDocumentAccess(documentId, {
    shopId: sp.get("shopId"),
    exp: sp.get("exp"),
    sig: sp.get("sig"),
  });
  return verified.ok && verified.shopId ? verified.shopId : null;
}

export async function OPTIONS(req: NextRequest) {
  return extensionCorsPreflight(req);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = req.nextUrl.searchParams.get("format");

  const shopId = await resolveShopForPdf(req, id);
  if (!shopId) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
      req,
    );
  }

  // Tenant isolation: the document must belong to the resolved shop.
  const owner = await getGstDocumentById(id, { shopId });
  if (!owner.ok || !owner.data) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "GST invoice not found" }, { status: 404 }),
      req,
    );
  }

  if (format === "html") {
    const htmlResult = await renderGstPdf(id);
    if (!htmlResult.ok || !htmlResult.data) {
      return withExtensionCors(
        NextResponse.json({ ok: false, error: htmlResult.error || "Unable to render invoice HTML" }, { status: 404 }),
        req,
      );
    }

    return withExtensionCors(
      new NextResponse(htmlResult.data.html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }),
      req,
    );
  }

  const result = await renderGstInvoicePdfBuffer(id);
  if (!result.ok || !result.data) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: result.error || "Unable to generate invoice PDF" }, { status: 404 }),
      req,
    );
  }

  const filename = `${result.data.documentNumber || `gst-invoice-${id}`}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return withExtensionCors(
    new NextResponse(result.data.buffer as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    }),
    req,
  );
}
