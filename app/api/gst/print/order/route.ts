import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { gstDb } from "../../../../../services/gst/db";
import { syncSingleOrderByShopifyGid } from "../../../../../services/gst/order-sync";
import { generateInvoiceBatch } from "../../../../../services/gst/dispatch-batch";
import { renderGstPdf } from "../../../../../services/gst/pdf";
import { resolveShopConfig } from "../../../../../services/shopify/shop";
import { extensionCorsPreflight, withExtensionCors } from "../../../../../services/shopify/extension-cors";

export const runtime = "nodejs";

function extractShopifyEntityId(gid: string) {
  const raw = String(gid || "").trim();
  if (!raw) return "";
  return raw.includes("/") ? raw.split("/").pop() || raw : raw;
}

function htmlMessage(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:2rem;color:#111;"><h2>${title}</h2><p>${body}</p></body></html>`;
}

/**
 * Absolute origin of this app. The print-action extension runs in a sandbox
 * whose relative URLs resolve against extensions.shopifycdn.com, and its fetch
 * Response.url comes back empty in that runtime - so we cannot rely on the
 * client learning the app URL. We build the absolute URL server-side from
 * SHOPIFY_APP_URL (falling back to the request origin) and hand it back.
 */
function absoluteBase(req: NextRequest) {
  const configured = String(process.env.SHOPIFY_APP_URL || "").trim().replace(/\/$/, "");
  return configured || req.nextUrl.origin;
}

export async function OPTIONS() {
  return extensionCorsPreflight();
}

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("orderId") || "";
  const shopDomain = req.nextUrl.searchParams.get("shop") || "";
  // format=json: validate/prepare the invoice and return the absolute HTML URL
  // for Shopify's print preview to load. Default/html: render the printable HTML.
  const wantsJson = (req.nextUrl.searchParams.get("format") || "").toLowerCase() === "json";
  const shopifyOrderId = extractShopifyEntityId(orderId);

  // Format-aware error: JSON for the extension's prepare step, HTML otherwise so
  // the message shows inside the print preview pane.
  const fail = (status: number, title: string, body: string) =>
    withExtensionCors(
      wantsJson
        ? NextResponse.json({ ok: false, error: body || title }, { status })
        : new NextResponse(htmlMessage(title, body), {
            status,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
    );

  if (!shopifyOrderId) {
    return fail(400, "Missing order", "No orderId was provided to the print preview.");
  }

  const resolvedShop = await resolveShopConfig(shopDomain || undefined);
  const resolvedShopId = resolvedShop.id ? String(resolvedShop.id).trim() : null;
  if (!resolvedShopId) {
    return fail(400, "Shop not resolved", "Unable to resolve the shop for this order.");
  }

  let orderImport = await prisma.gstOrderImport.findFirst({
    where: { shopId: resolvedShopId, shopifyOrderId },
    select: { id: true },
  });

  if (!orderImport) {
    const synced = await syncSingleOrderByShopifyGid({
      shopifyOrderGid: orderId,
      shopDomain: resolvedShop.shopDomain,
    });
    if (!synced.ok) {
      return fail(400, "Unable to prepare invoice", synced.error || "Order sync failed.");
    }
    orderImport = await prisma.gstOrderImport.findFirst({
      where: { shopId: resolvedShopId, shopifyOrderId },
      select: { id: true },
    });
  }

  if (!orderImport) {
    return fail(404, "Order not found", "This order could not be imported for GST invoicing.");
  }

  let invoice = await gstDb.gstDocument.findFirst({
    where: {
      documentType: "TAX_INVOICE",
      OR: [{ sourceOrderId: orderImport.id }, { shopifyOrderId }],
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });

  if (!invoice) {
    const batch = await generateInvoiceBatch({ shopId: resolvedShopId, orderImportIds: [orderImport.id] });
    if (!batch.ok || !batch.data || batch.data.generated === 0) {
      const perOrder = batch.ok ? (batch.data?.results?.[0] as { error?: string } | undefined) : undefined;
      const error = (batch.ok ? perOrder?.error : batch.error) || "Failed to generate GST invoice";
      return fail(400, "Unable to generate invoice", error);
    }
    invoice = await gstDb.gstDocument.findFirst({
      where: {
        documentType: "TAX_INVOICE",
        OR: [{ sourceOrderId: orderImport.id }, { shopifyOrderId }],
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });
  }

  if (!invoice) {
    return fail(404, "Invoice not available", "No GST invoice could be found or generated for this order.");
  }

  if (wantsJson) {
    const base = absoluteBase(req);
    const url =
      `${base}/api/gst/print/order` +
      `?orderId=${encodeURIComponent(orderId)}` +
      `&shop=${encodeURIComponent(shopDomain)}` +
      `&format=html`;
    return withExtensionCors(NextResponse.json({ ok: true, url }));
  }

  const rendered = await renderGstPdf(invoice.id);
  if (!rendered.ok || !rendered.data) {
    return fail(500, "Unable to render invoice", rendered.error || "Rendering failed.");
  }

  return withExtensionCors(
    new NextResponse(rendered.data.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  );
}
