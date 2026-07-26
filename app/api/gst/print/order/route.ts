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

export async function OPTIONS() {
  return extensionCorsPreflight();
}

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("orderId") || "";
  const shopDomain = req.nextUrl.searchParams.get("shop") || "";
  const shopifyOrderId = extractShopifyEntityId(orderId);

  if (!shopifyOrderId) {
    return withExtensionCors(
      new NextResponse(htmlMessage("Missing order", "No orderId was provided to the print preview."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }

  const resolvedShop = await resolveShopConfig(shopDomain || undefined);
  const resolvedShopId = resolvedShop.id ? String(resolvedShop.id).trim() : null;

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
      return withExtensionCors(
        new NextResponse(htmlMessage("Unable to prepare invoice", synced.error || "Order sync failed."), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );
    }
    orderImport = await prisma.gstOrderImport.findFirst({
      where: { shopId: resolvedShopId, shopifyOrderId },
      select: { id: true },
    });
  }

  if (!orderImport) {
    return withExtensionCors(
      new NextResponse(htmlMessage("Order not found", "This order could not be imported for GST invoicing."), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
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
      return withExtensionCors(
        new NextResponse(htmlMessage("Unable to generate invoice", error), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );
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
    return withExtensionCors(
      new NextResponse(htmlMessage("Invoice not available", "No GST invoice could be found or generated for this order."), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }

  const rendered = await renderGstPdf(invoice.id);
  if (!rendered.ok || !rendered.data) {
    return withExtensionCors(
      new NextResponse(htmlMessage("Unable to render invoice", rendered.error || "Rendering failed."), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }

  return withExtensionCors(
    new NextResponse(rendered.data.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  );
}
