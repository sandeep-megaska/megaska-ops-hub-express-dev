-- Expiring offline Admin API tokens: store the rotating refresh token (encrypted)
-- and its expiry next to the access token's expiry (tokenExpiresAt).
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "refreshTokenEncrypted" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" TIMESTAMP(3);
