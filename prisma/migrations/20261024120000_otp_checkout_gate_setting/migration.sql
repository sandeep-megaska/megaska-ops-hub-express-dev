-- "Require OTP login before checkout" became a merchant setting
-- (checkout.otpGateEnabled in the loopdesk_runtime_config module), off for new
-- installs. Every shop that exists now keeps the login-before-checkout it already had,
-- unless a value was already saved. Settings are written the same way the app saves
-- them (enabled = true), and a shop without a settings row gets one.
INSERT INTO "ShopModuleConfig" ("id", "shopId", "moduleKey", "enabled", "config", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."id", 'loopdesk_runtime_config', true, '{"checkout": {"otpGateEnabled": true}}'::jsonb, NOW(), NOW()
FROM "Shop" s
ON CONFLICT ("shopId", "moduleKey") DO UPDATE SET
  "config" = jsonb_set(
    COALESCE("ShopModuleConfig"."config"::jsonb, '{}'::jsonb),
    '{checkout}',
    COALESCE("ShopModuleConfig"."config"::jsonb -> 'checkout', '{}'::jsonb) || '{"otpGateEnabled": true}'::jsonb,
    true
  ),
  "updatedAt" = NOW()
WHERE NOT (COALESCE("ShopModuleConfig"."config"::jsonb -> 'checkout', '{}'::jsonb) ? 'otpGateEnabled');
