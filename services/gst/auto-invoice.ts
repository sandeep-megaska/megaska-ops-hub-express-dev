import { prisma } from "../db/prisma";
import { getActiveGstSettings } from "./settings";
import { syncSingleOrder } from "./order-sync";
import { generateInvoiceBatch } from "./dispatch-batch";

export interface AutoGenerateInvoiceResult {
  attempted: boolean;
  reason?: string;
  orderImportId?: string;
  generated?: boolean;
}

/**
 * Best-effort, non-throwing invoice generation for a single freshly-created order.
 * Callers (e.g. the orders/create webhook) must treat this as fire-and-forget:
 * any failure here must never affect order processing itself.
 */
export async function autoGenerateInvoiceForOrder(input: {
  shopId: string | null;
  shopDomain: string;
  orderName: string;
}): Promise<AutoGenerateInvoiceResult> {
  const settings = await getActiveGstSettings({ shopId: input.shopId });
  if (!settings.ok || !settings.data) {
    return { attempted: false, reason: "no-active-gst-settings" };
  }

  if (!settings.data.autoGenerateOnOrderCreate) {
    return { attempted: false, reason: "auto-generate-disabled" };
  }

  const synced = await syncSingleOrder({
    orderName: input.orderName,
    shopDomain: input.shopDomain,
  });

  if (!synced.ok) {
    return { attempted: true, reason: synced.error || "sync-failed" };
  }

  const shopifyOrderId = synced.data?.perOrder?.[0]?.shopifyOrderId
    ? String(synced.data.perOrder[0].shopifyOrderId)
    : "";
  if (!shopifyOrderId) {
    return { attempted: true, reason: "missing-shopify-order-id" };
  }

  const orderImport = await prisma.gstOrderImport.findFirst({
    where: { shopId: input.shopId, shopifyOrderId },
    select: { id: true },
  });

  if (!orderImport) {
    return { attempted: true, reason: "order-import-not-found" };
  }

  const batchResult = await generateInvoiceBatch({
    shopId: input.shopId,
    orderImportIds: [orderImport.id],
  });

  if (!batchResult.ok || !batchResult.data) {
    return { attempted: true, orderImportId: orderImport.id, reason: batchResult.error || "batch-generation-failed" };
  }

  const generated = batchResult.data.generated > 0;
  const perOrderResult = batchResult.data.results[0] as { status?: string; error?: string } | undefined;

  return {
    attempted: true,
    orderImportId: orderImport.id,
    generated,
    reason: generated ? undefined : perOrderResult?.error || perOrderResult?.status,
  };
}
