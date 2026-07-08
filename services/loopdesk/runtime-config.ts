export {
  LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
  CART_INTELLIGENCE_CONFIG_MODULE_KEY,
  getLoopDeskRuntimeConfig,
  getCartIntelligenceSettings,
  normalizeCartIntelligenceSettings,
  toCartIntelligencePublicRuntimeConfig,
  normalizeLoopDeskRuntimeConfig,
  normalizeLoopDeskMerchantSettings,
  toLoopDeskPublicRuntimeConfig,
  type LoopDeskMerchantSettings,
  type LoopDeskPublicRuntimeConfig,
  type CartIntelligenceSettings,
  type CartIntelligencePublicRuntimeConfig,
} from "./merchant-settings";
export type LoopDeskRuntimeConfig = import("./merchant-settings").LoopDeskPublicRuntimeConfig;
export { getEligiblePromotionRules, type PromotionRuntimeCart, type PromotionRuntimePlacement, type PromotionRuntimeResult } from "../promotion-rules/runtime";
