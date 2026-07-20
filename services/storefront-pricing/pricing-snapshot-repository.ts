import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import { parseTaxSummary } from "./pricing-snapshot-validation.ts";
import { PRICING_SNAPSHOT_INVALIDATION_REASONS, PRICING_SNAPSHOT_REFRESH_REASONS, type AuthoritativePricingSnapshotInput, type PricingSnapshotInvalidationReason, type ShopifyCheckoutPricingSnapshot } from "./pricing-snapshot-types.ts";

type SnapshotRow = Omit<ShopifyCheckoutPricingSnapshot, "source" | "refreshReason" | "invalidationReason" | "taxSummary"> & { source: string; refreshReason: string | null; invalidationReason: string | null; taxSummary: unknown };
type SnapshotDelegate = {
  findFirst(args: object): Promise<SnapshotRow | null>;
  upsert(args: object): Promise<SnapshotRow>;
  updateMany(args: object): Promise<{ count: number }>;
};
type PricingSnapshotDb = {
  expressCheckoutIntent: { findFirst(args: object): Promise<{ id: string } | null> };
  shopifyCheckoutPricingSnapshot: SnapshotDelegate;
  $transaction<T>(fn: (tx: PricingSnapshotDb) => Promise<T>): Promise<T>;
};

function hydrate(row: SnapshotRow | null): ShopifyCheckoutPricingSnapshot | null {
  if (!row) return null;
  if (row.source !== "SHOPIFY") throw new Error("Persisted pricing snapshot source is invalid");
  if (row.status !== "CURRENT" && row.status !== "INVALIDATED") throw new Error("Persisted pricing snapshot status is invalid");
  if (row.refreshReason !== null && !PRICING_SNAPSHOT_REFRESH_REASONS.includes(row.refreshReason as never)) throw new Error("Persisted pricing snapshot refresh reason is invalid");
  if (row.invalidationReason !== null && !PRICING_SNAPSHOT_INVALIDATION_REASONS.includes(row.invalidationReason as never)) throw new Error("Persisted pricing snapshot invalidation reason is invalid");
  return { ...row, source: "SHOPIFY", refreshReason: row.refreshReason as ShopifyCheckoutPricingSnapshot["refreshReason"], invalidationReason: row.invalidationReason as ShopifyCheckoutPricingSnapshot["invalidationReason"], taxSummary: row.taxSummary === null ? null : parseTaxSummary(row.taxSummary) };
}

export class ShopifyCheckoutPricingSnapshotRepository {
  private readonly db: PricingSnapshotDb;
  constructor(db: PricingSnapshotDb = prisma as unknown as PricingSnapshotDb) { this.db = db; }

  async getByCheckoutIntent(input: { shopId: string; checkoutIntentId: string }, database = this.db) {
    return hydrate(await database.shopifyCheckoutPricingSnapshot.findFirst({ where: { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId } }));
  }

  async upsertAuthoritativeSnapshot(input: { shopId: string; checkoutIntentId: string; snapshot: AuthoritativePricingSnapshotInput & { source: "SHOPIFY"; shopifyDraftOrderId: string | null; authoritativeAt: Date } }) {
    return this.db.$transaction(async (tx) => {
      const ownedIntent = await tx.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId, shopId: input.shopId }, select: { id: true } });
      if (!ownedIntent) return null;
      const s = input.snapshot;
      const data = { shopifyDraftOrderId: s.shopifyDraftOrderId, source: "SHOPIFY", status: "CURRENT", currency: s.currency, subtotalMinor: s.subtotalMinor, discountsMinor: s.discountsMinor, shippingMinor: s.shippingMinor, totalTaxMinor: s.totalTaxMinor, totalPayableMinor: s.totalPayableMinor, taxesIncluded: s.taxesIncluded, taxSummary: s.taxSummary, cartFingerprint: s.cartFingerprint ?? null, addressFingerprint: s.addressFingerprint ?? null, shippingFingerprint: s.shippingFingerprint ?? null, discountFingerprint: s.discountFingerprint ?? null, storeCreditFingerprint: s.storeCreditFingerprint ?? null, refreshReason: s.refreshReason, authoritativeAt: s.authoritativeAt, invalidatedAt: null, invalidationReason: null };
      const row = await tx.shopifyCheckoutPricingSnapshot.upsert({
        where: { shopId_checkoutIntentId: { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId } },
        create: { id: randomUUID(), publicId: randomUUID(), shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, ...data },
        update: data,
      });
      return hydrate(row);
    });
  }

  async invalidateSnapshot(input: { shopId: string; checkoutIntentId: string; reason: PricingSnapshotInvalidationReason; invalidatedAt: Date }) {
    return this.db.$transaction(async (tx) => {
      const current = await this.getByCheckoutIntent(input, tx);
      if (!current || current.status === "INVALIDATED") return current;
      await tx.shopifyCheckoutPricingSnapshot.updateMany({ where: { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, status: "CURRENT" }, data: { status: "INVALIDATED", invalidatedAt: input.invalidatedAt, invalidationReason: input.reason } });
      return this.getByCheckoutIntent(input, tx);
    });
  }
}

export type { PricingSnapshotDb, SnapshotRow };
