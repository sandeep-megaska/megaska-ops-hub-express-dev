/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import {
  getCompiledPromotionRuntime,
  mergeLoopDeskMerchantSettings,
  normalizeCartGoalProgressConfig,
  normalizeCartIntelligenceSettings,
  normalizeLoopDeskMerchantSettings,
  toCartIntelligencePublicRuntimeConfig,
  toLoopDeskPublicRuntimeConfig,
  validateCartIntelligenceSettingsPatch,
  validateLoopDeskMerchantSettingsPatch,
} from "./merchant-settings.ts";

const productGid = (id: string) => `gid://shopify/Product/${id}`;
function compiledRule(id: string, offerId: string) {
  return {
    id,
    priority: 1,
    status: "ACTIVE",
    currentCompilation: {
      id: `c-${id}`,
      version: 1,
      status: "READY",
      storefrontPayload: {
        schemaVersion: 1,
        ruleId: id,
        status: "ACTIVE",
        priority: 1,
        schedule: { startsAt: null, endsAt: null },
        offer: { productGid: productGid(offerId), title: "Stale title", handle: null, imageUrl: null },
      },
    },
  };
}
function promotionRuntimeDb(rules: any[]) {
  return {
    shop: { findUnique: async () => ({ shopDomain: "tenant.myshopify.com", myshopifyDomain: "tenant.myshopify.com", primaryDomain: null }) },
    promotionRule: { findMany: async (args: any) => {
      assert.equal(args.where.shopId, "shop-1");
      return rules;
    } },
  };
}

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
  assert.equal(settings.cartGoalProgress.enabled, false);
  assert.equal(settings.cartGoalProgress.targetAmountMinor, null);
  assert.equal(settings.cartGoalProgress.goalType, "FREE_SHIPPING");
  assert.equal(settings.upsellsEnabled, false);
  assert.equal(settings.bundlesEnabled, false);
  assert.equal(settings.aiRecommendationsEnabled, false);
  assert.equal(settings.trustBadges.enabled, false);
  assert.equal(settings.trustBadges.items.length, 6);
  assert.ok(settings.trustBadges.items.every((item) => !item.enabled));
  assert.equal(settings.cartDrawerModules.schemaVersion, 1);
  assert.equal(settings.cartDrawerModules.modules.find((module) => module.key === "PROMOTIONS")?.enabled, true);
});

test("cart drawer module config is normalized and remains backward compatible", () => {
  const settings = normalizeCartIntelligenceSettings({ cartDrawerModules: { schemaVersion: 99, modules: [
    { key: "LOYALTY", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 30, settings: "malformed" },
    { key: "UNKNOWN", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 1 },
  ] } });
  assert.deepEqual(settings.cartDrawerModules, { schemaVersion: 1, modules: [
    { key: "LOYALTY", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 30 },
  ] });
  const runtime = toCartIntelligencePublicRuntimeConfig(settings);
  assert.deepEqual(runtime.cartDrawerModules, settings.cartDrawerModules);
  assert.equal(runtime.freeShippingProgress.enabled, false);
  assert.equal(runtime.trustBadges.enabled, false);
});

test("normalizes, sanitizes, limits, and orders trust badges", () => {
  const settings = normalizeCartIntelligenceSettings({ trustBadges: {
    enabled: true, placement: "BELOW_CHECKOUT_BUTTON", layout: "ROW", items: [
      { id: "second", enabled: true, icon: "support", label: `<b>${"x".repeat(70)}</b>`, sortOrder: 2 },
      { id: "first", enabled: true, icon: "not-an-icon", label: "Fast dispatch", sortOrder: 1 },
    ],
  } });
  assert.deepEqual(settings.trustBadges.items.map((item) => item.id), ["first", "second"]);
  assert.equal(settings.trustBadges.items[0].icon, "custom");
  assert.equal(settings.trustBadges.items[1].label.length, 60);
  assert.doesNotMatch(settings.trustBadges.items[1].label, /[<>]/);
});

test("trust badge validation rejects malformed configuration", () => {
  const errors = validateCartIntelligenceSettingsPatch({ trustBadges: {
    enabled: true, placement: "ABOVE_CART", layout: "LIST",
    items: [{ enabled: true, icon: "remote-svg", label: "x".repeat(61), sortOrder: "first" }],
  } });
  assert.match(errors.join(" "), /placement is invalid/);
  assert.match(errors.join(" "), /layout is invalid/);
  assert.match(errors.join(" "), /icon is invalid/);
  assert.match(errors.join(" "), /60 characters or fewer/);
});

test("cart intelligence public runtime exposes only normalized cart goal config", () => {
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
  const progress = runtime.cartGoalProgress as Record<string, unknown>;
  assert.equal(progress.targetAmountMinor, 99900);
  assert.equal(progress.progressText, "Spend more for free shipping");
  assert.equal(runtime.freeShippingProgress, undefined);
  assert.equal(progress.resolutionStatus, undefined);
  assert.equal(runtime.dynamicBannerText, undefined);
  assert.equal(runtime.secret, undefined);
  assert.equal((runtime.trustBadges as { enabled: boolean }).enabled, true);
});

test("legacy threshold and progress text migrate at read time", () => {
  const settings = normalizeCartIntelligenceSettings({ freeShippingThreshold: "725" });
  assert.equal(settings.cartGoalProgress.targetAmountMinor, 72500);
  assert.equal(toCartIntelligencePublicRuntimeConfig(settings).cartGoalProgress.targetAmountMinor, 72500);
  assert.equal(normalizeCartGoalProgressConfig({ progressBarText: "Legacy copy" }).progressText, "Legacy copy");
});

test("removed Shopify resolution fields are ignored safely", () => {
  const goal = normalizeCartGoalProgressConfig({
    freeShippingProgressEnabled: true,
    fallbackThresholdMinor: 50000,
    resolvedShopifyThresholdMinor: 1,
    resolutionStatus: "AVAILABLE",
    resolutionSource: "SHOPIFY_DELIVERY_PROFILE",
    lastResolvedAt: "yesterday",
  });
  assert.equal(goal.enabled, true);
  assert.equal(goal.targetAmountMinor, 50000);
  assert.equal((goal as unknown as Record<string, unknown>).resolutionStatus, undefined);
});

test("validates cart intelligence patch fields", () => {
  const errors = validateCartIntelligenceSettingsPatch({
    enabled: "yes",
    targetAmount: "not-a-number",
    progressText: "x".repeat(161),
  });
  assert.match(errors.join(" "), /Cart Intelligence Enabled/);
  assert.match(errors.join(" "), /Goal Target Amount/);
  assert.match(errors.join(" "), /Progress Message/);
});

test("compiled promotion runtime enriches a valid offer product from Shopify Admin", async () => {
  const calls: any[] = [];
  const runtime = await getCompiledPromotionRuntime("shop-1", {
    database: promotionRuntimeDb([compiledRule("rule-1", "995")]),
    graphql: async (_query, variables, options) => {
      calls.push({ variables, options });
      return { nodes: [{ id: productGid("995"), handle: "hydrogen", title: "The Collection Snowboard: Hydrogen", featuredImage: { url: "https://cdn.shopify.com/hydrogen.jpg" } }] } as any;
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].variables.ids, [productGid("995")]);
  assert.equal(calls[0].options.shopDomain, "tenant.myshopify.com");
  assert.equal((runtime.rules[0] as any).offer.productGid, productGid("995"));
  assert.equal((runtime.rules[0] as any).offer.handle, "hydrogen");
  assert.equal((runtime.rules[0] as any).offer.title, "The Collection Snowboard: Hydrogen");
  assert.equal((runtime.rules[0] as any).offer.imageUrl, "https://cdn.shopify.com/hydrogen.jpg");
});

test("compiled promotion runtime excludes unresolved offer products", async () => {
  const runtime = await getCompiledPromotionRuntime("shop-1", {
    database: promotionRuntimeDb([compiledRule("rule-1", "404"), compiledRule("rule-2", "405")]),
    graphql: async () => ({ nodes: [{ id: productGid("404"), handle: "", title: "No handle" }, null] }) as any,
  });
  assert.deepEqual(runtime.rules, []);
});

test("compiled promotion runtime batch-resolves multiple offer products", async () => {
  const calls: any[] = [];
  const runtime = await getCompiledPromotionRuntime("shop-1", {
    database: promotionRuntimeDb([compiledRule("rule-1", "1"), compiledRule("rule-2", "2"), compiledRule("rule-3", "1")]),
    graphql: async (_query, variables) => {
      calls.push(variables);
      return { nodes: [{ id: productGid("1"), handle: "one", title: "One" }, { id: productGid("2"), handle: "two", title: "Two" }] } as any;
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, [productGid("1"), productGid("2")]);
  assert.deepEqual(runtime.rules.map((rule: any) => rule.offer.handle), ["one", "two", "one"]);
});

test("compiled promotion runtime does not expose admin tokens or raw Shopify response", async () => {
  const runtime = await getCompiledPromotionRuntime("shop-1", {
    database: promotionRuntimeDb([compiledRule("rule-1", "1")]),
    graphql: async () => ({ accessToken: "shpat_secret", nodes: [{ id: productGid("1"), handle: "one", title: "One", raw: { token: "shpat_secret" } }] }) as any,
  });
  const serialized = JSON.stringify(runtime);
  assert.doesNotMatch(serialized, /shpat_secret|accessToken|raw/);
});

test("bootstrap keeps runtime promotions before cart drawer normalization", () => {
  const block = readFileSync(resolve("extensions/megaska-otp/blocks/loopdesk-cart-drawer-embed.liquid"), "utf8");
  assert.match(block, /promotions:\s*payload\.config\.promotions/);
  const source = readFileSync(resolve("extensions/megaska-otp/assets/loopdesk-cart-drawer.js"), "utf8");
  const document = {
    readyState: "loading",
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } }),
    body: null,
    documentElement: { style: {} },
  };
  const window: any = {
    LoopDeskConfig: { promotions: { rules: [{ ruleId: "rule-1" }] } },
    LOOPDESK_CART_DRAWER_CONFIG: {},
    Shopify: { shop: "tenant.myshopify.com" },
    console: { debug() {}, warn() {}, error() {}, log() {} },
    document,
    location: { pathname: "/" },
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    XMLHttpRequest: function XMLHttpRequest() {},
  };
  vm.runInNewContext(source, { window, document, console: window.console, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, URLSearchParams, FormData: class FormData {} });
  assert.equal(window.LoopDeskConfig.promotions.rules.length, 1);
});

test("normalizes OTP modal branding defaults and runtime projection", () => {
  const settings = normalizeLoopDeskMerchantSettings({}, { shopName: "Demo Store", shopDomain: "demo.myshopify.com" });
  assert.equal(settings.otpModalBranding.logoUrl, null);
  assert.equal(settings.otpModalBranding.logoAlt, "Demo Store");
  assert.equal(settings.otpModalBranding.fallbackBrandText, "Demo Store");
  assert.equal(settings.otpModalBranding.heading, "Login or Signup");
  assert.equal(settings.otpModalBranding.description, "Sign in securely to continue");
  assert.equal(settings.otpModalBranding.promotionEnabled, false);
  assert.deepEqual(settings.otpModalBranding.trustItems, ["Secure login", "Faster checkout", ""]);
  assert.equal(settings.otpModalBranding.inputHelperText, "Enter 10 digits to receive an OTP automatically.");
  assert.equal(settings.otpModalBranding.privacyText, "We never share your number.");
  assert.deepEqual(toLoopDeskPublicRuntimeConfig(settings).otpModalBranding, settings.otpModalBranding);
});

test("validates and preserves saved OTP modal promotional copy", () => {
  const current = normalizeLoopDeskMerchantSettings({}, { shopName: "Megaska", shopDomain: "megaska.myshopify.com" });
  const merged = mergeLoopDeskMerchantSettings(current, {
    otpModalBranding: {
      logoUrl: "https://cdn.shopify.com/logo.png",
      promotionEnabled: true,
      promotionBadgeText: "15% OFF",
      promotionMessage: "Use Code: MEGA15",
      trustItem3: "Easy order tracking",
    },
  });
  assert.equal(merged.otpModalBranding.logoUrl, "https://cdn.shopify.com/logo.png");
  assert.equal(merged.otpModalBranding.promotionEnabled, true);
  assert.equal(merged.otpModalBranding.promotionBadgeText, "15% OFF");
  assert.equal(merged.otpModalBranding.promotionMessage, "Use Code: MEGA15");
  assert.equal(merged.otpModalBranding.trustItems[2], "Easy order tracking");

  const errors = validateLoopDeskMerchantSettingsPatch({
    otpModalBranding: { logoUrl: "http://example.com/logo.png", heading: "x".repeat(121), promotionEnabled: "yes" },
  });
  assert.match(errors.join(" "), /OTP modal logo URL must use https/);
  assert.match(errors.join(" "), /OTP modal heading/);
  assert.match(errors.join(" "), /Show promotional banner/);
});
