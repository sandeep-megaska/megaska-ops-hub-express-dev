-- Exchange charges paid on a Shopify draft-order invoice (public app).
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'SHOPIFY';
