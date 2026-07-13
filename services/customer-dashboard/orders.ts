import { buildDashboardOrderActions } from "./actions.ts";
import type { DashboardCommerceOrder } from "./commerce.ts";
import type { DashboardModulesDto, DashboardOrderDto, DashboardPaymentSummaryDto } from "./contract.ts";
import { buildDashboardOrderRequestsDto, type DashboardOrderRequestSnapshot } from "./requests.ts";
import { buildFinancialStatusDto, buildFulfillmentStatusDto } from "./status.ts";
import { buildDashboardTrackingDto, findTrustedDeliveredAt, type DashboardTrackingSnapshot } from "./tracking.ts";

export type DashboardPartialCodSnapshot = { method?: string | null; prepaidPaidPaise?: number | null; codAdvancePaidPaise?: number | null; codBalancePaise?: number | null; storeCreditAppliedPaise?: number | null };
const int = (v: unknown) => Number.isSafeInteger(Number(v)) ? Number(v) : 0;
const iso = (v: string | Date | null | undefined) => v ? new Date(v).toISOString() : null;
function payment(order: DashboardCommerceOrder, partialCod: DashboardPartialCodSnapshot | null | undefined): DashboardPaymentSummaryDto {
  const currency = order.currency || "INR";
  const store = int(partialCod?.storeCreditAppliedPaise);
  const advance = int(partialCod?.codAdvancePaidPaise);
  const balance = int(partialCod?.codBalancePaise);
  let method: DashboardPaymentSummaryDto["method"] = "UNKNOWN";
  const raw = String(partialCod?.method || order.financialStatus || "").toUpperCase();
  if (advance > 0 || balance > 0 || raw.includes("PARTIAL_COD")) method = "PARTIAL_COD";
  else if (store > 0 && order.totalPaise === store) method = "STORE_CREDIT";
  else if (store > 0) method = "MIXED";
  else if (["PAID", "AUTHORIZED", "PARTIALLY_PAID"].includes(raw)) method = "PREPAID";
  return { method, status: String(order.financialStatus || "UNKNOWN").toUpperCase(), prepaidPaidPaise: method === "PREPAID" ? order.totalPaise : int(partialCod?.prepaidPaidPaise), codAdvancePaidPaise: advance, codBalancePaise: balance, storeCreditAppliedPaise: store, currency };
}
export function buildDashboardOrderDto(input: { order: DashboardCommerceOrder; requests: DashboardOrderRequestSnapshot; tracking: DashboardTrackingSnapshot; modules: DashboardModulesDto; now: Date; partialCod?: DashboardPartialCodSnapshot | null }): DashboardOrderDto {
  const { order, requests, tracking, modules, now } = input;
  const trustedDeliveredAt = findTrustedDeliveredAt({ shopifyDeliveredAt: order.deliveredAt, tracking });
  const actions = buildDashboardOrderActions({ now, fulfillmentStatus: order.fulfillmentStatus, fulfilledAt: order.fulfilledAt, deliveredAt: order.deliveredAt, trackingDeliveredAt: trustedDeliveredAt, requests, modules });
  return { id: order.id, shopifyOrderId: order.shopifyOrderId, orderNumber: order.orderNumber, createdAt: iso(order.createdAt) || new Date(0).toISOString(), processedAt: iso(order.processedAt), currency: order.currency || "INR", amounts: { subtotalPaise: order.subtotalPaise, discountPaise: int(order.discountPaise), shippingPaise: int(order.shippingPaise), taxPaise: order.taxPaise, codFeePaise: 0, storeCreditAppliedPaise: int(input.partialCod?.storeCreditAppliedPaise), totalPaise: int(order.totalPaise) }, financialStatus: buildFinancialStatusDto(order.financialStatus), fulfillmentStatus: buildFulfillmentStatusDto(order.fulfillmentStatus), itemCount: order.items.reduce((sum, item) => sum + int(item.quantity), 0), items: order.items.map((item) => ({ id: item.id, productId: item.productId, variantId: item.variantId, title: item.title, variantTitle: item.variantTitle, sku: item.sku, quantity: int(item.quantity), unitPricePaise: int(item.unitPricePaise), totalPricePaise: int(item.totalPricePaise), imageUrl: item.imageUrl, productUrl: null })), tracking: buildDashboardTrackingDto(tracking), actions, requests: buildDashboardOrderRequestsDto(requests), payment: payment(order, input.partialCod) };
}
