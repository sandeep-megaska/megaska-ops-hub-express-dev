import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOMER_DASHBOARD_CONTRACT_VERSION } from "./contract.ts";
import type { CustomerDashboardDtoV1 } from "./contract.ts";

function fixture(): CustomerDashboardDtoV1 {
  const action = { type: "CANCELLATION" as const, available: true, state: "AVAILABLE" as const, label: "Cancel", description: null, lockReason: null, deadlineAt: "2026-07-14T00:00:00.000Z", requestId: null };
  return {
    version: CUSTOMER_DASHBOARD_CONTRACT_VERSION,
    generatedAt: "2026-07-13T00:00:00.000Z",
    shop: { id: "shop-1", domain: "example.myshopify.com", name: "Megaska", currency: "INR", support: { email: null, phone: null, whatsapp: null, contactUrl: null }, branding: { accountLabel: "Account", logoUrl: null } },
    customer: { id: "cust-1", firstName: "Asha", lastName: null, displayName: "Asha", initials: "A", phone: "+919999999999", phoneVerified: true, email: null, shopifyCustomerId: null },
    summary: { totalOrders: 1, openRequests: 0, savedAddresses: 1, storeCreditAvailablePaise: 12500, currency: "INR" },
    wallet: { enabled: true, currency: "INR", balancePaise: 12500, reservedPaise: 2500, availablePaise: 10000, pendingRefundPaise: 0, transactions: [{ id: "txn-1", direction: "CREDIT", amountPaise: 12500, currency: "INR", reason: "Refund", orderNumber: "#1001", createdAt: "2026-07-13T00:00:00.000Z" }] },
    addresses: [{ id: "addr-1", type: "DEFAULT", firstName: "Asha", lastName: null, company: null, line1: "Line 1", line2: null, city: "Mumbai", state: "MH", postalCode: "400001", country: "IN", phone: null, isDefault: true, source: "LOOPDESK" }],
    orders: [{ id: "order-1", shopifyOrderId: null, orderNumber: "#1001", createdAt: "2026-07-13T00:00:00.000Z", processedAt: null, currency: "INR", amounts: { subtotalPaise: 100000, discountPaise: 0, shippingPaise: 5000, taxPaise: null, codFeePaise: 0, storeCreditAppliedPaise: 10000, totalPaise: 95000 }, financialStatus: { code: "PAID", label: "Paid", tone: "SUCCESS" }, fulfillmentStatus: { code: "UNFULFILLED", label: "Unfulfilled", tone: "INFO" }, itemCount: 1, items: [{ id: "item-1", productId: null, variantId: null, title: "Shirt", variantTitle: null, sku: null, quantity: 1, unitPricePaise: 100000, totalPricePaise: 100000, imageUrl: null, productUrl: null }], tracking: { available: false, source: "NONE", summary: { statusCode: "NONE", statusLabel: "Not available", lastUpdatedAt: null, message: null }, shipments: [] }, actions: { cancellation: action, exchange: { ...action, type: "EXCHANGE" }, issue: { ...action, type: "ISSUE" }, refundStatus: { ...action, type: "REFUND_STATUS", available: false } }, requests: { cancellation: null, exchange: null, issue: null }, payment: { method: "MIXED", status: "PAID", prepaidPaidPaise: 85000, codAdvancePaidPaise: 0, codBalancePaise: 0, storeCreditAppliedPaise: 10000, currency: "INR" } }],
    modules: { wallet: true, cancellation: true, exchange: true, issueReporting: true, shipmentTracking: true, partialCod: true, loyalty: false, memberships: false, referrals: false },
  };
}

test("contract version is stable", () => assert.equal(CUSTOMER_DASHBOARD_CONTRACT_VERSION, "dashboard.v1"));

test("representative fixture is transport-safe", () => {
  const dto = fixture();
  for (const key of ["version", "generatedAt", "shop", "customer", "summary", "wallet", "addresses", "orders", "modules"]) assert.ok(key in dto);
  const moneyValues = [dto.summary.storeCreditAvailablePaise, dto.wallet?.balancePaise, dto.orders[0].amounts.totalPaise, dto.orders[0].items[0].unitPricePaise];
  moneyValues.forEach((value) => assert.equal(Number.isInteger(value), true));
  const serialized = JSON.stringify(dto);
  assert.ok(serialized.includes("dashboard.v1"));
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.equal(hasUnsafeRuntimeValue(dto), false);
});

function hasUnsafeRuntimeValue(value: unknown): boolean {
  if (value instanceof Date || typeof value === "bigint" || typeof value === "function") return true;
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.toString.call(value) !== "[object Object]" && !Array.isArray(value)) return true;
  return Object.values(value as Record<string, unknown>).some(hasUnsafeRuntimeValue);
}
