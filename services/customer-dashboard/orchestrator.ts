import { buildDashboardOrderDto } from "./orders.ts";
import { buildDashboardShopDto } from "./shop.ts";
import { CUSTOMER_DASHBOARD_CONTRACT_VERSION, type CustomerDashboardDtoV1, type DashboardAddressDto, type DashboardModulesDto } from "./contract.ts";
import { loadDashboardOrderRequests, type DashboardOrderRequestAggregation, type DashboardOrderRequestSnapshot } from "./requests.ts";
import { buildShopifyFallbackTracking, loadDashboardTrackingSnapshots, selectDashboardTracking, type DashboardTrackingSnapshotMap } from "./tracking.ts";
import { buildDashboardWalletDto, loadDashboardWalletSnapshot, type DashboardWalletSnapshot } from "./wallet.ts";
import { buildDashboardCustomerDto, resolveDashboardCustomerIdentity, type DashboardCustomerIdentity } from "./customer.ts";
import { loadDashboardCommerceSnapshot, type DashboardCommerceOrder, type DashboardCommerceSnapshot, type DashboardCommerceAddress } from "./commerce.ts";
import type { CustomerDashboardContext } from "./context.ts";
import { loadDashboardModules } from "./modules.ts";
import { CustomerDashboardError } from "./errors.ts";

export type CustomerDashboardDependencies = { loadCustomer: (context: CustomerDashboardContext) => Promise<DashboardCustomerIdentity>; loadCommerce: (input: { context: CustomerDashboardContext; customer: DashboardCustomerIdentity }) => Promise<DashboardCommerceSnapshot>; loadRequests: (input: { context: CustomerDashboardContext; orderNumbers: string[] }) => Promise<DashboardOrderRequestAggregation>; loadTracking: (input: { context: CustomerDashboardContext; orders: DashboardCommerceOrder[] }) => Promise<DashboardTrackingSnapshotMap>; loadWallet: (input: { context: CustomerDashboardContext; enabled: boolean; currency?: string }) => Promise<DashboardWalletSnapshot | null>; loadModules: (context: CustomerDashboardContext) => Promise<DashboardModulesDto>; logger: Pick<Console, "info" | "warn" | "error"> };
const defaultDependencies: CustomerDashboardDependencies = { loadCustomer: resolveDashboardCustomerIdentity, loadCommerce: loadDashboardCommerceSnapshot, loadRequests: loadDashboardOrderRequests, loadTracking: loadDashboardTrackingSnapshots, loadWallet: loadDashboardWalletSnapshot, loadModules: loadDashboardModules, logger: console };
const emptyRequests = (): DashboardOrderRequestSnapshot => ({ cancellation: null, exchange: null, issue: null, activeConflict: null });
const normalize = (n: string) => String(n || "").trim().replace(/^#/, "").toUpperCase();
const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
function addressFromCommerce(a: DashboardCommerceAddress | null): DashboardAddressDto[] { if (!a?.line1 || !a.city || !a.postalCode || !a.countryRegion) return []; return [{ id: `shopify-default-${Buffer.from([a.line1, a.postalCode].join("|")).toString("base64url").slice(0, 16)}`, type: "DEFAULT", firstName: a.firstName, lastName: a.lastName, company: null, line1: a.line1, line2: a.line2, city: a.city, state: a.stateProvince, postalCode: a.postalCode, country: a.countryRegion, phone: a.phone, isDefault: true, source: "SHOPIFY" }]; }
function addressFromCustomer(c: DashboardCustomerIdentity): DashboardAddressDto[] { const a = c.address; if (!a.line1 || !a.city || !a.postalCode || !a.countryRegion) return []; return [{ id: `loopdesk-default-${c.customerProfileId}`, type: "DEFAULT", firstName: c.firstName, lastName: c.lastName, company: null, line1: a.line1, line2: a.line2, city: a.city, state: a.stateProvince, postalCode: a.postalCode, country: a.countryRegion, phone: c.phoneE164, isDefault: true, source: "LOOPDESK" }]; }
export async function getCustomerDashboardV1(context: CustomerDashboardContext, dependencies?: Partial<CustomerDashboardDependencies>): Promise<CustomerDashboardDtoV1> {
  const deps = { ...defaultDependencies, ...dependencies };
  const started = Date.now();
  deps.logger.info("customer_dashboard_v1_start", { shopId: context.shopId, customerProfileId: context.customerProfileId });
  try {
    const modules = await deps.loadModules(context);
    const customer = await deps.loadCustomer(context);
    const commerce = await deps.loadCommerce({ context, customer });
    if (!commerce.available) deps.logger.warn("customer_dashboard_v1_shopify_unavailable", { shopId: context.shopId, customerProfileId: context.customerProfileId, errorCode: commerce.errorCode });
    const orders = commerce.recentOrders || [];
    const orderNumbers = orders.map((o) => normalize(o.orderNumber)).filter(Boolean);
    const currency = clean(orders[0]?.currency) || "INR";
    const [requests, tracking, walletSnapshot] = await Promise.all([deps.loadRequests({ context, orderNumbers }), deps.loadTracking({ context, orders }), deps.loadWallet({ context, enabled: modules.wallet, currency })]);
    const wallet = walletSnapshot ? buildDashboardWalletDto(walletSnapshot) : null;
    const addresses = addressFromCommerce(commerce.defaultAddress).length ? addressFromCommerce(commerce.defaultAddress) : addressFromCustomer(customer);
    const dashboardOrders = orders.map((order) => { const key = normalize(order.orderNumber); const selected = selectDashboardTracking({ internalTracking: tracking.get(key) || null, shopifyFallback: buildShopifyFallbackTracking(order) }); return buildDashboardOrderDto({ order, requests: requests.byOrderNumber.get(key) || emptyRequests(), tracking: selected, modules, now: context.now }); });
    const summaryCurrency = wallet?.currency || dashboardOrders[0]?.currency || currency;
    const dto: CustomerDashboardDtoV1 = { version: CUSTOMER_DASHBOARD_CONTRACT_VERSION, generatedAt: context.now.toISOString(), shop: buildDashboardShopDto({ context, commerce, currency: summaryCurrency }), customer: buildDashboardCustomerDto(customer, commerce.email), summary: { totalOrders: commerce.totalOrderCount, openRequests: requests.openRequestCount, savedAddresses: addresses.length, storeCreditAvailablePaise: wallet?.availablePaise || 0, currency: summaryCurrency }, wallet: modules.wallet ? wallet : null, addresses, orders: dashboardOrders, modules };
    deps.logger.info("customer_dashboard_v1_success", { shopId: context.shopId, customerProfileId: context.customerProfileId, orderCount: orders.length, durationMs: Date.now() - started });
    deps.logger.info("customer_dashboard_v1_duration_ms", { shopId: context.shopId, customerProfileId: context.customerProfileId, durationMs: Date.now() - started });
    return JSON.parse(JSON.stringify(dto)) as CustomerDashboardDtoV1;
  } catch (error) {
    deps.logger.error("customer_dashboard_v1_failure", { shopId: context.shopId, customerProfileId: context.customerProfileId, durationMs: Date.now() - started, errorCode: error instanceof CustomerDashboardError ? error.code : "DASHBOARD_UNAVAILABLE" });
    if (error instanceof CustomerDashboardError) throw error;
    throw new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "We could not load your dashboard right now. Please try again.", status: 503, retryable: true, cause: error });
  }
}
