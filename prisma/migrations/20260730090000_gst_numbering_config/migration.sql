-- Configurable GST document numbering (GST-Pro parity): per-document-type
-- prefix / suffix / year segment / min-digit padding / starting number /
-- continuous-vs-reset-every-period. Stored as JSON so all three document types
-- (invoice, credit note, debit note) carry an independent format + start number.
--
-- Nullable: existing shops keep the legacy PREFIX/FY/00001 behaviour (resolved
-- from invoicePrefix + invoiceNumberStrategy) until they save a config.
ALTER TABLE "GstSettings" ADD COLUMN IF NOT EXISTS "numberingConfig" JSONB;
