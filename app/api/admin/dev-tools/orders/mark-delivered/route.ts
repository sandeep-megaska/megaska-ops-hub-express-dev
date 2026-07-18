import { NextRequest, NextResponse } from "next/server";
import { resolveAdminShopFromRequest } from "../../../../../../services/shopify/admin-shop-context";
import {
  DevDeliveryHelperError,
  assertDevelopmentDeliveryHelperEnabled,
  markOrderDeliveredForDevelopment,
} from "../../../../../../services/dev-tools/mark-order-delivered";

const headers = { "Cache-Control": "no-store" };

function failure(code: string, status: number) {
  return NextResponse.json({ ok: false, error: code }, { status, headers });
}

export async function POST(request: NextRequest) {
  try {
    assertDevelopmentDeliveryHelperEnabled();
  } catch (error) {
    return failure(error instanceof DevDeliveryHelperError ? error.code : "DEV_HELPER_DISABLED", 404);
  }

  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id || !resolved.hmacVerified) return failure("UNAUTHENTICATED", 401);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("INVALID_INPUT", 400);
  const input = body as Record<string, unknown>;
  if ("shopId" in input || typeof input.orderId !== "string") return failure("INVALID_INPUT", 400);
  if (input.runDeliveryAutomations !== undefined && input.runDeliveryAutomations !== false) return failure("INVALID_INPUT", 400);

  let deliveredAt: Date | undefined;
  if (input.deliveredAt !== undefined) {
    if (typeof input.deliveredAt !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(input.deliveredAt)) return failure("INVALID_INPUT", 400);
    deliveredAt = new Date(input.deliveredAt);
    if (Number.isNaN(deliveredAt.getTime())) return failure("INVALID_INPUT", 400);
  }
  if (input.reason !== undefined && typeof input.reason !== "string") return failure("INVALID_INPUT", 400);

  try {
    const order = await markOrderDeliveredForDevelopment({
      shopId: resolved.shop.id,
      orderId: input.orderId,
      deliveredAt,
      actor: resolved.shop.shopDomain,
      reason: input.reason as string | undefined,
      runDeliveryAutomations: false,
    });
    return NextResponse.json({ ok: true, order, automationsExecuted: false }, { headers });
  } catch (error) {
    const code = error instanceof DevDeliveryHelperError ? error.code : "DELIVERY_TRANSITION_FAILED";
    const status = code === "ORDER_NOT_FOUND" ? 404 : code === "INVALID_INPUT" ? 400 : 500;
    return failure(code, status);
  }
}
