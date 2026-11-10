-- Replacement shipped before the returned item reached the warehouse.
ALTER TABLE "OrderActionRequest" ADD COLUMN "earlyReplacementAt" TIMESTAMP(3);
ALTER TABLE "OrderActionRequest" ADD COLUMN "earlyReplacementReason" TEXT;
