import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { adminGraphql } from "../../../../../../services/shopify/admin";
import { resolveDelhiveryRuntimeConfig } from "../../../../../../services/logistics/delhivery-runtime";
import {
  MAX_ORDERS_PER_CREATE_REQUEST,
  bookOrderShipments,
  normalizeCreateOptions,
  type OrderShipmentDb,
} from "../../../../../../services/logistics/order-shipments";

export const maxDuration = 60;

// Books Delhivery shipments for up to MAX_ORDERS_PER_CREATE_REQUEST orders; the
// admin page sends larger selections in chunks so each call stays short.
export async function POST(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const orderIds: string[] = Array.isArray(body?.orderIds)
      ? Array.from(new Set(body.orderIds.filter((id: unknown): id is string => typeof id === "string" && id.startsWith("gid://shopify/Order/"))))
      : [];

    if (!orderIds.length) {
      return NextResponse.json({ error: "Select at least one order." }, { status: 400 });
    }
    if (orderIds.length > MAX_ORDERS_PER_CREATE_REQUEST) {
      return NextResponse.json({ error: `Send at most ${MAX_ORDERS_PER_CREATE_REQUEST} orders per request.` }, { status: 400 });
    }

    const runtime = await resolveDelhiveryRuntimeConfig(shop.id);
    if (!runtime.configured) {
      return NextResponse.json({ error: runtime.reason }, { status: 503 });
    }

    const results = await bookOrderShipments({
      db: prisma as unknown as OrderShipmentDb,
      shopId: shop.id,
      orderIds,
      runtime,
      graphql: (query, variables) => adminGraphql(query, variables, { shopDomain: shop.shopDomain }),
      options: normalizeCreateOptions(body || {}),
    });

    const created = results.filter((result) => result.outcome === "created");
    if (created.length) {
      await prisma.auditEvent
        .create({
          data: {
            actorType: "admin",
            eventType: "orders.delhivery.bulk_shipments.created",
            entityType: "Shop",
            entityId: shop.id,
            payload: { shopId: shop.id, created: created.map((result) => ({ orderId: result.orderId, orderName: result.orderName, awb: result.awb })) } as never,
          },
        })
        .catch(() => {});
    }

    return NextResponse.json({ results });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    console.error("[ORDER SHIPMENTS CREATE ERROR]", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create shipments." }, { status });
  }
}
