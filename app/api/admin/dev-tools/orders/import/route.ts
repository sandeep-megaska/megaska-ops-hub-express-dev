import { NextRequest, NextResponse } from "next/server";
import { resolveAdminShopFromRequest } from "../../../../../../services/shopify/admin-shop-context";
import { CanonicalShopifyOrderSyncError } from "../../../../../../services/orders/shopify-order-sync";
import { assertDevelopmentOrderImportEnabled, DevOrderImportError, importShopifyOrderForDevelopment } from "../../../../../../services/dev-tools/import-shopify-order";

const headers = { "Cache-Control": "no-store" };
const failure = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

export async function POST(request: NextRequest) {
  try { assertDevelopmentOrderImportEnabled(); }
  catch (error) { return failure(error instanceof DevOrderImportError ? error.code : "DEV_HELPER_DISABLED", 404); }

  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id || !resolved.hmacVerified) return failure("UNAUTHENTICATED", 401);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("INVALID_INPUT", 400);
  const input = body as Record<string, unknown>;
  if ("shopId" in input || Object.keys(input).some((key) => key !== "orderId") || typeof input.orderId !== "string") return failure("INVALID_INPUT", 400);

  try {
    const order = await importShopifyOrderForDevelopment({ shopId: resolved.shop.id, shopDomain: resolved.shop.shopDomain, orderIdentifier: input.orderId });
    return NextResponse.json({ ok: true, order: { id: order.id, shopifyOrderId: order.shopifyOrderId, shopifyOrderName: order.shopifyOrderName, status: order.status, customerProfileId: order.customerProfileId } }, { headers });
  } catch (error) {
    const code = error instanceof CanonicalShopifyOrderSyncError ? error.code : "ORDER_IMPORT_FAILED";
    return failure(code, code === "INVALID_ORDER_ID" ? 400 : code === "SHOPIFY_ORDER_NOT_FOUND" ? 404 : 422);
  }
}
