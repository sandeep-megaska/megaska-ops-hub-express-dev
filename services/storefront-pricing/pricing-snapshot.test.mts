import test from "node:test";
import assert from "node:assert/strict";
/* eslint-disable @typescript-eslint/no-explicit-any -- the fake delegate accepts Prisma-shaped argument objects */
import { ShopifyCheckoutPricingSnapshotRepository, type SnapshotRow } from "./pricing-snapshot-repository.ts";
import { CheckoutPricingSnapshotService } from "./pricing-snapshot-service.ts";
import type { TaxSummary } from "./tax-summary.ts";

const summary = (overrides: Partial<TaxSummary> = {}): TaxSummary => ({ taxesIncluded: false, currency: "USD", subtotal: 10000, shipping: 500, discounts: 1000, taxableAmount: 9000, taxLines: [{ title: "Tax", amount: 810, rate: 0.09 }], totalTax: 810, totalPayable: 10310, source: "SHOPIFY", ...overrides });
const snapshot = (overrides: Record<string, unknown> = {}) => ({ source: "SHOPIFY", shopifyDraftOrderId: "gid://shopify/DraftOrder/123", currency: "USD", subtotalMinor: 10000, discountsMinor: 1000, shippingMinor: 500, totalTaxMinor: 810, totalPayableMinor: 10310, taxesIncluded: false, taxSummary: summary(), refreshReason: "checkout_initialized", ...overrides } as never);

class Db {
  intents = [{ id: "intent-a", shopId: "shop-a" }, { id: "intent-b", shopId: "shop-b" }];
  rows: SnapshotRow[] = [];
  expressCheckoutIntent = { findFirst: async (args: any) => this.intents.find((i) => i.id === args.where.id && i.shopId === args.where.shopId) ?? null };
  shopifyCheckoutPricingSnapshot = {
    findFirst: async (args: any) => this.rows.find((r) => r.shopId === args.where.shopId && r.checkoutIntentId === args.where.checkoutIntentId) ?? null,
    upsert: async (args: any) => { let row = this.rows.find((r) => r.shopId === args.where.shopId_checkoutIntentId.shopId && r.checkoutIntentId === args.where.shopId_checkoutIntentId.checkoutIntentId); const now = new Date(); if (row) Object.assign(row, args.update, { updatedAt: now }); else { row = { ...args.create, createdAt: now, updatedAt: now } as SnapshotRow; this.rows.push(row); } return row; },
    updateMany: async (args: any) => { const matches = this.rows.filter((r) => r.shopId === args.where.shopId && r.checkoutIntentId === args.where.checkoutIntentId && r.status === args.where.status); matches.forEach((r) => Object.assign(r, args.data, { updatedAt: new Date() })); return { count: matches.length }; },
  };
  async $transaction<T>(fn: (tx: this) => Promise<T>) { return fn(this); }
}
function setup() { const db = new Db(); const repository = new ShopifyCheckoutPricingSnapshotRepository(db as never); return { db, repository, service: new CheckoutPricingSnapshotService(repository) }; }

test("repository creates one tenant-scoped row, updates it, and returns null outside its shop", async () => {
  const { db, service } = setup();
  const created = await service.recordAuthoritativePricingSnapshot({ shopId: "shop-a", checkoutIntentId: "intent-a", snapshot: snapshot() });
  assert.equal(created?.status, "CURRENT"); assert.equal(created?.source, "SHOPIFY"); assert.equal(db.rows.length, 1);
  const updated = await service.recordAuthoritativePricingSnapshot({ shopId: "shop-a", checkoutIntentId: "intent-a", snapshot: snapshot({ totalPayableMinor: 10400, taxSummary: summary({ totalPayable: 10400 }) }) });
  assert.equal(updated?.totalPayableMinor, 10400); assert.equal(db.rows.length, 1); assert.equal(await service.getCheckoutPricingSnapshot({ shopId: "shop-b", checkoutIntentId: "intent-a" }), null);
  assert.equal(await service.recordAuthoritativePricingSnapshot({ shopId: "shop-b", checkoutIntentId: "intent-a", snapshot: snapshot() }), null);
  assert.equal(await service.getCheckoutPricingSnapshot({ shopId: "shop-a", checkoutIntentId: "missing" }), null);
});

test("invalidation preserves totals, is idempotent, and authoritative rewrite restores CURRENT", async () => {
  const { service } = setup(); await service.recordAuthoritativePricingSnapshot({ shopId: "shop-a", checkoutIntentId: "intent-a", snapshot: snapshot() });
  const at = new Date("2026-07-20T10:00:00Z"); const invalid = await service.invalidateCheckoutPricingSnapshot({ shopId: "shop-a", checkoutIntentId: "intent-a", reason: "cart_changed", invalidatedAt: at });
  assert.equal(invalid?.status, "INVALIDATED"); assert.equal(invalid?.totalPayableMinor, 10310); assert.equal(invalid?.invalidatedAt?.getTime(), at.getTime());
  const repeated = await service.invalidateCheckoutPricingSnapshot({ shopId: "shop-a", checkoutIntentId: "intent-a", reason: "manual_invalidation", invalidatedAt: new Date("2026-07-21") });
  assert.equal(repeated?.invalidationReason, "cart_changed"); assert.equal(repeated?.invalidatedAt?.getTime(), at.getTime());
  const current = await service.recordAuthoritativePricingSnapshot({ shopId: "shop-a", checkoutIntentId: "intent-a", snapshot: snapshot({ taxesIncluded: true, taxSummary: summary({ taxesIncluded: true }) }) });
  assert.equal(current?.status, "CURRENT"); assert.equal(current?.invalidatedAt, null); assert.equal(current?.taxSummary?.taxesIncluded, true);
});
