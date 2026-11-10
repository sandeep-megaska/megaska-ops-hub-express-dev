-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'STYLE_DIFFERENCE';

-- AlterTable
ALTER TABLE "OrderActionRequest" ADD COLUMN     "styleDifferencePaise" INTEGER,
ADD COLUMN     "styleSettledAt" TIMESTAMP(3),
ADD COLUMN     "styleSettlement" TEXT;

-- AlterTable
ALTER TABLE "OrderActionItem" ADD COLUMN     "originalUnitPricePaise" INTEGER,
ADD COLUMN     "replacementSku" TEXT,
ADD COLUMN     "replacementTitle" TEXT,
ADD COLUMN     "replacementUnitPricePaise" INTEGER,
ADD COLUMN     "replacementVariantId" TEXT;

