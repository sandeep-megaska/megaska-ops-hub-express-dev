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
  normalizeCartDynamicBannerConfig,
  normalizeCartIntelligenceSettings,
  normalizeCartSavingsSummaryConfig,
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
  assert.equal(settings.cart.customCartTriggerSelector, "");
  assert.equal(settings.account.dashboardRedirectEnabled, true);
  assert.equal(settings.account.dashboardPath, "/apps/megaska/account");
  assert.equal(settings.account.customTriggerSelector, "");
  assert.equal(settings.integrations.razorpay.status, "not_configured");
});

test("normalizes and merges account dashboard redirect settings", () => {
  const settings = normalizeLoopDeskMerchantSettings({
    account: {
      dashboardRedirectEnabled: false,
      dashboardPath: "/apps/megaska/dashboard",
      customTriggerSelector: "#AccountIcon, .site-header__account-toggle",
    },
  });
  assert.equal(settings.account.dashboardRedirectEnabled, false);
  assert.equal(settings.account.dashboardPath, "/apps/megaska/dashboard");
  assert.equal(
    settings.account.customTriggerSelector,
    "#AccountIcon, .site-header__account-toggle",
  );
  const merged = mergeLoopDeskMerchantSettings(settings, {
    account: { dashboardRedirectEnabled: true },
  });
  assert.equal(merged.account.dashboardRedirectEnabled, true);
  assert.equal(merged.account.dashboardPath, "/apps/megaska/dashboard");
});

test("rejects an unsafe dashboard path and falls back to the default", () => {
  const settings = normalizeLoopDeskMerchantSettings({
    account: { dashboardPath: "//attacker.example/phish" },
  });
  assert.equal(settings.account.dashboardPath, "/apps/megaska/account");
});

test("normalizes and merges a custom cart trigger selector", () => {
  const settings = normalizeLoopDeskMerchantSettings({
    cart: { customCartTriggerSelector: "#CartIcon, .site-header__cart-toggle" },
  });
  assert.equal(
    settings.cart.customCartTriggerSelector,
    "#CartIcon, .site-header__cart-toggle",
  );
  const merged = mergeLoopDeskMerchantSettings(settings, {
    cart: { openAfterAddToCart: true },
  });
  assert.equal(
    merged.cart.customCartTriggerSelector,
    "#CartIcon, .site-header__cart-toggle",
  );
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
  assert.equal((runtime.general as { merchantName: string }).merchantName, "LoopD2C");
});

test("compiled order tiers publish without product enrichment and product offers remain guarded", async () => {
  const order = compiledRule("order-rule", "");
  order.currentCompilation.storefrontPayload = {
    ...order.currentCompilation.storefrontPayload,
    reward: { scope: "order", method: "percentage", configuration: { selectionMode: "highest_eligible", continuityMode: "allow_gaps", basis: "eligible_merchandise_subtotal", tiers: [{ id: "tier-public", minimumSubtotal: "1", percentage: "5" }] } },
  };
  const runtime = await getCompiledPromotionRuntime("shop-1", { database: promotionRuntimeDb([order]) as any, graphql: async () => { throw new Error("order tiers must not request products"); } });
  assert.equal(runtime.rules.length, 1);
  assert.equal((runtime.rules[0] as any).reward.configuration.tiers[0].id, "tier-public");
  assert.equal((runtime.rules[0] as any).compilation.id, undefined);
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
    cart: {
      drawerMode: "broken",
      openAfterAddToCart: "yes",
      customCartTriggerSelector: "x".repeat(501),
    },
    account: {
      dashboardRedirectEnabled: "yes",
      dashboardPath: "//attacker.example/phish",
      customTriggerSelector: "x".repeat(501),
    },
    labels: { expressCheckoutText: "x".repeat(81) },
  });
  assert.match(errors.join(" "), /Primary color/);
  assert.match(errors.join(" "), /Logo URL/);
  assert.match(errors.join(" "), /Drawer mode/);
  assert.match(errors.join(" "), /Open after add to cart/);
  assert.match(errors.join(" "), /Express checkout text/);
  assert.match(errors.join(" "), /Custom cart icon selector/);
  assert.match(errors.join(" "), /Account dashboard redirect enabled/);
  assert.match(errors.join(" "), /Dashboard path must be a relative path/);
  assert.match(errors.join(" "), /Custom account icon selector/);
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
  assert.deepEqual(settings.savingsSummary, {
    enabled: false, title: "You Saved", placement: "BEFORE_TOTALS", sortOrder: 20,
    showTotalSavings: true, showOfferSavings: true, showCouponSavings: true,
    showCompareAtSavings: true, hideZeroRows: true,
  });
});

test("normalizes savings summary defaults and malformed values", () => {
  assert.deepEqual(normalizeCartSavingsSummaryConfig(undefined), normalizeCartSavingsSummaryConfig("bad"));
  const normalized = normalizeCartSavingsSummaryConfig({ enabled: true, title: `  <${"x".repeat(90)}>  `, placement: "BAD", sortOrder: Infinity, showOfferSavings: "yes", hideZeroRows: false, unknown: true });
  assert.equal(normalized.enabled, true); assert.equal(normalized.title.length, 80);
  assert.doesNotMatch(normalized.title, /[<>]/); assert.equal(normalized.placement, "BEFORE_TOTALS");
  assert.equal(normalized.sortOrder, 20); assert.equal(normalized.showOfferSavings, true); assert.equal(normalized.hideZeroRows, false);
  assert.equal(normalizeCartSavingsSummaryConfig({ title: "   " }).title, "You Saved");
});

test("savings summary validation is optional and rejects malformed supplied fields", () => {
  assert.deepEqual(validateCartIntelligenceSettingsPatch({}), []);
  const errors = validateCartIntelligenceSettingsPatch({ savingsSummary: { title: 1, placement: "BAD", sortOrder: 1000, enabled: "yes", showTotalSavings: "yes" } });
  assert.match(errors.join(" "), /Title must be text/); assert.match(errors.join(" "), /placement/);
  assert.match(errors.join(" "), /order/); assert.match(errors.join(" "), /Enabled/); assert.match(errors.join(" "), /Show Total Savings/);
  assert.match(validateCartIntelligenceSettingsPatch({ savingsSummary: "bad" }).join(" "), /must be an object/);
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
  assert.ok(runtime.cartDrawerModules.modules.some((module) => module.key === "DYNAMIC_BANNER"));
  assert.equal(runtime.cartDrawerModules.modules.filter((module) => module.key === "SAVINGS_SUMMARY").length, 1);
  assert.equal(runtime.cartGoalProgress.enabled, false);
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
  assert.equal((runtime.dynamicBanner as { message: string }).message, "Members get early access");
  assert.equal(runtime.secret, undefined);
  assert.equal((runtime.trustBadges as { enabled: boolean }).enabled, true);
});

test("normalizes dynamic banner defaults, legacy values, and canonical precedence", () => {
  assert.deepEqual(normalizeCartDynamicBannerConfig(undefined), {
    enabled: false, message: "", placement: "BEFORE_CART_LINES", sortOrder: 10, style: "INFO", alignment: "CENTER",
    dismissible: false, showIcon: true, linkLabel: null, linkUrl: null, openLinkInNewTab: false,
    visibility: { emptyCart: true, cartWithItems: true },
  });
  const legacy = normalizeCartDynamicBannerConfig(undefined, { dynamicBannerEnabled: true, dynamicBannerText: " Legacy banner " });
  assert.equal(legacy.enabled, true); assert.equal(legacy.message, "Legacy banner");
  const canonical = normalizeCartDynamicBannerConfig({ enabled: false, message: " Canonical ", placement: "NOPE", sortOrder: Infinity, style: "LOUD", alignment: "RIGHT" }, { dynamicBannerEnabled: true, dynamicBannerText: "Legacy" });
  assert.equal(canonical.enabled, false); assert.equal(canonical.message, "Canonical"); assert.equal(canonical.placement, "BEFORE_CART_LINES");
  assert.equal(canonical.sortOrder, 10); assert.equal(canonical.style, "INFO"); assert.equal(canonical.alignment, "CENTER");
});

test("dynamic banner URL normalization allows safe links and rejects script links", () => {
  for (const linkUrl of ["https://example.com/deal", "http://example.com", "/collections/sale", "mailto:help@example.com", "tel:+15551234"]) {
    assert.equal(normalizeCartDynamicBannerConfig({ linkUrl }).linkUrl, linkUrl);
  }
  for (const linkUrl of ["javascript:alert(1)", "data:text/html,bad", "vbscript:bad", "//evil.example", "not a url"]) {
    assert.equal(normalizeCartDynamicBannerConfig({ linkUrl }).linkUrl, null);
  }
});

test("dynamic banner validation rejects unsafe and malformed enabled configuration", () => {
  const errors = validateCartIntelligenceSettingsPatch({ dynamicBanner: { enabled: true, message: "", placement: "BAD", sortOrder: 1000, style: "LOUD", alignment: "RIGHT", linkUrl: "javascript:alert(1)", visibility: { emptyCart: "yes", cartWithItems: true } } });
  assert.match(errors.join(" "), /required when enabled/); assert.match(errors.join(" "), /Link URL/); assert.match(errors.join(" "), /placement/); assert.match(errors.join(" "), /order/); assert.match(errors.join(" "), /style/); assert.match(errors.join(" "), /alignment/); assert.match(errors.join(" "), /Empty Cart Visibility/);
  assert.deepEqual(validateCartIntelligenceSettingsPatch({ dynamicBanner: { enabled: false, message: "", placement: "BEFORE_CART_LINES", sortOrder: 10, style: "INFO", alignment: "CENTER", linkUrl: "", visibility: { emptyCart: true, cartWithItems: true } } }), []);
});

test("runtime derives exactly one canonical banner and savings summary while preserving modules", () => {
  const settings = normalizeCartIntelligenceSettings({
    dynamicBanner: { enabled: true, message: "Banner", placement: "BEFORE_TOTALS", sortOrder: 30 },
    savingsSummary: { enabled: true, title: "Saved", placement: "BEFORE_TOTALS", sortOrder: 10 },
    cartDrawerModules: { modules: [
      { key: "LOYALTY", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 15 },
      { key: "DYNAMIC_BANNER", enabled: false, slot: "AFTER_TOTALS", sortOrder: 1 },
      { key: "SAVINGS_SUMMARY", enabled: false, slot: "AFTER_TOTALS", sortOrder: 1 },
    ] },
  });
  const modules = toCartIntelligencePublicRuntimeConfig(settings).cartDrawerModules.modules;
  assert.equal(modules.filter(module => module.key === "DYNAMIC_BANNER").length, 1);
  assert.equal(modules.filter(module => module.key === "SAVINGS_SUMMARY").length, 1);
  assert.ok(modules.some(module => module.key === "LOYALTY"));
  assert.equal(modules.find(module => module.key === "SAVINGS_SUMMARY")?.sortOrder, 10);
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
