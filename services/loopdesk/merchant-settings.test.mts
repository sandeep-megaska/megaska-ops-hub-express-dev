import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeLoopDeskMerchantSettings,
  normalizeCartIntelligenceSettings,
  normalizeLoopDeskMerchantSettings,
  toCartIntelligencePublicRuntimeConfig,
  toLoopDeskPublicRuntimeConfig,
  validateCartIntelligenceSettingsPatch,
  validateLoopDeskMerchantSettingsPatch,
} from "./merchant-settings.ts";

test("normalizes merchant settings defaults", () => {
  const settings = normalizeLoopDeskMerchantSettings(
    {},
    { shopName: "Demo Store", shopDomain: "demo.myshopify.com" },
  );
  assert.equal(settings.general.merchantName, "Demo Store");
  assert.equal(settings.branding.primaryColor, "#111827");
  assert.equal(settings.cart.drawerMode, "auto");
  assert.equal(settings.integrations.razorpay.status, "not_configured");
});

test("merges partial config without dropping existing settings", () => {
  const current = normalizeLoopDeskMerchantSettings({
    branding: { primaryColor: "#123456" },
    labels: { viewCartText: "Bag" },
  });
  const merged = mergeLoopDeskMerchantSettings(current, {
    labels: { expressCheckoutText: "Quick checkout" },
  });
  assert.equal(merged.branding.primaryColor, "#123456");
  assert.equal(merged.labels.viewCartText, "Bag");
  assert.equal(merged.labels.expressCheckoutText, "Quick checkout");
});

test("falls back invalid colors and drawer modes", () => {
  const settings = normalizeLoopDeskMerchantSettings({
    branding: { primaryColor: "url(javascript:alert(1))" },
    cart: { drawerMode: "broken" },
  });
  assert.equal(settings.branding.primaryColor, "#111827");
  assert.equal(settings.cart.drawerMode, "auto");
});

test("public runtime config excludes integration and analytics settings", () => {
  const settings = normalizeLoopDeskMerchantSettings({
    integrations: { razorpay: { status: "configured", keySecret: "secret" } },
    analytics: { enabled: true },
  });
  const runtime = toLoopDeskPublicRuntimeConfig(settings) as Record<
    string,
    unknown
  >;
  assert.equal(runtime.integrations, undefined);
  assert.equal(runtime.analytics, undefined);
  assert.equal(runtime.enabled, true);
  assert.equal((runtime.general as { merchantName: string }).merchantName, "LoopDesk");
});

test("legacy runtime shape remains available", () => {
  const settings = normalizeLoopDeskMerchantSettings({
    labels: { checkoutButtonText: "Checkout now" },
    cart: { cartDrawerMode: "loopdesk" },
  });
  const runtime = toLoopDeskPublicRuntimeConfig(settings);
  assert.equal(runtime.labels.expressCheckoutText, "Checkout now");
  assert.equal(runtime.cart.drawerMode, "loopdesk");
  assert.equal(runtime.cartOwnershipMode, "loopdesk");
});

test("validates merchant settings admin patch fields", () => {
  const errors = validateLoopDeskMerchantSettingsPatch({
    branding: {
      primaryColor: "javascript:alert(1)",
      logoUrl: "ftp://example.com/logo.png",
    },
    cart: { drawerMode: "broken", openAfterAddToCart: "yes" },
    labels: { expressCheckoutText: "x".repeat(81) },
  });
  assert.match(errors.join(" "), /Primary color/);
  assert.match(errors.join(" "), /Logo URL/);
  assert.match(errors.join(" "), /Drawer mode/);
  assert.match(errors.join(" "), /Open after add to cart/);
  assert.match(errors.join(" "), /Express checkout text/);
});


test("normalizes cart intelligence defaults disabled", () => {
  const settings = normalizeCartIntelligenceSettings({});
  assert.equal(settings.enabled, false);
  assert.equal(settings.freeShippingProgressEnabled, false);
  assert.equal(settings.freeShippingThreshold, 0);
  assert.equal(settings.upsellsEnabled, false);
  assert.equal(settings.bundlesEnabled, false);
  assert.equal(settings.aiRecommendationsEnabled, false);
});

test("cart intelligence public runtime exposes only safe flags threshold and display text", () => {
  const settings = normalizeCartIntelligenceSettings({
    enabled: true,
    freeShippingProgressEnabled: true,
    freeShippingThreshold: "999",
    progressBarText: "Spend more for free shipping",
    trustBadgesEnabled: true,
    dynamicBannerEnabled: true,
    dynamicBannerText: "Members get early access",
    upsellsEnabled: true,
    bundlesEnabled: true,
    aiRecommendationsEnabled: true,
    secret: "do-not-return",
  });
  const runtime = toCartIntelligencePublicRuntimeConfig(settings) as Record<string, unknown>;
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.freeShippingThreshold, 999);
  assert.equal(runtime.progressBarText, "Spend more for free shipping");
  assert.equal(runtime.dynamicBannerText, "Members get early access");
  assert.equal(runtime.secret, undefined);
});

test("validates cart intelligence patch fields", () => {
  const errors = validateCartIntelligenceSettingsPatch({
    enabled: "yes",
    freeShippingThreshold: "not-a-number",
    progressBarText: "x".repeat(161),
  });
  assert.match(errors.join(" "), /Cart Intelligence Enabled/);
  assert.match(errors.join(" "), /Free Shipping Threshold/);
  assert.match(errors.join(" "), /Progress Bar Text/);
});
