import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { gstDb } from "../../../../../services/gst/db";
import { syncSingleOrderByShopifyGid } from "../../../../../services/gst/order-sync";
import { generateInvoiceBatch } from "../../../../../services/gst/dispatch-batch";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { signInvoiceDocumentAccess } from "../../../../../services/gst/invoice-url-signing";
import { extensionCorsPreflight, withExtensionCors } from "../../../../../services/shopify/extension-cors";

export const runtime = "nodejs";

function extractShopifyEntityId(gid: string) {
  const raw = String(gid || "").trim();
  if (!raw) return "";
  return raw.includes("/") ? raw.split("/").pop() || raw : raw;
}

/**
 * Absolute origin of this app. The action extension runs in a sandbox whose
 * relative URLs resolve against extensions.shopifycdn.com, so the PDF link must
 * be absolute for the merchant's click to reach the app (and download the file).
 */
function absoluteBase(req: NextRequest) {
  const configured = String(process.env.SHOPIFY_APP_URL || "").trim().replace(/\/$/, "");
  return configured || req.nextUrl.origin;
}

export async function OPTIONS(req: NextRequest) {
  return extensionCorsPreflight(req);
}

export async function POST(req: NextRequest) {
  // Per-stage timing, surfaced in the response so the slow stage (Shopify re-sync
  // vs invoice generation vs the rest) is visible in the browser Network tab
  // without hunting through server logs. Milliseconds; 0 = stage did not run.
  const reqStartedMs = Date.now();
  let syncMs = 0;
  let generateMs = 0;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.shopifyOrderGid) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "shopifyOrderGid is required" }, { status: 400 }),
      req,
    );
  }

  const shopifyOrderGid = String(body.shopifyOrderGid);
  const shopifyOrderId = extractShopifyEntityId(shopifyOrderGid);
  const generate = Boolean(body.generate);

  // Require a verified session token from the admin action extension; derive the
  // shop from it. The client-supplied `body.shop` is no longer trusted (it would
  // let any caller read another tenant's order/invoice by passing its domain).
  let shop;
  try {
    shop = await requireAdminShopFromRequest(req);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 401;
    return withExtensionCors(
      NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unauthorized" }, { status }),
      req,
    );
  }
  const resolvedShopId = shop.id;

  let orderImport = await prisma.gstOrderImport.findFirst({
    where: { shopId: resolvedShopId, shopifyOrderId },
    select: { id: true, shopifyOrderName: true, readinessErrors: true, orderTaxTotal: true, orderGrandTotal: true },
  });

  // Re-sync from Shopify only when the round-trip can change the outcome:
  //   - the order has never been imported (we need its data at all), or
  //   - the caller is (re)generating AND the order still carries readiness
  //     errors, so a SKU/HSN mapping added in the app since the last import gets
  //     a chance to clear the stale "missing GST mapping" warning.
  // A clean, already-imported order — and any refresh of an already-issued
  // invoice — is NOT re-synced: the last import is authoritative and this extra
  // live Shopify round-trip on every generate/refresh is what made the popup
  // slow. A failed re-sync on an already-imported order is non-fatal.
  const hasReadinessErrors =
    Array.isArray(orderImport?.readinessErrors) && orderImport.readinessErrors.length > 0;
  if (!orderImport || (generate && hasReadinessErrors)) {
    const syncStartedMs = Date.now();
    const synced = await syncSingleOrderByShopifyGid({
      shopifyOrderGid,
      shopDomain: shop.shopDomain,
      forceResync: true,
    });
    syncMs = Date.now() - syncStartedMs;
    if (!synced.ok && !orderImport) {
      return withExtensionCors(
        NextResponse.json({ ok: false, error: synced.error || "Unable to sync order from Shopify" }, { status: 400 }),
        req,
      );
    }
    orderImport = await prisma.gstOrderImport.findFirst({
      where: { shopId: resolvedShopId, shopifyOrderId },
      select: { id: true, shopifyOrderName: true, readinessErrors: true, orderTaxTotal: true, orderGrandTotal: true },
    });
  }

  if (!orderImport) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "Order could not be imported for GST" }, { status: 404 }),
      req,
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
    const generateStartedMs = Date.now();
    const batch = await generateInvoiceBatch({ shopId: resolvedShopId, orderImportIds: [orderImport.id] });
    generateMs = Date.now() - generateStartedMs;
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

  // The app's SKU/HSN tax mapping is the single source of truth for invoice GST.
  // The tax Shopify recorded at checkout is intentionally NOT cross-checked here:
  // on a tax-inclusive store the invoice grand total still equals what the customer
  // paid, and the merchant's HSN mapping is authoritative for the GST rate. The only
  // tax-readiness guard is a missing SKU mapping, surfaced via readinessErrors and
  // the generation error below ("No GST tax profile found for SKU ...").

  return withExtensionCors(
    NextResponse.json({
      ok: true,
      data: {
        // Stage timings (ms) to diagnose popup latency from the Network tab.
        timings: { totalMs: Date.now() - reqStartedMs, syncMs, generateMs },
        orderName: orderImport.shopifyOrderName,
        orderImportId: orderImport.id,
        readinessErrors: Array.isArray(orderImport.readinessErrors) ? orderImport.readinessErrors : [],
        invoiceId: invoice ? String(invoice.id) : null,
        documentNumber: invoice ? invoice.documentNumber : null,
        status: invoice ? invoice.status : "NOT_INVOICED",
        customerEmail: buyer?.email ? String(buyer.email) : null,
        // window.open() in the action extension carries no Authorization header,
        // so hand back a short-lived signed URL scoped to this shop + document.
        pdfUrl: invoice
          ? (() => {
              const signed = signInvoiceDocumentAccess(String(invoice.id), resolvedShopId);
              const base = `${absoluteBase(req)}/api/gst/invoices/${invoice.id}/pdf`;
              // Default (hand-drawn) portrait renderer — reliable on serverless. The
              // Chromium path (?format=chromium) is left available on the route but not
              // requested here: @sparticuz/chromium can OOM/crash the Lambda before the
              // route's fallback runs, which broke the download. See PR notes.
              return signed
                ? `${base}?shopId=${encodeURIComponent(resolvedShopId)}&exp=${signed.exp}&sig=${encodeURIComponent(signed.sig)}`
                : base;
            })()
          : null,
        error: generationError,
      },
    }),
    req,
  );
}
