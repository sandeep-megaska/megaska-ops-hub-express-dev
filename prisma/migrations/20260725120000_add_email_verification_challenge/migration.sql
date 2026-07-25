CREATE TABLE "EmailVerificationChallenge" (
  "id" TEXT PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE CASCADE,
  "customerProfileId" TEXT NOT NULL REFERENCES "CustomerProfile"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "candidateShopifyCustomerId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptsCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmailVerificationChallenge_shopId_customerProfileId_status_createdAt_idx" ON "EmailVerificationChallenge"("shopId", "customerProfileId", "status", "createdAt");
