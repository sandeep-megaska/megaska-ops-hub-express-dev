import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { adminGraphql } from "../../../../../services/shopify/admin";
import { resolveDelhiveryRuntimeConfig } from "../../../../../services/logistics/delhivery-runtime";
import {
  describeExistingShipment,
  fetchShippableOrderNodes,
  loadCodIntentBalances,
  loadExistingShipments,
  normalizeShippableOrder,
  parseOrderNumberList,
  type OrderShipmentDb,
} from "../../../../../services/logistics/order-shipments";

export const maxDuration = 60;

function positiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Preview: unfulfilled orders matching the filters, with readiness and any
// existing Delhivery booking. Nothing is sent to Delhivery here.
export async function POST(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const filters = {
      from: typeof body?.from === "string" ? body.from : null,
      to: typeof body?.to === "string" ? body.to : null,
      orderNumberFrom: positiveInt(body?.orderNumberFrom),
      orderNumberTo: positiveInt(body?.orderNumberTo),
      orderNumbers: typeof body?.orderNumbers === "string" ? parseOrderNumberList(body.orderNumbers) : [],
    };

    const db = prisma as unknown as OrderShipmentDb;
    const graphql = <T,>(query: string, variables?: Record<string, unknown>) =>
      adminGraphql<T>(query, variables, { shopDomain: shop.shopDomain });

    const [runtime, scan] = await Promise.all([
      resolveDelhiveryRuntimeConfig(shop.id),
      fetchShippableOrderNodes(graphql, filters),
    ]);
    const ids = scan.nodes.map((node) => node.id);
    const [codBalances, existing] = await Promise.all([
      loadCodIntentBalances(db, shop.id, ids),
      loadExistingShipments(db, shop.id, ids),
    ]);

    const orders = scan.nodes.map((node) => ({
      ...normalizeShippableOrder(node, codBalances.get(node.id) ?? null),
      shipment: describeExistingShipment(existing.get(node.id)),
    }));

    return NextResponse.json({
      delhivery: {
        configured: runtime.configured,
        reason: runtime.configured ? null : runtime.reason,
        pickupLocationName: runtime.pickupLocationName || null,
      },
      orders,
      truncated: scan.truncated,
    });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    console.error("[ORDER SHIPMENTS PREVIEW ERROR]", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load orders." }, { status });
  }
}
