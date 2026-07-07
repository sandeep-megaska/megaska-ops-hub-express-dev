export {
  LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
  getLoopDeskRuntimeConfig,
  normalizeLoopDeskRuntimeConfig,
  normalizeLoopDeskMerchantSettings,
  toLoopDeskPublicRuntimeConfig,
  type LoopDeskMerchantSettings,
  type LoopDeskPublicRuntimeConfig,
} from "./merchant-settings";
export type LoopDeskRuntimeConfig = import("./merchant-settings").LoopDeskPublicRuntimeConfig;
