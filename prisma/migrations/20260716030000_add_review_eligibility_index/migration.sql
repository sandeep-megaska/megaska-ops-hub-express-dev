-- Supports bounded eligibility candidate scans; the existing scheduling index is retained.
CREATE INDEX "ReviewRequest_shopId_status_eligibleAt_idx" ON "ReviewRequest"("shopId", "status", "eligibleAt");
