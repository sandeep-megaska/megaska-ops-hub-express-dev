// Server-only: creates and fulfils the Shopify order for an exchange replacement
// (rules in replacement-order.ts).
import { prisma } from "../db/prisma.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { buildReplacementDraftOrder, pickSizeVariant, replacementChargePaise, type ReplacementLine, type SizeVariant } from "./replacement-order.ts";

type Shop = { id: string; shopDomain: string };
type Address = { name: string; phone: string; address1: string; address2: string; city: string; state: string; pin: string; email?: string | null };
type UserError = { message?: string | null };

const PENDING = "pending";
const LINES_QUERY = `query ReplacementLines($id: ID!) { order(id: $id) { customer { id } lineItems(first: 100) { nodes { id variant { id selectedOptions { name value } product { variants(first: 100) { nodes { id sku price inventoryQuantity inventoryPolicy selectedOptions { name value } } } } } } } } }`;
const VARIANT_PRICES_QUERY = `query ReplacementPrices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price } } }`;

type LineNode = { id: string; variant?: { id: string; selectedOptions?: Array<{ name: string; value: string }>; product?: { variants?: { nodes?: Array<SizeVariant & { inventoryPolicy?: string | null }> } } } | null };

function errors(list: UserError[] | null | undefined) {
  return (list || []).map((error) => error.message).filter(Boolean).join("; ");
}

export class ReplacementOrderError extends Error {}

// Creates the order once (idempotent). Returns its id and name.
export async function ensureReplacementOrder(shop: Shop, requestId: string, address: Address) {
  const request = await prisma.orderActionRequest.findFirst({ where: { id: requestId, shopId: shop.id, requestType: "EXCHANGE" }, include: { items: true } });
  if (!request) throw new ReplacementOrderError("Exchange not found.");
  if (request.replacementShopifyOrderId && request.replacementShopifyOrderId !== PENDING) return { id: request.replacementShopifyOrderId, name: request.replacementShopifyOrderName };
  if (!request.shopifyOrderId) throw new ReplacementOrderError("This exchange isn't linked to its Shopify order, so the replacement order can't be created.");

  // Claim, so a double click or a retry can't create two orders.
  const claimed = await prisma.orderActionRequest.updateMany({ where: { id: request.id, replacementShopifyOrderId: null }, data: { replacementShopifyOrderId: PENDING } });
  if (!claimed.count) throw new ReplacementOrderError("The replacement order is already being created. Refresh in a moment.");

  try {
    const graphql = <T,>(query: string, variables: Record<string, unknown>) => adminGraphql<T>(query, variables, { shopDomain: shop.shopDomain });
    const original = await graphql<{ order?: { customer?: { id?: string } | null; lineItems?: { nodes?: LineNode[] } } | null }>(LINES_QUERY, { id: request.shopifyOrderId });
    const lineNodes = original.order?.lineItems?.nodes || [];
    const lines: ReplacementLine[] = [];
    const styleIds = request.items.filter((item) => item.replacementVariantId).map((item) => item.replacementVariantId as string);
    const prices = styleIds.length ? await graphql<{ nodes?: Array<{ id?: string; price?: string }> }>(VARIANT_PRICES_QUERY, { ids: styleIds }) : { nodes: [] };
    for (const item of request.items) {
      if (item.replacementVariantId) {
        const price = (prices.nodes || []).find((node) => node?.id === item.replacementVariantId)?.price;
        lines.push({ variantId: item.replacementVariantId, quantity: item.quantity, unitPricePaise: Math.round(Number(price ?? (item.replacementUnitPricePaise ?? 0) / 100) * 100) });
        continue;
      }
      const line = lineNodes.find((node) => node.id === item.shopifyLineItemId);
      const variant = line?.variant ? pickSizeVariant(line.variant.selectedOptions ?? [], line.variant.product?.variants?.nodes ?? [], item.requestedSize) : null;
      if (!variant) throw new ReplacementOrderError(`Couldn't find size ${item.requestedSize} of ${item.productTitle} in Shopify. Pick it with "Exchange for a different style", then try again.`);
      lines.push({ variantId: variant.id, quantity: item.quantity, unitPricePaise: Math.round(Number(variant.price ?? 0) * 100) });
    }

    const input = buildReplacementDraftOrder({
      requestId: request.id,
      orderNumber: request.orderNumber,
      lines,
      chargePaise: replacementChargePaise(request),
      address,
      customerGid: original.order?.customer?.id ?? null,
      email: request.customerEmailSnapshot,
    });
    const created = await graphql<{ draftOrderCreate?: { draftOrder?: { id?: string } | null; userErrors?: UserError[] } }>(
      `mutation ReplacementDraft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } } }`, { input });
    const draftId = created.draftOrderCreate?.draftOrder?.id;
    if (!draftId) throw new ReplacementOrderError(`Shopify didn't create the replacement order: ${errors(created.draftOrderCreate?.userErrors) || "no reason given"}`);
    const completed = await graphql<{ draftOrderComplete?: { draftOrder?: { order?: { id?: string; name?: string } | null } | null; userErrors?: UserError[] } }>(
      `mutation ReplacementComplete($id: ID!) { draftOrderComplete(id: $id, paymentPending: false) { draftOrder { order { id name } } userErrors { field message } } }`, { id: draftId });
    const order = completed.draftOrderComplete?.draftOrder?.order;
    if (!order?.id) throw new ReplacementOrderError(`Shopify didn't complete the replacement order: ${errors(completed.draftOrderComplete?.userErrors) || "no reason given"}`);

    await prisma.orderActionRequest.update({ where: { id: request.id }, data: { replacementShopifyOrderId: order.id, replacementShopifyOrderName: order.name ?? null } });
    await prisma.auditEvent.create({ data: { actorType: "admin", eventType: "exchange.replacement_order.created", entityType: "OrderActionRequest", entityId: request.id, payload: { shopId: shop.id, shopifyOrderId: order.id, shopifyOrderName: order.name, chargePaise: replacementChargePaise(request), lines } as never } });
    return { id: order.id, name: order.name ?? null };
  } catch (error) {
    await prisma.orderActionRequest.update({ where: { id: request.id }, data: { replacementShopifyOrderId: null } }).catch(() => undefined);
    throw error instanceof ReplacementOrderError ? error : new ReplacementOrderError(error instanceof Error ? error.message : "Shopify replacement order failed.");
  }
}

// Marks the replacement order shipped with the AWB (best-effort; the booking stands).
export async function fulfillReplacementOrder(shop: Shop, requestId: string, awb: string, trackingUrl: string | null) {
  const request = await prisma.orderActionRequest.findFirst({ where: { id: requestId, shopId: shop.id }, select: { replacementShopifyOrderId: true } });
  const orderId = request?.replacementShopifyOrderId;
  if (!orderId || orderId === PENDING) return { ok: false as const, reason: "no-order" };
  try {
    const { fulfillOrderWithTracking } = await import("../logistics/shopify-fulfillment.ts");
    // The customer already gets the exchange update on WhatsApp/email.
    const outcome = await fulfillOrderWithTracking({ graphql: (query, variables) => adminGraphql(query, variables, { shopDomain: shop.shopDomain }), orderId, awb, trackingUrl, notifyCustomer: false });
    return { ok: true as const, outcome: outcome.outcome };
  } catch (error) {
    console.error("[EXCHANGE REPLACEMENT ORDER] fulfill_failed", { requestId, error: error instanceof Error ? error.message : String(error) });
    return { ok: false as const, reason: error instanceof Error ? error.message : "fulfil failed" };
  }
}
