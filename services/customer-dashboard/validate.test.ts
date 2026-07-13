import test from "node:test";
import assert from "node:assert/strict";
import { validateCustomerDashboardV1 } from "./validate.ts";
import { toIsoDateOrNull } from "./date.ts";
import { buildLegacyDashboardSummary } from "./legacy.ts";

function fixture() { return { version: "dashboard.v1", generatedAt: "2026-01-01T00:00:00.000Z", shop: { id: "s", domain: "x", name: null, currency: "INR", support: { email: null, phone: null, whatsapp: null, contactUrl: null }, branding: { accountLabel: "My Account", logoUrl: null } }, customer: { id: "c", firstName: null, lastName: null, displayName: "Customer", initials: "C", phone: "+1", phoneVerified: true, email: null, shopifyCustomerId: null }, summary: { totalOrders: 0, openRequests: 0, savedAddresses: 0, storeCreditAvailablePaise: 0, currency: "INR" }, wallet: null, addresses: [], orders: [], modules: { wallet: false, cancellation: true, exchange: true, issueReporting: true, shipmentTracking: true, partialCod: true, loyalty: false, memberships: false, referrals: false } }; }

test("validates a minimal dashboard DTO", () => { const dto = fixture(); assert.doesNotThrow(() => validateCustomerDashboardV1(dto)); });
test("rejects malformed version, dates, bigint and circular data", () => { assert.throws(() => validateCustomerDashboardV1({ ...fixture(), version: "x" }), /CustomerDashboardError/); assert.throws(() => validateCustomerDashboardV1({ ...fixture(), generatedAt: "nope" }), /CustomerDashboardError/); const bad = fixture(); bad.summary.totalOrders = -1; assert.throws(() => validateCustomerDashboardV1(bad), /CustomerDashboardError/); const circular = fixture(); circular.self = circular; assert.throws(() => validateCustomerDashboardV1(circular), /CustomerDashboardError/); assert.throws(() => validateCustomerDashboardV1({ ...fixture(), raw: 1n }), /CustomerDashboardError/); });
test("date helper returns ISO or null without Invalid Date output", () => { assert.equal(toIsoDateOrNull(new Date("2026-01-01T00:00:00Z")), "2026-01-01T00:00:00.000Z"); assert.equal(toIsoDateOrNull("2026-01-01T00:00:00Z"), "2026-01-01T00:00:00.000Z"); assert.equal(toIsoDateOrNull(null), null); assert.equal(toIsoDateOrNull("malformed"), null); });
test("legacy output remains JSON serializable", () => { assert.doesNotThrow(() => JSON.stringify(buildLegacyDashboardSummary(fixture()))); });
