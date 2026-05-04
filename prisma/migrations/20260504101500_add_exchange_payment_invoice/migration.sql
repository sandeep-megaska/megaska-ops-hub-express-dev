DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExchangePaymentInvoiceStatus') THEN
    CREATE TYPE "ExchangePaymentInvoiceStatus" AS ENUM ('GENERATED', 'SENT', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ExchangePaymentInvoice" (
  "id" TEXT NOT NULL,
  "requestPaymentId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "invoiceStatus" "ExchangePaymentInvoiceStatus" NOT NULL DEFAULT 'GENERATED',
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT,
  "customerEmail" TEXT,
  "orderNumber" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amountPaise" INTEGER NOT NULL,
  "taxableAmountPaise" INTEGER NOT NULL,
  "gstRatePercent" DOUBLE PRECISION NOT NULL,
  "cgstPaise" INTEGER NOT NULL DEFAULT 0,
  "sgstPaise" INTEGER NOT NULL DEFAULT 0,
  "igstPaise" INTEGER NOT NULL DEFAULT 0,
  "totalPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "pdfUrl" TEXT,
  "htmlSnapshot" TEXT,
  "textSnapshot" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExchangePaymentInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExchangePaymentInvoice_requestPaymentId_key" ON "ExchangePaymentInvoice"("requestPaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExchangePaymentInvoice_invoiceNumber_key" ON "ExchangePaymentInvoice"("invoiceNumber");
CREATE INDEX IF NOT EXISTS "ExchangePaymentInvoice_requestId_idx" ON "ExchangePaymentInvoice"("requestId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ExchangePaymentInvoice_requestPaymentId_fkey'
  ) THEN
    ALTER TABLE "ExchangePaymentInvoice"
      ADD CONSTRAINT "ExchangePaymentInvoice_requestPaymentId_fkey"
      FOREIGN KEY ("requestPaymentId") REFERENCES "RequestPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ExchangePaymentInvoice_requestId_fkey'
  ) THEN
    ALTER TABLE "ExchangePaymentInvoice"
      ADD CONSTRAINT "ExchangePaymentInvoice_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "OrderActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
