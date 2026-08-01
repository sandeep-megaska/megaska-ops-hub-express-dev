-- Prepaid-discount feature: an express-checkout offer that lowers the payable
-- total only when the shopper picks a prepaid (online) payment method. COD is
-- unaffected. Stored as a distinct column (not folded into discountAmountPaise)
-- so COD-advance and analytics can tell a prepaid offer apart from a coupon.
ALTER TABLE "ExpressCheckoutIntent"
  ADD COLUMN "prepaidDiscountAmountPaise" INTEGER NOT NULL DEFAULT 0;
