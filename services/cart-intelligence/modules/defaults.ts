import type { CartDrawerModulesRuntime } from "./types";

export type CartDrawerModuleDefaultFlags = {
  cartGoalProgressEnabled?: boolean;
  trustBadgesEnabled?: boolean;
  checkoutReassuranceEnabled?: boolean;
};

/** Informational defaults matching today's hard-coded drawer order. */
export function cartDrawerModuleDefaults(flags: CartDrawerModuleDefaultFlags = {}): CartDrawerModulesRuntime {
  return { schemaVersion: 1, modules: [
    { key: "CART_GOAL_PROGRESS", enabled: flags.cartGoalProgressEnabled === true, slot: "BEFORE_TOTALS", sortOrder: 10 },
    { key: "PROMOTIONS", enabled: true, slot: "AFTER_CART_LINES", sortOrder: 10 },
    { key: "COUPON", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 20 },
    { key: "TRUST_BADGES", enabled: flags.trustBadgesEnabled === true, slot: "AFTER_CHECKOUT", sortOrder: 10 },
    { key: "CHECKOUT_REASSURANCE", enabled: flags.checkoutReassuranceEnabled === true, slot: "AFTER_CHECKOUT", sortOrder: 20 },
  ] };
}
