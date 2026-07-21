ALTER TABLE "MerchantOtpSettings"
ADD COLUMN "defaultCountryCode" TEXT NOT NULL DEFAULT 'IN',
ADD COLUMN "allowedCountryCodes" TEXT[] NOT NULL DEFAULT ARRAY['IN']::TEXT[];
