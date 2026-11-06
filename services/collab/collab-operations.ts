// Server-only: creates, books and tracks collab parcels (see collab-shipments.ts).
import { prisma } from "../db/prisma.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { resolveDelhiveryRuntimeConfig } from "../logistics/delhivery-runtime.ts";
import { bookOrderShipments, normalizeCreateOptions, type OrderShipmentDb } from "../logistics/order-shipments.ts";
import {
  VARIANTS_BY_ID_QUERY,
  VARIANT_SEARCH_QUERY,
  buildCollabDraftOrderInput,
  expectsContent,
  isTrackingDone,
  priceCollabItems,
  trackingUpdate,
  variantView,
  type CollabInput,
  type ShopifyVariantNode,
} from "./collab-shipments.ts";

type Shop = { id: string; shopDomain: string };
type UserError = { field?: string[] | null; message?: string | null };

function gql<T>(shop: Shop) {
  return (query: string, variables?: Record<string, unknown>) => adminGraphql<T>(query, variables, { shopDomain: shop.shopDomain });
}

function userErrors(errors: UserError[] | null | undefined) {
  return (errors || []).map((error) => error.message).filter(Boolean).join("; ");
}

export async function searchCollabVariants(shop: Shop, term: string) {
  const query = term.trim().slice(0, 80);
  if (query.length < 2) return [];
  const data = await gql<{ productVariants?: { nodes?: ShopifyVariantNode[] } }>(shop)(VARIANT_SEARCH_QUERY, { query });
  return (data.productVariants?.nodes || []).map(variantView).filter((variant) => variant.variantId && variant.productStatus !== "ARCHIVED");
}

async function audit(shopId: string, collabId: string, eventType: string, payload: Record<string, unknown>) {
  await prisma.auditEvent.create({ data: { actorType: "admin", eventType, entityType: "CollabShipment", entityId: collabId, payload: { shopId, ...payload } as never } }).catch(() => {});
}

// Shopify order first (stock and records), then the Delhivery booking. A booking
// failure leaves the order in place with the reason, and "Book on Delhivery" retries.
export async function createCollabShipment(shop: Shop, input: CollabInput) {
  const variants = await gql<{ nodes?: ShopifyVariantNode[] }>(shop)(VARIANTS_BY_ID_QUERY, { ids: input.items.map((item) => item.variantId) });
  const priced = priceCollabItems(input.items, variants.nodes || []);
  if (!priced.ok) return { ok: false as const, error: priced.error };

  const row = await prisma.collabShipment.create({
    data: {
      shopId: shop.id,
      purpose: input.purpose,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      recipientEmail: input.recipientEmail,
      recipientHandle: input.recipientHandle,
      platform: input.platform,
      campaign: input.campaign,
      notes: input.notes,
      address: input.address as never,
      items: priced.items as never,
      retailValuePaise: priced.retailValuePaise,
      productCostPaise: priced.productCostPaise,
      weightGrams: input.weightGrams,
      deliverableStatus: expectsContent(input.purpose) ? "PENDING" : "NOT_NEEDED",
    },
  });

  try {
    const created = await gql<{ draftOrderCreate?: { draftOrder?: { id?: string } | null; userErrors?: UserError[] } }>(shop)(
      `mutation CollabDraft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } } }`,
      { input: buildCollabDraftOrderInput(row.id, input) },
    );
    const draftId = created.draftOrderCreate?.draftOrder?.id;
    if (!draftId) throw new Error(userErrors(created.draftOrderCreate?.userErrors) || "Shopify did not create the order.");
    const completed = await gql<{ draftOrderComplete?: { draftOrder?: { order?: { id?: string; name?: string } | null } | null; userErrors?: UserError[] } }>(shop)(
      `mutation CollabComplete($id: ID!) { draftOrderComplete(id: $id, paymentPending: false) { draftOrder { order { id name } } userErrors { field message } } }`,
      { id: draftId },
    );
    const order = completed.draftOrderComplete?.draftOrder?.order;
    if (!order?.id) throw new Error(userErrors(completed.draftOrderComplete?.userErrors) || "Shopify did not complete the order.");
    await prisma.collabShipment.update({ where: { id: row.id }, data: { status: "ORDER_CREATED", shopifyOrderId: order.id, shopifyOrderName: order.name || null, errorMessage: null } });
    await audit(shop.id, row.id, "collab.order.created", { shopifyOrderId: order.id, shopifyOrderName: order.name, retailValuePaise: priced.retailValuePaise, productCostPaise: priced.productCostPaise, items: priced.items });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Shopify order failed.";
    await prisma.collabShipment.update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } });
    return { ok: false as const, error: `Shopify order not created: ${message}`, id: row.id };
  }

  const booked = await bookCollabShipment(shop, row.id, { notifyRecipient: input.notifyRecipient });
  return { ok: true as const, id: row.id, warnings: priced.warnings, booking: booked };
}

export async function bookCollabShipment(shop: Shop, id: string, opts: { notifyRecipient?: boolean } = {}) {
  const row = await prisma.collabShipment.findFirst({ where: { id, shopId: shop.id } });
  if (!row?.shopifyOrderId) return { ok: false as const, error: "This parcel has no Shopify order yet." };
  if (row.awb) return { ok: true as const, awb: row.awb };
  const runtime = await resolveDelhiveryRuntimeConfig(shop.id);
  if (!runtime.configured) {
    await prisma.collabShipment.update({ where: { id }, data: { errorMessage: runtime.reason } });
    return { ok: false as const, error: runtime.reason };
  }
  const [result] = await bookOrderShipments({
    db: prisma as unknown as OrderShipmentDb,
    shopId: shop.id,
    orderIds: [row.shopifyOrderId],
    runtime,
    graphql: (query, variables) => adminGraphql(query, variables, { shopDomain: shop.shopDomain }),
    options: normalizeCreateOptions({ weightGrams: row.weightGrams ?? 500, markFulfilled: true, notifyCustomer: opts.notifyRecipient === true }),
    declaredValuePaise: { [row.shopifyOrderId]: row.retailValuePaise },
  });
  if (result && (result.outcome === "created" || result.outcome === "already_created") && result.awb) {
    await prisma.collabShipment.update({ where: { id }, data: { status: "BOOKED", awb: result.awb, trackingUrl: result.trackingUrl, trackingStatus: "ORDER_CONFIRMED", trackingUpdatedAt: new Date(), errorMessage: null } });
    await audit(shop.id, id, "collab.delhivery.booked", { awb: result.awb, shopifyOrderId: row.shopifyOrderId });
    return { ok: true as const, awb: result.awb };
  }
  const error = result && "error" in result ? result.error : "Delhivery booking failed.";
  await prisma.collabShipment.update({ where: { id }, data: { errorMessage: `Delhivery: ${error}`.slice(0, 500) } });
  return { ok: false as const, error };
}

type TrackableRow = { id: string; shopId: string; awb: string | null; trackingUrl: string | null; deliveredAt: Date | null };

export async function syncCollabTracking(row: TrackableRow) {
  if (!row.awb) return { ok: false as const, error: "Not booked yet." };
  const { DelhiveryAdapter } = await import("../logistics/delhivery-adapter.ts");
  const snapshot = await new DelhiveryAdapter(await resolveDelhiveryRuntimeConfig(row.shopId)).fetchTracking({ awb: row.awb });
  if (!snapshot) return { ok: false as const, error: "Delhivery is not set up." };
  const data = trackingUpdate(snapshot, row);
  await prisma.collabShipment.update({ where: { id: row.id }, data });
  return { ok: true as const, status: data.trackingStatus };
}

// Cron: parcels still on the way, least recently checked first.
export async function syncOpenCollabTracking(limit = 25) {
  const rows = await prisma.collabShipment.findMany({
    where: { awb: { not: null }, OR: [{ trackingStatus: null }, { trackingStatus: { notIn: ["DELIVERED", "RTO_DELIVERED", "CANCELLED"] } }] },
    select: { id: true, shopId: true, awb: true, trackingUrl: true, deliveredAt: true, trackingStatus: true },
    orderBy: { trackingUpdatedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    if (isTrackingDone(row.trackingStatus)) continue;
    try {
      const result = await syncCollabTracking(row);
      if (result.ok) synced += 1; else failed += 1;
    } catch (error) {
      failed += 1;
      console.error("[COLLAB TRACKING] sync_failed", { id: row.id, message: error instanceof Error ? error.message : String(error) });
      await prisma.collabShipment.update({ where: { id: row.id }, data: { trackingUpdatedAt: new Date() } }).catch(() => {});
    }
  }
  return { checked: rows.length, synced, failed };
}
