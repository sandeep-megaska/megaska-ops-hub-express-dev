import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { gstDb } from "../../../../../services/gst/db";
import { syncSingleOrderByShopifyGid } from "../../../../../services/gst/order-sync";
import { generateInvoiceBatch } from "../../../../../services/gst/dispatch-batch";
import { resolveShopConfig } from "../../../../../services/shopify/shop";
import { extensionCorsPreflight, withExtensionCors } from "../../../../../services/shopify/extension-cors";

export const runtime = "nodejs";

function extractShopifyEntityId(gid: string) {
  const raw = String(gid || "").trim();
  if (!raw) return "";
  return raw.includes("/") ? raw.split("/").pop() || raw : raw;
}

export async function OPTIONS() {
  return extensionCorsPreflight();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.shopifyOrderGid) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "shopifyOrderGid is required" }, { status: 400 })
    );
  }

  const shopifyOrderGid = String(body.shopifyOrderGid);
  const shopifyOrderId = extractShopifyEntityId(shopifyOrderGid);
  const shopDomain = String(body.shop || "").trim();
  const generate = Boolean(body.generate);

  const resolvedShop = await resolveShopConfig(shopDomain || undefined);
  const resolvedShopId = resolvedShop.id ? String(resolvedShop.id).trim() : null;

  let orderImport = await prisma.gstOrderImport.findFirst({
    where: { shopId: resolvedShopId, shopifyOrderId },
    select: { id: true, shopifyOrderName: true, readinessErrors: true },
  });

  // Re-import when the order is new OR when the caller explicitly asks to
  // generate/refresh. Without forcing a re-import on refresh, readinessErrors
  // stay frozen at first-import time, so a SKU/HSN mapping added afterwards
  // never clears a stale "missing GST mapping" warning and the order looks
  // stuck. A failed re-sync on an already-imported order is non-fatal - we fall
  // back to the existing record.
  if (!orderImport || generate) {
    const synced = await syncSingleOrderByShopifyGid({
      shopifyOrderGid,
      shopDomain: resolvedShop.shopDomain,
      forceResync: true,
    });
    if (!synced.ok && !orderImport) {
      return withExtensionCors(
        NextResponse.json({ ok: false, error: synced.error || "Unable to sync order from Shopify" }, { status: 400 })
      );
    }
    orderImport = await prisma.gstOrderImport.findFirst({
      where: { shopId: resolvedShopId, shopifyOrderId },
      select: { id: true, shopifyOrderName: true, readinessErrors: true },
    });
  }

  if (!orderImport) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "Order could not be imported for GST" }, { status: 404 })
    );
  }

  let invoice = await gstDb.gstDocument.findFirst({
    where: {
      documentType: "TAX_INVOICE",
      OR: [{ sourceOrderId: orderImport.id }, { shopifyOrderId }],
    },
    orderBy: [{ createdAt: "desc" }],
  });

  let generationError: string | null = null;
  if (!invoice && generate) {
    const batch = await generateInvoiceBatch({ shopId: resolvedShopId, orderImportIds: [orderImport.id] });
    if (!batch.ok || !batch.data || batch.data.generated === 0) {
      const perOrder = batch.ok ? (batch.data?.results?.[0] as { error?: string } | undefined) : undefined;
      generationError = (batch.ok ? perOrder?.error : batch.error) || "Failed to generate invoice";
    } else {
      invoice = await gstDb.gstDocument.findFirst({
        where: {
          documentType: "TAX_INVOICE",
          OR: [{ sourceOrderId: orderImport.id }, { shopifyOrderId }],
        },
        orderBy: [{ createdAt: "desc" }],
      });
    }
  }

  const snapshot = invoice?.jsonSnapshot && typeof invoice.jsonSnapshot === "object"
    ? (invoice.jsonSnapshot as Record<string, unknown>)
    : null;
  const buyer = snapshot?.buyer && typeof snapshot.buyer === "object" ? (snapshot.buyer as Record<string, unknown>) : null;

  return withExtensionCors(
    NextResponse.json({
      ok: true,
      data: {
        orderName: orderImport.shopifyOrderName,
        orderImportId: orderImport.id,
        readinessErrors: Array.isArray(orderImport.readinessErrors) ? orderImport.readinessErrors : [],
        invoiceId: invoice ? String(invoice.id) : null,
        documentNumber: invoice ? invoice.documentNumber : null,
        status: invoice ? invoice.status : "NOT_INVOICED",
        customerEmail: buyer?.email ? String(buyer.email) : null,
        pdfUrl: invoice ? `/api/gst/invoices/${invoice.id}/pdf` : null,
        error: generationError,
      },
    })
  );
}
