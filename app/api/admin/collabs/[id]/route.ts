import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { bookCollabShipment, refreshCollabCosts, syncCollabTracking } from "../../../../../services/collab/collab-operations";
import { DELIVERABLE_STATUSES, type DeliverableStatus } from "../../../../../services/collab/collab-shipments";

export const maxDuration = 60;

function fail(error: unknown, fallback: string) {
  const status = error instanceof ShopResolutionError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

// Record the content they posted, the real shipping cost from the Delhivery bill, or notes.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await params;
    const row = await prisma.collabShipment.findFirst({ where: { id, shopId: shop.id }, select: { id: true, postedAt: true } });
    if (!row) return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof body.deliverableStatus === "string") {
      if (!DELIVERABLE_STATUSES.includes(body.deliverableStatus as DeliverableStatus)) return NextResponse.json({ error: "Unknown content status." }, { status: 400 });
      data.deliverableStatus = body.deliverableStatus;
      data.postedAt = body.deliverableStatus === "POSTED" ? row.postedAt || new Date() : null;
    }
    if (typeof body.contentUrl === "string") {
      const url = body.contentUrl.trim().slice(0, 500);
      if (url && !/^https?:\/\/\S+$/i.test(url)) return NextResponse.json({ error: "Paste the full link, starting with https://" }, { status: 400 });
      data.contentUrl = url || null;
    }
    if (body.shippingCostRupees !== undefined) {
      const raw = String(body.shippingCostRupees ?? "").trim();
      const value = Number(raw);
      if (raw && (!Number.isFinite(value) || value < 0 || value > 100000)) return NextResponse.json({ error: "Enter the shipping cost in rupees." }, { status: 400 });
      data.shippingCostPaise = raw ? Math.round(value * 100) : null;
    }
    if (typeof body.notes === "string") data.notes = body.notes.trim().slice(0, 500) || null;
    const updated = await prisma.collabShipment.update({ where: { id }, data });
    return NextResponse.json({ row: updated });
  } catch (error) {
    return fail(error, "Could not save.");
  }
}

// action=book retries the Delhivery booking; action=track refreshes tracking now;
// action=cost fills in cost prices added in Shopify since the parcel was sent.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "book") {
      const result = await bookCollabShipment(shop, id);
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }
    if (body.action === "cost") {
      const result = await refreshCollabCosts(shop, id);
      return NextResponse.json(result, { status: result.ok ? 200 : 404 });
    }
    if (body.action === "track") {
      const row = await prisma.collabShipment.findFirst({ where: { id, shopId: shop.id }, select: { id: true, shopId: true, awb: true, trackingUrl: true, deliveredAt: true } });
      if (!row) return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
      const result = await syncCollabTracking(row);
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return fail(error, "Could not update the parcel.");
  }
}
