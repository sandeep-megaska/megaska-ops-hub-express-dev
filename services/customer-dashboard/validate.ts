import { CustomerDashboardError } from "./errors.ts";
import type { CustomerDashboardDtoV1 } from "./contract.ts";

const actionStates = new Set(["AVAILABLE", "LOCKED", "OPEN", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED", "NOT_APPLICABLE"]);
const trackingSources = new Set(["LOOPDESK_SHIPMENT", "SHOPIFY_FULFILLMENT", "NONE"]);
const shipmentDirections = new Set(["FORWARD", "REVERSE_PICKUP", "REPLACEMENT"]);
const walletDirections = new Set(["CREDIT", "DEBIT"]);

function fail(path: string): never {
  throw new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "We could not load your dashboard right now. Please try again.", status: 503, retryable: true, cause: new Error(`Invalid customer dashboard DTO at ${path}`) });
}
function object(value: unknown, path: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(path); return value as Record<string, unknown>; }
function string(value: unknown, path: string) { if (typeof value !== "string") fail(path); }
function nullableString(value: unknown, path: string) { if (value !== null && typeof value !== "string") fail(path); }
function iso(value: unknown, path: string) { string(value, path); const d = new Date(value as string); if (Number.isNaN(d.getTime()) || d.toISOString() !== value) fail(path); }
function nullableIso(value: unknown, path: string) { if (value !== null) iso(value, path); }
function money(value: unknown, path: string) { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(path); }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) fail(path); return value; }
function bool(value: unknown, path: string) { if (typeof value !== "boolean") fail(path); }
function scan(value: unknown, seen = new Set<object>()) {
  if (typeof value === "bigint" || typeof value === "function" || value instanceof Date) fail("nonJsonValue");
  if (value && typeof value === "object") { if (seen.has(value)) fail("circular"); seen.add(value); for (const v of Object.values(value)) scan(v, seen); seen.delete(value); }
}

export function validateCustomerDashboardV1(value: unknown): asserts value is CustomerDashboardDtoV1 {
  scan(value);
  const root = object(value, "root");
  if (root.version !== "dashboard.v1") fail("version");
  iso(root.generatedAt, "generatedAt");
  const customer = object(root.customer, "customer");
  string(customer.id, "customer.id"); string(customer.displayName, "customer.displayName"); string(customer.initials, "customer.initials"); string(customer.phone, "customer.phone"); bool(customer.phoneVerified, "customer.phoneVerified"); nullableString(customer.firstName, "customer.firstName"); nullableString(customer.lastName, "customer.lastName"); nullableString(customer.email, "customer.email"); nullableString(customer.shopifyCustomerId, "customer.shopifyCustomerId");
  const summary = object(root.summary, "summary");
  money(summary.totalOrders, "summary.totalOrders"); money(summary.openRequests, "summary.openRequests"); money(summary.savedAddresses, "summary.savedAddresses"); money(summary.storeCreditAvailablePaise, "summary.storeCreditAvailablePaise"); string(summary.currency, "summary.currency");
  const shop = object(root.shop, "shop"); string(shop.id, "shop.id"); string(shop.domain, "shop.domain"); string(shop.currency, "shop.currency"); nullableString(shop.name, "shop.name");
  const modules = object(root.modules, "modules"); for (const key of ["wallet", "cancellation", "exchange", "issueReporting", "shipmentTracking", "partialCod", "loyalty", "memberships", "referrals"]) bool(modules[key], `modules.${key}`);
  if (root.wallet !== null) { const wallet = object(root.wallet, "wallet"); bool(wallet.enabled, "wallet.enabled"); string(wallet.currency, "wallet.currency"); for (const key of ["balancePaise", "reservedPaise", "availablePaise", "pendingRefundPaise"]) money(wallet[key], `wallet.${key}`); array(wallet.transactions, "wallet.transactions").forEach((tx, i) => { const t = object(tx, `wallet.transactions.${i}`); string(t.id, `wallet.transactions.${i}.id`); if (!walletDirections.has(t.direction as string)) fail(`wallet.transactions.${i}.direction`); money(t.amountPaise, `wallet.transactions.${i}.amountPaise`); string(t.currency, `wallet.transactions.${i}.currency`); string(t.reason, `wallet.transactions.${i}.reason`); nullableString(t.orderNumber, `wallet.transactions.${i}.orderNumber`); iso(t.createdAt, `wallet.transactions.${i}.createdAt`); }); }
  array(root.addresses, "addresses");
  array(root.orders, "orders").forEach((order, i) => { const o = object(order, `orders.${i}`); string(o.id, `orders.${i}.id`); string(o.orderNumber, `orders.${i}.orderNumber`); iso(o.createdAt, `orders.${i}.createdAt`); nullableIso(o.processedAt, `orders.${i}.processedAt`); const amounts = object(o.amounts, `orders.${i}.amounts`); for (const key of ["discountPaise", "shippingPaise", "codFeePaise", "storeCreditAppliedPaise", "totalPaise"]) money(amounts[key], `orders.${i}.amounts.${key}`); const tracking = object(o.tracking, `orders.${i}.tracking`); if (!trackingSources.has(tracking.source as string)) fail(`orders.${i}.tracking.source`); const ts = object(tracking.summary, `orders.${i}.tracking.summary`); nullableIso(ts.lastUpdatedAt, `orders.${i}.tracking.summary.lastUpdatedAt`); array(tracking.shipments, `orders.${i}.tracking.shipments`).forEach((shipment, j) => { const s = object(shipment, `orders.${i}.tracking.shipments.${j}`); if (!shipmentDirections.has(s.direction as string)) fail(`orders.${i}.tracking.shipments.${j}.direction`); nullableString(s.trackingUrl, `orders.${i}.tracking.shipments.${j}.trackingUrl`); nullableIso(s.lastUpdatedAt, `orders.${i}.tracking.shipments.${j}.lastUpdatedAt`); array(s.timeline, `orders.${i}.tracking.shipments.${j}.timeline`).forEach((event, k) => iso(object(event, `orders.${i}.tracking.shipments.${j}.timeline.${k}`).occurredAt, `orders.${i}.tracking.shipments.${j}.timeline.${k}.occurredAt`)); }); const actions = object(o.actions, `orders.${i}.actions`); for (const key of ["cancellation", "exchange", "issue", "refundStatus"]) { const a = object(actions[key], `orders.${i}.actions.${key}`); if (!actionStates.has(a.state as string)) fail(`orders.${i}.actions.${key}.state`); bool(a.available, `orders.${i}.actions.${key}.available`); nullableIso(a.deadlineAt, `orders.${i}.actions.${key}.deadlineAt`); } });
}
