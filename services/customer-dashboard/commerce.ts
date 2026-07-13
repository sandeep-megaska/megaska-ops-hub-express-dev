import type { DashboardCustomerIdentity } from "./customer.ts";
import type { CustomerDashboardContext } from "./context.ts";

export type DashboardCommerceAddress = { firstName: string | null; lastName: string | null; line1: string | null; line2: string | null; city: string | null; stateProvince: string | null; postalCode: string | null; countryRegion: string | null; phone: string | null };
export type DashboardCommerceTrackingInfo = { company: string | null; number: string | null; url: string | null };
export type DashboardCommerceFulfillment = { id: string | null; status: string | null; createdAt: string | null; deliveredAt: string | null; trackingInfo: DashboardCommerceTrackingInfo[] };
export type DashboardCommerceOrderItem = { id: string; shopifyLineItemId: string | null; productId: string | null; variantId: string | null; title: string; variantTitle: string | null; sku: string | null; quantity: number; unitPricePaise: number | null; totalPricePaise: number | null; imageUrl: string | null };
export type DashboardCommerceOrder = { id: string; shopifyOrderId: string | null; orderNumber: string; createdAt: string | null; processedAt: string | null; fulfilledAt: string | null; deliveredAt: string | null; currency: string; totalPaise: number; subtotalPaise: number | null; discountPaise: number; shippingPaise: number; taxPaise: number | null; financialStatus: string; fulfillmentStatus: string; items: DashboardCommerceOrderItem[]; fulfillments: DashboardCommerceFulfillment[] };
export type DashboardCommerceSnapshot = { available: boolean; source: "SHOPIFY_ADMIN" | "UNAVAILABLE"; email: string | null; defaultAddress: DashboardCommerceAddress | null; totalOrderCount: number; recentOrders: DashboardCommerceOrder[]; errorCode: string | null };


type CommerceAdapterOrder = {
  id: string; shopifyOrderId?: string | null; numericOrderId?: string | null; name?: string | null; createdAt?: string | null; processedAt?: string | null; deliveredAt?: string | null; closedAt?: string | null; totalAmount?: string | null; subtotalAmount?: string | null; shippingAmount?: string | null; taxAmount?: string | null; currencyCode?: string | null; financialStatus?: string | null; fulfillmentStatus?: string | null; fulfillments?: Array<{ id?: string | null; status?: string | null; createdAt?: string | null; deliveredAt?: string | null; trackingInfo?: Array<{ company?: string | null; number?: string | null; url?: string | null }> | null }> | null; lineItems?: Array<{ id: string; shopifyLineItemId?: string | null; productId?: string | null; variantId?: string | null; title?: string | null; variantTitle?: string | null; sku?: string | null; quantity?: number | null; unitPrice?: string | null; discountedTotal?: string | null; image?: string | null }> | null;
};
type MegaskaCustomerDashboardData = { email: string | null; phone: string | null; defaultAddress: Record<string, string | null | undefined> | null; totalOrderCount: number; recentOrders: CommerceAdapterOrder[]; matchSource: "customer_id" | "order_search" | "none" };
type CommerceDependencies = { isShopifyAdminConfigured: () => boolean | Promise<boolean>; getMegaskaCustomerDashboardData: (input: { shopDomain?: string | null; customerId?: string | null; email?: string | null; phoneE164?: string | null }) => Promise<MegaskaCustomerDashboardData | null>; logger: Pick<Console, "warn"> };
const defaultDependencies: CommerceDependencies = { isShopifyAdminConfigured: async () => { const mod = await import("../shopify/admin.ts"); return mod.isShopifyAdminConfigured(); }, getMegaskaCustomerDashboardData: async (input) => { const mod = await import("../shopify/dashboard.ts"); return mod.getMegaskaCustomerDashboardData(input); }, logger: console };
let dependencies = defaultDependencies;
export function setDashboardCommerceDependenciesForTest(overrides: Partial<CommerceDependencies>) { dependencies = { ...dependencies, ...overrides }; }
export function resetDashboardCommerceDependenciesForTest() { dependencies = defaultDependencies; }

function unavailable(errorCode: string): DashboardCommerceSnapshot { return { available: false, source: "UNAVAILABLE", email: null, defaultAddress: null, totalOrderCount: 0, recentOrders: [], errorCode }; }
function clean(value: unknown) { const trimmed = String(value ?? "").trim(); return trimmed || null; }
export function moneyToPaise(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`Invalid money amount: ${raw}`);
  const sign = raw.startsWith("-") ? -1 : 1;
  const unsigned = raw.replace(/^-/, "");
  const [rupees, paise = ""] = unsigned.split(".");
  return sign * (Number(rupees) * 100 + Number(paise.padEnd(2, "0")));
}
function normalizeAddress(address: NonNullable<MegaskaCustomerDashboardData["defaultAddress"]> | null | undefined): DashboardCommerceAddress | null {
  if (!address) return null;
  return { firstName: clean(address.firstName), lastName: clean(address.lastName), line1: clean(address.address1), line2: clean(address.address2), city: clean(address.city), stateProvince: clean(address.province) || clean(address.provinceCode), postalCode: clean(address.zip), countryRegion: clean(address.country) || clean(address.countryCodeV2), phone: clean(address.phone) };
}

export function normalizeDashboardCommerceData(data: MegaskaCustomerDashboardData): DashboardCommerceSnapshot {
  return { available: true, source: "SHOPIFY_ADMIN", email: clean(data.email), defaultAddress: normalizeAddress(data.defaultAddress), totalOrderCount: Number(data.totalOrderCount || 0), errorCode: null, recentOrders: (data.recentOrders || []).map((order) => {
    const currency = clean(order.currencyCode) || "INR";
    const fulfillments = (order.fulfillments || []).map((fulfillment) => ({ id: clean(fulfillment?.id), status: clean(fulfillment?.status), createdAt: clean(fulfillment?.createdAt), deliveredAt: clean(fulfillment?.deliveredAt), trackingInfo: (fulfillment?.trackingInfo || []).map((tracking) => ({ company: clean(tracking?.company), number: clean(tracking?.number), url: clean(tracking?.url) })) }));
    return { id: order.id, shopifyOrderId: clean(order.shopifyOrderId), orderNumber: clean(order.name) || clean(order.numericOrderId) || order.id, createdAt: clean(order.createdAt), processedAt: clean(order.processedAt), fulfilledAt: fulfillments.find((f) => f.status === "SUCCESS" || f.status === "FULFILLED")?.createdAt || clean(order.closedAt), deliveredAt: clean(order.deliveredAt), currency, totalPaise: moneyToPaise(order.totalAmount) ?? 0, subtotalPaise: moneyToPaise(order.subtotalAmount), discountPaise: 0, shippingPaise: moneyToPaise(order.shippingAmount) ?? 0, taxPaise: moneyToPaise(order.taxAmount), financialStatus: clean(order.financialStatus) || "UNKNOWN", fulfillmentStatus: clean(order.fulfillmentStatus) || "UNKNOWN", fulfillments, items: (order.lineItems || []).map((item) => ({ id: item.id, shopifyLineItemId: clean(item.shopifyLineItemId), productId: clean(item.productId), variantId: clean(item.variantId), title: clean(item.title) || "Item", variantTitle: clean(item.variantTitle), sku: clean(item.sku), quantity: Number(item.quantity || 0), unitPricePaise: moneyToPaise(item.unitPrice), totalPricePaise: moneyToPaise(item.discountedTotal), imageUrl: clean(item.image) })) };
  }) };
}

export async function loadDashboardCommerceSnapshot(input: { context: CustomerDashboardContext; customer: DashboardCustomerIdentity }): Promise<DashboardCommerceSnapshot> {
  if (!(await dependencies.isShopifyAdminConfigured())) return unavailable("SHOPIFY_ADMIN_NOT_CONFIGURED");
  try {
    const data = await dependencies.getMegaskaCustomerDashboardData({ shopDomain: input.context.shopDomain, customerId: input.customer.shopifyCustomerId, email: input.customer.email, phoneE164: input.customer.phoneE164 });
    if (!data || data.matchSource === "none") return unavailable("SHOPIFY_CUSTOMER_NOT_RESOLVED");
    return normalizeDashboardCommerceData(data);
  } catch (error) {
    dependencies.logger.warn("[CUSTOMER DASHBOARD] Shopify commerce load failed", { shopId: input.context.shopId, customerProfileId: input.customer.customerProfileId, error: error instanceof Error ? error.message : String(error) });
    return unavailable("SHOPIFY_COMMERCE_UNAVAILABLE");
  }
}
