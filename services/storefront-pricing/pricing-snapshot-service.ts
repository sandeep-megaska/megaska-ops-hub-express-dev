import { ShopifyCheckoutPricingSnapshotRepository } from "./pricing-snapshot-repository.ts";
import { PRICING_SNAPSHOT_INVALIDATION_REASONS, type AuthoritativePricingSnapshotInput, type PricingSnapshotInvalidationReason } from "./pricing-snapshot-types.ts";
import { PricingSnapshotValidationError, validateAuthoritativePricingSnapshot } from "./pricing-snapshot-validation.ts";

export class CheckoutPricingSnapshotService {
  private readonly repository: ShopifyCheckoutPricingSnapshotRepository;
  constructor(repository = new ShopifyCheckoutPricingSnapshotRepository()) { this.repository = repository; }

  getCheckoutPricingSnapshot(input: { shopId: string; checkoutIntentId: string }) {
    this.assertTenantInput(input);
    return this.repository.getByCheckoutIntent(input);
  }

  recordAuthoritativePricingSnapshot(input: { shopId: string; checkoutIntentId: string; snapshot: AuthoritativePricingSnapshotInput }) {
    this.assertTenantInput(input);
    return this.repository.upsertAuthoritativeSnapshot({ ...input, snapshot: validateAuthoritativePricingSnapshot(input.snapshot) });
  }

  invalidateCheckoutPricingSnapshot(input: { shopId: string; checkoutIntentId: string; reason: PricingSnapshotInvalidationReason; invalidatedAt?: Date }) {
    this.assertTenantInput(input);
    if (!PRICING_SNAPSHOT_INVALIDATION_REASONS.includes(input.reason)) throw new PricingSnapshotValidationError("Invalidation reason is invalid");
    const invalidatedAt = input.invalidatedAt ?? new Date();
    if (!(invalidatedAt instanceof Date) || !Number.isFinite(invalidatedAt.getTime())) throw new PricingSnapshotValidationError("Invalidation timestamp is invalid");
    return this.repository.invalidateSnapshot({ ...input, invalidatedAt });
  }

  private assertTenantInput(input: { shopId: string; checkoutIntentId: string }) {
    if (!input.shopId.trim() || !input.checkoutIntentId.trim()) throw new PricingSnapshotValidationError("Shop and checkout intent are required");
  }
}
