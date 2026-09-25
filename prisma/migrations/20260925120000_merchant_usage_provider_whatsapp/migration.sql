-- WhatsApp OTP (Meta Cloud API authentication template) is metered as its own
-- platform transport so OTP usage stays billable when it bypasses Twilio.
ALTER TYPE "MerchantUsageProvider" ADD VALUE IF NOT EXISTS 'PLATFORM_WHATSAPP';
