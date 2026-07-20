export const CART_DRAWER_MODULE_SLOTS = [
  "BEFORE_CART_LINES", "AFTER_CART_LINES", "BEFORE_PROMOTIONS", "AFTER_PROMOTIONS",
  "BEFORE_COUPON", "AFTER_COUPON", "BEFORE_TOTALS", "AFTER_TOTALS",
  "BEFORE_CHECKOUT", "AFTER_CHECKOUT", "BEFORE_FOOTER", "AFTER_FOOTER",
] as const;

export const CART_DRAWER_MODULE_KEYS = [
  "CART_GOAL_PROGRESS", "DYNAMIC_BANNER", "PROMOTIONS", "QUICK_ADD", "UPSELLS",
  "BUNDLES", "RECOMMENDATIONS", "COUPON", "SAVINGS_SUMMARY", "STORE_CREDIT",
  "LOYALTY", "TRUST_BADGES", "CHECKOUT_REASSURANCE",
] as const;

export type CartDrawerModuleSlot = (typeof CART_DRAWER_MODULE_SLOTS)[number];
export type CartDrawerModuleKey = (typeof CART_DRAWER_MODULE_KEYS)[number];

export type CartDrawerModuleRuntime = {
  key: CartDrawerModuleKey;
  enabled: boolean;
  slot: CartDrawerModuleSlot;
  sortOrder: number;
  settings?: Record<string, unknown>;
};

export type CartDrawerModulesRuntime = { schemaVersion: 1; modules: CartDrawerModuleRuntime[] };
