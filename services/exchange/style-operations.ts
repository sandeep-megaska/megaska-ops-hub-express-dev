// Server-only: choosing a different style for an exchange item and settling the
// price difference (rules in style-exchange.ts).
import { prisma } from "../db/prisma.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { VARIANTS_BY_ID_QUERY, variantView, type ShopifyVariantNode } from "../collab/collab-shipments.ts";
import { amountToPaise, isSettlementAllowed, styleChangeBlocker, styleDifferencePaise, type StyleSettlement } from "./style-exchange.ts";

type Shop = { id: string; shopDomain: string };

const ORDER_LINES_QUERY = `query ExchangeOrderLines($id: ID!) { order(id: $id) { lineItems(first: 100) { nodes { id discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } } originalUnitPriceSet { shopMoney { amount } } } } } }`;

async function loadRequest(shopId: string, id: string) {
  return prisma.orderActionRequest.findFirst({ where: { id, shopId, requestType: "EXCHANGE" }, include: { items: true, shipments: true, payments: { where: { purpose: "STYLE_DIFFERENCE" }, orderBy: { createdAt: "desc" } } } });
}

type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

function blocker(request: LoadedRequest) {
  return styleChangeBlocker({
    status: request.status,
    styleSettledAt: request.styleSettledAt,
    forwardAwb: request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT")?.awb ?? null,
    stylePaymentPaid: request.payments.some((payment) => payment.status === "PAID" && payment.amount === request.styleDifferencePaise),
  });
}

async function audit(shopId: string, requestId: string, eventType: string, payload: Record<string, unknown>) {
  await prisma.auditEvent.create({ data: { actorType: "admin", eventType, entityType: "OrderActionRequest", entityId: requestId, payload: { shopId, ...payload } as never } }).catch(() => {});
}

// Unpaid difference links from an earlier choice no longer apply.
async function supersedeOpenLinks(request: LoadedRequest) {
  const open = request.payments.filter((payment) => payment.status !== "PAID" && payment.status !== "CANCELLED");
  if (open.length) await prisma.requestPayment.updateMany({ where: { id: { in: open.map((payment) => payment.id) } }, data: { status: "CANCELLED" } });
}

// variantId null puts the item back to the same product (size-only exchange).
export async function setStyle(shop: Shop, requestId: string, itemId: string, variantId: string | null) {
  const request = await loadRequest(shop.id, requestId);
  if (!request) return { ok: false as const, status: 404, error: "Not found" };
  const blocked = blocker(request);
  if (blocked) return { ok: false as const, status: 409, error: blocked };
  const item = request.items.find((row) => row.id === itemId);
  if (!item) return { ok: false as const, status: 404, error: "Item not found on this exchange." };

  let data: Record<string, unknown> = { replacementVariantId: null, replacementTitle: null, replacementSku: null, replacementUnitPricePaise: null, originalUnitPricePaise: null };
  if (variantId) {
    if (!variantId.startsWith("gid://shopify/ProductVariant/")) return { ok: false as const, status: 400, error: "Choose a product from the search." };
    if (!request.shopifyOrderId || !item.shopifyLineItemId) return { ok: false as const, status: 422, error: "This exchange isn't linked to its Shopify order line, so the price paid can't be read." };
    const graphql = <T,>(query: string, variables: Record<string, unknown>) => adminGraphql<T>(query, variables, { shopDomain: shop.shopDomain });
    const [variants, order] = await Promise.all([
      graphql<{ nodes?: ShopifyVariantNode[] }>(VARIANTS_BY_ID_QUERY, { ids: [variantId] }),
      graphql<{ order?: { lineItems?: { nodes?: Array<{ id: string; discountedUnitPriceAfterAllDiscountsSet?: { shopMoney?: { amount?: string } }; originalUnitPriceSet?: { shopMoney?: { amount?: string } } }> } } | null }>(ORDER_LINES_QUERY, { id: request.shopifyOrderId }),
    ]);
    const node = (variants.nodes || []).find((row) => row?.id === variantId);
    if (!node) return { ok: false as const, status: 404, error: "That product wasn't found in Shopify." };
    const view = variantView(node);
    if (view.available !== null && view.available < item.quantity && String(node.inventoryPolicy || "").toUpperCase() !== "CONTINUE") return { ok: false as const, status: 422, error: `${view.title}: only ${Math.max(0, view.available)} in stock.` };
    const line = (order.order?.lineItems?.nodes || []).find((row) => row.id === item.shopifyLineItemId);
    const paid = amountToPaise(line?.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount) ?? amountToPaise(line?.originalUnitPriceSet?.shopMoney?.amount);
    if (paid === null) return { ok: false as const, status: 422, error: "Couldn't read what the customer paid for this item in Shopify." };
    data = { replacementVariantId: view.variantId, replacementTitle: view.title.slice(0, 300), replacementSku: view.sku || null, replacementUnitPricePaise: view.unitPricePaise, originalUnitPricePaise: paid };
  }

  await prisma.orderActionItem.update({ where: { id: item.id }, data });
  const items = request.items.map((row) => (row.id === item.id ? { ...row, ...data } : row)) as Array<{ quantity: number; replacementVariantId?: string | null; replacementUnitPricePaise?: number | null; originalUnitPricePaise?: number | null }>;
  const difference = styleDifferencePaise(items);
  await supersedeOpenLinks(request);
  await prisma.orderActionRequest.update({ where: { id: request.id }, data: { styleDifferencePaise: difference, styleSettlement: null, styleSettledAt: null } });
  await audit(shop.id, request.id, variantId ? "exchange.style.changed" : "exchange.style.cleared", { itemId, variantId, ...data, styleDifferencePaise: difference });
  return { ok: true as const, difference };
}

export async function settleStyle(shop: Shop, requestId: string, settlement: string, note: string | null) {
  const request = await loadRequest(shop.id, requestId);
  if (!request) return { ok: false as const, status: 404, error: "Not found" };
  const blocked = blocker(request);
  if (blocked) return { ok: false as const, status: 409, error: blocked };
  const difference = request.styleDifferencePaise ?? null;
  if (!isSettlementAllowed(settlement, difference)) return { ok: false as const, status: 400, error: "That option doesn't fit this price difference." };
  const choice: StyleSettlement = settlement;

  if (choice === "COLLECT") {
    const amount = difference as number;
    await supersedeOpenLinks(request);
    const { createReversePickupPaymentLink } = await import("./razorpay.ts");
    const link = await createReversePickupPaymentLink({
      shopId: shop.id,
      requestId: request.id,
      amount,
      description: `Price difference for the new style, exchange #${request.orderNumber}`,
      customerName: request.customerNameSnapshot,
      customerPhone: request.customerPhoneSnapshot,
      customerEmail: request.customerEmailSnapshot,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await prisma.requestPayment.create({ data: { requestId: request.id, purpose: "STYLE_DIFFERENCE", amount, status: "PENDING", paymentLinkId: link.id, paymentLinkUrl: link.shortUrl, providerReferenceId: link.referenceId, expiresAt: link.expiresAt } });
    await prisma.orderActionRequest.update({ where: { id: request.id }, data: { styleSettlement: "COLLECT" } });
    await audit(shop.id, request.id, "exchange.style.payment_link_created", { amount, paymentLinkId: link.id });
    return { ok: true as const, paymentLinkUrl: link.shortUrl };
  }

  if (choice === "STORE_CREDIT") {
    const amount = Math.abs(difference as number);
    const sourceId = `exchange-style:${request.id}`;
    const existing = await prisma.walletTransaction.findFirst({ where: { sourceType: "ADMIN_MANUAL", sourceId }, select: { id: true } });
    if (!existing) {
      const { applyWalletTransaction } = await import("../wallet.ts");
      const result = await applyWalletTransaction({
        shopId: shop.id,
        customerProfileId: request.customerProfileId,
        amount,
        direction: "CREDIT",
        transactionType: "MANUAL_CREDIT",
        sourceType: "ADMIN_MANUAL",
        sourceId,
        orderNumber: request.orderNumber,
        reason: "Exchange: price difference for a cheaper style",
        adminNote: note || `Exchange #${request.orderNumber} style change`,
        createdByType: "ADMIN",
      });
      // Make it spendable at checkout (Shopify gift card), best-effort as for manual credits.
      try {
        const { projectCreditToGiftCard } = await import("../store-credit/gift-card-projection.ts");
        await projectCreditToGiftCard(result.transaction.id);
      } catch (error) {
        console.error("[EXCHANGE STYLE] gift_card_projection_failed", { requestId: request.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await prisma.orderActionRequest.update({ where: { id: request.id }, data: { styleSettlement: choice, styleSettledAt: new Date() } });
  await audit(shop.id, request.id, "exchange.style.settled", { settlement: choice, styleDifferencePaise: difference, note });
  return { ok: true as const };
}

// Razorpay webhook: the difference was paid.
// An outdated link (the style changed after it was sent) is not taken as settlement:
// the team is told to check.
export async function markStyleDifferencePaid(requestId: string, amountPaise: number) {
  const request = await prisma.orderActionRequest.findUnique({ where: { id: requestId }, select: { id: true, shopId: true, orderNumber: true, styleSettledAt: true, styleDifferencePaise: true } });
  if (!request || request.styleSettledAt) return;
  if (request.styleDifferencePaise !== amountPaise) {
    await prisma.auditEvent.create({ data: { actorType: "system", eventType: "exchange.style.outdated_link_paid", entityType: "OrderActionRequest", entityId: request.id, payload: { shopId: request.shopId, amountPaise, currentDifferencePaise: request.styleDifferencePaise } as never } });
    if (request.shopId) {
      const { sendAdminAlert } = await import("../notifications/resend.ts");
      await sendAdminAlert({ shopId: request.shopId, eventType: "EXCHANGE", subject: `Check exchange #${request.orderNumber}: an old difference link was paid`, text: `The customer paid ₹${(amountPaise / 100).toFixed(2)} on an earlier price-difference link, but the current difference is ₹${((request.styleDifferencePaise ?? 0) / 100).toFixed(2)}. Settle it by hand on the exchange page.` }).catch(() => undefined);
    }
    return;
  }
  await prisma.orderActionRequest.update({ where: { id: request.id }, data: { styleSettlement: "COLLECT", styleSettledAt: new Date() } });
  await prisma.auditEvent.create({ data: { actorType: "system", eventType: "exchange.style.difference_paid", entityType: "OrderActionRequest", entityId: request.id, payload: { shopId: request.shopId } as never } });
  if (request.shopId) {
    const { sendAdminAlert } = await import("../notifications/resend.ts");
    const appBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
    await sendAdminAlert({ shopId: request.shopId, eventType: "EXCHANGE", subject: `Style difference paid: exchange #${request.orderNumber}`, text: [`The customer paid the price difference for the new style on exchange #${request.orderNumber}. The replacement can be booked once the return is in (or cleared to ship early).`, appBaseUrl ? `Exchange: ${appBaseUrl}/admin/exchanges/${encodeURIComponent(request.id)}` : ""].filter(Boolean).join("\n") }).catch(() => undefined);
  }
}
